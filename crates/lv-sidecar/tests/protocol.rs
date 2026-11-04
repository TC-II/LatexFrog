//! Runs the real binary with a fake latexmk: a `.cmd` that calls PowerShell, set through `LV_LATEXMK`.
#![cfg(windows)]

use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;
use tempfile::TempDir;

const CONFIG: &str = r#"{
  "root": "main.tex",
  "parts": { "commands": ["include"] },
  "variables": { "A": { "choices": ["a", "b"], "default": "a" } },
  "profiles": { "fast": { "parts": "selection" }, "full": {} }
}"#;

const OK: &str = "$p = $env:LV_PERFIL\n$d = \".latexfrog/build/$p\"\nNew-Item -ItemType Directory -Force $d | Out-Null\n\"Run number 1 of rule 'pdflatex'\"\nSet-Content \"$d/lv-$p.pdf\" 'x'\n";
/// Writes its PID, then hangs until killed.
const SLOW: &str = "Set-Content pid.txt $PID\n\"Run number 1 of rule 'pdflatex'\"\nStart-Sleep 60\n";

struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Value>,
    next: u64,
    _tools: TempDir,
}

impl Sidecar {
    fn new(script: &str) -> Self {
        let tools = TempDir::new().unwrap();
        fs::write(tools.path().join("fake.ps1"), script).unwrap();
        let cmd = tools.path().join("latexmk.cmd");
        fs::write(&cmd, "@powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0fake.ps1\"\r\n").unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_lv-sidecar"))
            .env("LV_LATEXMK", &cmd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
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
        let s = Sidecar { child, stdin, lines, next: 0, _tools: tools };
        let hello = s.recv();
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["protocol"], 2);
        s
    }

    fn recv(&self) -> Value {
        self.lines.recv_timeout(Duration::from_secs(30)).expect("no message in 30 s")
    }

    fn send(&mut self, mut v: Value) -> u64 {
        self.next += 1;
        v["id"] = json!(self.next);
        writeln!(self.stdin.as_mut().unwrap(), "{v}").unwrap();
        self.next
    }

    /// Waits for the response, keeping the events that arrive first.
    fn call(&mut self, v: Value, events: &mut Vec<Value>) -> Value {
        let id = self.send(v);
        loop {
            let m = self.recv();
            if m["type"] == "response" && m["id"] == id {
                return m;
            }
            if m["type"] == "event" {
                events.push(m["event"].clone());
            }
        }
    }

    fn ok(&mut self, v: Value, events: &mut Vec<Value>) -> Value {
        let r = self.call(v, events);
        assert_eq!(r["ok"], true, "{r}");
        r["data"].clone()
    }

    fn until(&self, kind: &str, events: &mut Vec<Value>) -> Value {
        loop {
            if let Some(e) = events.iter().find(|e| e["type"] == kind) {
                return e.clone();
            }
            let m = self.recv();
            if m["type"] == "event" {
                events.push(m["event"].clone());
            }
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn project(config_name: &str) -> TempDir {
    let d = TempDir::new().unwrap();
    let e = |rel: &str, t: &str| {
        let p = d.path().join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, t).unwrap();
    };
    e("main.tex", "\\documentclass{book}\n\\begin{document}\n\\include{ch/one}\n\\include{ch/two}\n\\end{document}\n");
    e("ch/one.tex", "\\chapter{One}\n\\section{Start}\n");
    e("ch/two.tex", "\\chapter{Two}\n");
    e(config_name, CONFIG);
    d
}

fn open(s: &mut Sidecar, d: &Path, events: &mut Vec<Value>) -> Value {
    s.ok(json!({ "cmd": "open", "root": d.to_str().unwrap() }), events)
}

fn alive(pid: u32) -> bool {
    let o = Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output().unwrap();
    String::from_utf8_lossy(&o.stdout).contains(&pid.to_string())
}

#[test]
fn commands_need_a_project_and_unknown_ones_fail() {
    let mut s = Sidecar::new(OK);
    let mut ev = vec![];
    assert_eq!(s.call(json!({ "cmd": "view" }), &mut ev)["error"], "no project is open");
    let d = project("latexfrog.json");
    open(&mut s, d.path(), &mut ev);
    assert!(s.call(json!({ "cmd": "nope" }), &mut ev)["error"].as_str().unwrap().contains("unknown command"));
    assert!(s.call(json!({ "cmd": "file-info" }), &mut ev)["error"].as_str().unwrap().contains("missing `file`"));
}

#[test]
fn opens_compiles_with_parts_and_reports_events() {
    let mut s = Sidecar::new(OK);
    let mut ev = vec![];
    let d = project("latexfrog.json");
    let o = open(&mut s, d.path(), &mut ev);
    assert_eq!(o["project"]["rootFile"], "main.tex");
    assert_eq!(o["migration"]["config"], false);

    let ack = s.ok(json!({ "cmd": "compile", "profile": "fast", "parts": ["ch/one"] }), &mut ev);
    assert_eq!(ack["kind"], "started");
    let f = s.until("finished", &mut ev);
    assert_eq!(f["ok"], true, "{f}");
    assert_eq!(f["profile"], "fast");
    assert_eq!(f["pdf"], ".latexfrog/build/fast/lv-fast.pdf");
    assert!(ev.iter().any(|e| e["type"] == "started" && e["profile"] == "fast"));
    assert!(ev.iter().any(|e| e["type"] == "pass" && e["tool"] == "pdflatex"));
    assert_eq!(s.ok(json!({ "cmd": "view" }), &mut ev)["state"]["selection"], json!(["ch/one"]));
    assert_eq!(s.ok(json!({ "cmd": "problems", "profile": "fast" }), &mut ev), json!([]));
}

#[test]
fn outline_and_variables_and_config() {
    let mut s = Sidecar::new(OK);
    let mut ev = vec![];
    let d = project("latexfrog.json");
    open(&mut s, d.path(), &mut ev);
    let sym = s.ok(json!({ "cmd": "symbols" }), &mut ev);
    let sections = sym["sections"].as_array().unwrap();
    assert!(sections.iter().any(|x| x["title"] == "Start" && x["file"] == "ch/one.tex" && x["line"] == 2), "{sections:?}");
    assert_eq!(s.ok(json!({ "cmd": "set-state", "variables": { "A": "b" } }), &mut ev)["variables"]["A"], "b");
    assert_eq!(s.ok(json!({ "cmd": "config-read" }), &mut ev), CONFIG);
    assert!(s.ok(json!({ "cmd": "config-validate", "text": "{" }), &mut ev).to_string().contains('{'));
    assert_eq!(s.ok(json!({ "cmd": "history" }), &mut ev), json!([]));
    assert!(s.ok(json!({ "cmd": "figures-clean-preview" }), &mut ev).is_object());
}

#[test]
fn cancel_leaves_no_process() {
    let mut s = Sidecar::new(SLOW);
    let mut ev = vec![];
    let d = project("latexfrog.json");
    open(&mut s, d.path(), &mut ev);
    s.ok(json!({ "cmd": "compile", "profile": "full" }), &mut ev);
    let pid_file = d.path().join("pid.txt");
    let start = std::time::Instant::now();
    let pid = loop {
        if let Some(p) = fs::read_to_string(&pid_file).ok().and_then(|t| t.trim().parse::<u32>().ok()) {
            break p;
        }
        assert!(start.elapsed().as_secs() < 20, "the fake never started");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(alive(pid));
    assert_eq!(s.ok(json!({ "cmd": "cancel" }), &mut ev)["cancelled"], true);
    let f = s.until("finished", &mut ev);
    assert_eq!(f["cancelled"], true, "{f}");
    assert!(!alive(pid), "the build survived the cancel");
    assert_eq!(s.ok(json!({ "cmd": "status" }), &mut ev)["building"], false);
}

#[test]
fn closing_stdin_leaves_no_process() {
    let mut s = Sidecar::new(SLOW);
    let mut ev = vec![];
    let d = project("latexfrog.json");
    open(&mut s, d.path(), &mut ev);
    s.ok(json!({ "cmd": "compile", "profile": "full" }), &mut ev);
    let pid_file = d.path().join("pid.txt");
    while !pid_file.exists() || fs::read_to_string(&pid_file).unwrap().trim().is_empty() {
        std::thread::sleep(Duration::from_millis(50));
    }
    let pid: u32 = fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
    s.stdin = None;
    s.child.wait().unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert!(!alive(pid));
}

#[test]
fn open_migrates_and_a_second_sidecar_sees_the_lock() {
    let mut s = Sidecar::new(OK);
    let mut ev = vec![];
    let d = project(concat!("latex", "viewer.json"));
    fs::create_dir_all(d.path().join(concat!(".", "lv"))).unwrap();
    fs::write(d.path().join(concat!(".", "lv")).join("state.json"), "{\"activeProfile\":\"full\"}").unwrap();
    let o = open(&mut s, d.path(), &mut ev);
    assert_eq!(o["migration"], json!({ "config": true, "folder": true, "conflicts": [] }));
    assert_eq!(o["project"]["configSaved"], true);
    assert_eq!(o["project"]["state"]["activeProfile"], "full");

    let mut other = Sidecar::new(OK);
    let mut ev2 = vec![];
    let o2 = open(&mut other, d.path(), &mut ev2);
    assert!(o2["project"]["lockedBy"].is_number(), "{o2}");
    assert_eq!(other.ok(json!({ "cmd": "status" }), &mut ev2)["lockedBy"], o2["project"]["lockedBy"]);
    assert_eq!(other.call(json!({ "cmd": "compile" }), &mut ev2)["ok"], false);
}
