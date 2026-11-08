//! The live preview's TeX processes: the warm LuaLaTeX that typesets one paragraph per keystroke, the draft passes that
//! reconcile it, and the bibliography tools they need. The app's draft code drives the protocol; this module owns the
//! processes, so every TeX run still starts here. Needs no open project: the preview runs beside the build, not in it.
//!
//! Output goes back in chunks as it arrives, not line by line: the warm engine writes thousands of glyph records per
//! paragraph, and one message per chunk keeps a 2 ms typeset from turning into a JSON stream the app has to parse line by line.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The only programs a live request may start.
pub const TOOLS: [&str; 3] = ["lualatex", "biber", "bibtex"];
/// The only variables a live request may set. PATH comes with every request: the Toolchain folders can change after the
/// sidecar started. The input paths let bibtex, run in the output folder, find the project's `.bib` and `.bst`.
pub const ENV: [&str; 4] = ["PATH", "BIBINPUTS", "BSTINPUTS", "TEXINPUTS"];

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LiveEvent {
    /// Output of process `proc`; `stream` is `out` or `err`.
    Out { proc: u64, stream: &'static str, data: String },
    /// The process ended; `code` is `None` when it was killed.
    Exit { proc: u64, code: Option<i32> },
}

pub type LiveSink = Arc<dyn Fn(LiveEvent) + Send + Sync>;

struct Running {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
}

pub struct Live {
    sink: LiveSink,
    procs: Mutex<HashMap<u64, Running>>,
    next: Mutex<u64>,
}

pub struct StartSpec<'a> {
    pub tool: &'a str,
    pub args: Vec<String>,
    pub cwd: &'a Path,
    pub env: Vec<(String, String)>,
    pub stdin: bool,
}

/// The variables a live run gets: the request's, and the search paths the project's `latexmkrc` sets, as a build gets them through
/// latexmk (a class found through `ensure_path('TEXINPUTS', 'style//')`). The project is the nearest folder up from `cwd` with a
/// `.latexfrog`: Live runs in the root, bibtex in the output folder. Where both set a path, the request's comes first.
fn entorno(cwd: &Path, pedido: &[(String, String)]) -> Vec<(String, String)> {
    let raiz = cwd.ancestors().find(|d| d.join(".latexfrog").is_dir());
    let proyecto = raiz.map(crate::build::entorno_del_latexmkrc).unwrap_or_default();
    juntar(pedido, &proyecto)
}

fn juntar(pedido: &[(String, String)], proyecto: &[(String, String)]) -> Vec<(String, String)> {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut out: Vec<(String, String)> = pedido.to_vec();
    for (k, v) in proyecto.iter().filter(|(_, v)| !v.is_empty()) {
        match out.iter_mut().find(|(o, _)| o == k) {
            Some((_, actual)) if actual.is_empty() => *actual = v.clone(),
            Some((_, actual)) => *actual = format!("{}{sep}{v}", actual.trim_end_matches(sep)),
            None => out.push((k.clone(), v.clone())),
        }
    }
    out
}

impl Live {
    pub fn new(sink: LiveSink) -> Arc<Live> {
        Arc::new(Live { sink, procs: Mutex::new(HashMap::new()), next: Mutex::new(1) })
    }

    pub fn start(self: &Arc<Self>, spec: StartSpec) -> Result<u64, String> {
        if !TOOLS.contains(&spec.tool) {
            return Err(format!("not a live tool: {}", spec.tool));
        }
        if !spec.cwd.is_dir() {
            return Err(format!("no such folder: {}", spec.cwd.display()));
        }
        let mut cmd = Command::new(spec.tool);
        cmd.args(&spec.args)
            .current_dir(spec.cwd)
            .stdin(if spec.stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, _) in &spec.env {
            if !ENV.contains(&k.as_str()) {
                return Err(format!("not a live variable: {k}"));
            }
        }
        for (k, v) in entorno(spec.cwd, &spec.env) {
            cmd.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", spec.tool))?;
        let id = {
            let mut n = self.next.lock().unwrap_or_else(|e| e.into_inner());
            *n += 1;
            *n - 1
        };
        let stdin = child.stdin.take();
        let out = child.stdout.take();
        let err = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        self.procs.lock().unwrap_or_else(|e| e.into_inner()).insert(id, Running { child: child.clone(), stdin });
        let err_pump = err.map(|e| pump(self.sink.clone(), id, "err", e));
        let me = self.clone();
        std::thread::spawn(move || {
            if let Some(o) = out {
                pump(me.sink.clone(), id, "out", o).join().ok();
            }
            if let Some(h) = err_pump {
                h.join().ok();
            }
            let code = wait(&child);
            me.procs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            (me.sink)(LiveEvent::Exit { proc: id, code });
        });
        Ok(id)
    }

    pub fn write(&self, id: u64, data: &str) -> Result<(), String> {
        let mut procs = self.procs.lock().unwrap_or_else(|e| e.into_inner());
        let r = procs.get_mut(&id).ok_or("process ended")?;
        let s = r.stdin.as_mut().ok_or("stdin closed")?;
        s.write_all(data.as_bytes()).and_then(|_| s.flush()).map_err(|e| e.to_string())
    }

    pub fn close_stdin(&self, id: u64) {
        if let Some(r) = self.procs.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id) {
            r.stdin = None;
        }
    }

    pub fn kill(&self, id: u64) -> bool {
        let child = match self.procs.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id) {
            Some(r) => {
                r.stdin = None;
                r.child.clone()
            }
            None => return false,
        };
        let ok = child.lock().unwrap_or_else(|e| e.into_inner()).kill().is_ok();
        ok
    }

    pub fn kill_all(&self) {
        let ids: Vec<u64> = self.procs.lock().unwrap_or_else(|e| e.into_inner()).keys().copied().collect();
        for id in ids {
            self.kill(id);
        }
    }

    pub fn running(&self) -> usize {
        self.procs.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

/// Polls instead of a blocking wait so `kill` can take the lock in between.
fn wait(child: &Mutex<Child>) -> Option<i32> {
    loop {
        if let Ok(Some(st)) = child.lock().unwrap_or_else(|e| e.into_inner()).try_wait() {
            return st.code();
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

/// Reads a pipe in chunks and sends each as text, holding back a UTF-8 sequence cut at the chunk's end.
fn pump(sink: LiveSink, id: u64, stream: &'static str, mut r: impl Read + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        let mut held: Vec<u8> = Vec::new();
        loop {
            let n = match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            held.extend_from_slice(&buf[..n]);
            let cut = complete_prefix(&held);
            if cut == 0 {
                continue;
            }
            let data = String::from_utf8_lossy(&held[..cut]).into_owned();
            held.drain(..cut);
            sink(LiveEvent::Out { proc: id, stream, data });
        }
        if !held.is_empty() {
            sink(LiveEvent::Out { proc: id, stream, data: String::from_utf8_lossy(&held).into_owned() });
        }
    })
}

/// Length of `b` without a trailing, incomplete UTF-8 sequence.
fn complete_prefix(b: &[u8]) -> usize {
    let n = b.len();
    for back in 1..=n.min(3) {
        let c = b[n - back];
        if c & 0xC0 != 0x80 {
            let need = if c >= 0xF0 { 4 } else if c >= 0xE0 { 3 } else if c >= 0xC0 { 2 } else { 1 };
            return if need > back { n - back } else { n };
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cut_utf8_is_held_back() {
        let s = "añ".as_bytes();
        assert_eq!(complete_prefix(s), 3);
        assert_eq!(complete_prefix(&s[..2]), 1);
        assert_eq!(complete_prefix(b"abc"), 3);
        let e = "€".as_bytes();
        assert_eq!(complete_prefix(&e[..2]), 0);
    }

    #[test]
    fn refuses_other_programs() {
        let live = Live::new(Arc::new(|_| {}));
        let spec = StartSpec { tool: "sh", args: vec![], cwd: Path::new("."), env: vec![], stdin: false };
        assert!(live.start(spec).is_err());
    }

    #[test]
    fn a_live_run_gets_the_search_paths_the_projects_latexmkrc_sets() {
        let s = if cfg!(windows) { ";" } else { ":" };
        let kv = |v: &[(&str, &str)]| v.iter().map(|(k, x)| (k.to_string(), x.to_string())).collect::<Vec<_>>();
        let pedido = kv(&[("PATH", "bin"), ("TEXINPUTS", &format!("live{s}"))]);
        let proyecto = kv(&[("TEXINPUTS", &format!("C:/p/style//{s}")), ("TTFONTS", "C:/p/style/fonts//"), ("BIBINPUTS", "")]);
        // the class's folder after the request's own, and the fonts' folder the request does not name
        assert_eq!(
            juntar(&pedido, &proyecto),
            kv(&[("PATH", "bin"), ("TEXINPUTS", &format!("live{s}C:/p/style//{s}")), ("TTFONTS", "C:/p/style/fonts//")])
        );
        // no project, nothing added
        assert_eq!(juntar(&pedido, &[]), pedido);
    }
}
