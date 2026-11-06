//! `live-*` against the real binary and a real lualatex, left waiting on its `**` prompt. Skipped when lualatex is not on the PATH.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Value>,
    next: u64,
}

impl Sidecar {
    fn new() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_lv-sidecar")).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = channel();
        std::thread::spawn(move || {
            for l in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(serde_json::from_str::<Value>(&l).unwrap()).is_err() {
                    break;
                }
            }
        });
        let stdin = child.stdin.take();
        let s = Sidecar { child, stdin, lines, next: 0 };
        assert_eq!(s.recv()["type"], "hello");
        s
    }

    fn recv(&self) -> Value {
        self.lines.recv_timeout(Duration::from_secs(30)).expect("no message from the sidecar")
    }

    fn send(&mut self, mut req: Value) -> u64 {
        self.next += 1;
        req["id"] = json!(self.next);
        writeln!(self.stdin.as_mut().unwrap(), "{req}").unwrap();
        self.next
    }

    /// The answer to `req`; live events seen meanwhile go to `seen`.
    fn ask(&mut self, req: Value, seen: &mut Vec<Value>) -> Value {
        let id = self.send(req);
        loop {
            let m = self.recv();
            if m["type"] == "response" && m["id"] == id {
                return m;
            }
            seen.push(m);
        }
    }

    fn until(&self, seen: &mut Vec<Value>, f: impl Fn(&Value) -> bool) -> Value {
        if let Some(i) = seen.iter().position(&f) {
            return seen.remove(i);
        }
        loop {
            let m = self.recv();
            if f(&m) {
                return m;
            }
        }
    }
}

fn lualatex() -> bool {
    Command::new("lualatex").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

fn start(s: &mut Sidecar, dir: &std::path::Path, seen: &mut Vec<Value>) -> u64 {
    let path = std::env::var("PATH").unwrap_or_default();
    let r = s.ask(json!({ "cmd": "live-start", "tool": "lualatex", "args": ["-ini"], "cwd": dir, "env": { "PATH": path }, "stdin": true }), seen);
    assert_eq!(r["ok"], true, "{r}");
    r["data"]["proc"].as_u64().unwrap()
}

#[test]
fn refuses_other_programs_and_variables_without_a_project() {
    let mut s = Sidecar::new();
    let mut seen = vec![];
    let r = s.ask(json!({ "cmd": "live-start", "tool": "sh", "args": [], "cwd": "." }), &mut seen);
    assert_eq!(r["ok"], false);
    let r = s.ask(json!({ "cmd": "live-start", "tool": "lualatex", "cwd": ".", "env": { "LD_PRELOAD": "x" } }), &mut seen);
    assert_eq!(r["ok"], false);
    let r = s.ask(json!({ "cmd": "live-status" }), &mut seen);
    assert_eq!(r["data"]["running"], 0);
}

#[test]
fn streams_output_takes_input_and_kill_leaves_nothing() {
    if !lualatex() {
        return eprintln!("lualatex not found: skipped");
    }
    let dir = tempfile::tempdir().unwrap();
    let mut s = Sidecar::new();
    let mut seen = vec![];
    let proc = start(&mut s, dir.path(), &mut seen);
    // the prompt arrives as output; a typed line reaches the engine and its answer comes back
    s.until(&mut seen, |m| m["type"] == "live" && m["event"]["kind"] == "out" && m["event"]["data"].as_str().unwrap_or("").contains("**"));
    s.send(json!({ "cmd": "live-write", "proc": proc, "data": "\\message{live-ok}\n", "quiet": true }));
    s.until(&mut seen, |m| m["type"] == "live" && m["event"]["data"].as_str().unwrap_or("").contains("live-ok"));
    let r = s.ask(json!({ "cmd": "live-kill", "proc": proc }), &mut seen);
    assert_eq!(r["data"]["killed"], true);
    let exit = s.until(&mut seen, |m| m["type"] == "live" && m["event"]["kind"] == "exit");
    assert_eq!(exit["event"]["proc"], proc);
    let r = s.ask(json!({ "cmd": "live-status" }), &mut seen);
    assert_eq!(r["data"]["running"], 0);
}

#[test]
fn closing_stdin_kills_live_processes() {
    if !lualatex() {
        return eprintln!("lualatex not found: skipped");
    }
    let dir = tempfile::tempdir().unwrap();
    let mut s = Sidecar::new();
    let mut seen = vec![];
    start(&mut s, dir.path(), &mut seen);
    s.until(&mut seen, |m| m["type"] == "live" && m["event"]["kind"] == "out");
    s.stdin = None;
    assert!(s.child.wait().unwrap().success());
    std::thread::sleep(Duration::from_millis(200));
    #[cfg(unix)]
    {
        let out = Command::new("pgrep").args(["-f", "lualatex -ini"]).output().unwrap();
        let cwd_match = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|pid| std::fs::read_link(format!("/proc/{pid}/cwd")).ok())
            .any(|c| c == dir.path());
        assert!(!cwd_match, "a lualatex survived its sidecar");
    }
}
