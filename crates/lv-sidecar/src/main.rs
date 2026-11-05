//! lv-core as a separate process: one live session speaking JSON lines. `docs/protocol.md` is the contract.

use lv_core::build::Sink;
use lv_core::config::StatePatch;
use lv_core::session::Session;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

const PROTOCOL: u32 = 2;

/// stdout is shared by the request reader, async commands and engine threads: each line is written whole, under the lock.
type Out = Arc<Mutex<std::io::Stdout>>;

fn emit(out: &Out, v: &Value) {
    let mut o = out.lock().unwrap_or_else(|e| e.into_inner());
    let _ = writeln!(o, "{v}");
    let _ = o.flush();
}

fn respond(out: &Out, id: Value, res: Result<Value, String>) {
    let r = match res {
        Ok(data) => json!({ "type": "response", "id": id, "ok": true, "data": data }),
        Err(error) => json!({ "type": "response", "id": id, "ok": false, "error": error }),
    };
    emit(out, &r);
}

fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p.get(key).and_then(Value::as_str).ok_or_else(|| format!("missing `{key}`"))
}

fn number(p: &Value, key: &str) -> Result<f64, String> {
    p.get(key).and_then(Value::as_f64).ok_or_else(|| format!("missing `{key}`"))
}

fn to_json<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn field<T: serde::de::DeserializeOwned>(p: &Value, key: &str) -> Result<Option<T>, String> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value(v.clone()).map(Some).map_err(|e| format!("bad `{key}`: {e}")),
    }
}

fn err(e: lv_core::error::Error) -> String {
    e.to_string()
}

fn open(p: &Value, session: &mut Option<Arc<Session>>, out: &Out) -> Result<Value, String> {
    let root = text(p, "root")?;
    // The previous one goes first: its lock must not stop reopening the same folder.
    *session = None;
    let events = out.clone();
    let sink: Sink = Arc::new(move |ev| match serde_json::to_value(&ev) {
        Ok(event) => emit(&events, &json!({ "type": "event", "event": event })),
        Err(e) => eprintln!("event not serialized: {e}"),
    });
    let s = Session::open(Path::new(root), sink).map_err(err)?;
    let project = s.view().map_err(err)?;
    let migration = to_json(&s.migration)?;
    *session = Some(s);
    Ok(json!({ "project": project, "migration": migration }))
}

fn patch(p: &Value) -> Result<StatePatch, String> {
    Ok(StatePatch {
        active_profile: field(p, "profile")?,
        selection: field(p, "selection")?,
        variables: field(p, "variables")?,
        auto_compile: field(p, "autoCompile")?,
        idle_ms: field(p, "idleMs")?,
        outside_save: field(p, "outsideSave")?,
        draft_images: field(p, "draftImages")?,
        current_part: field(p, "currentPart")?,
    })
}

/// Commands that can take seconds. They run on their own thread so `cancel` is never behind them.
fn is_async(cmd: &str) -> bool {
    matches!(cmd, "symbols" | "figures-status" | "figures-clean-preview" | "figures-clean" | "doctor" | "orphans" | "kill-orphans" | "detect" | "config-probe")
}

fn run(p: &Value, cmd: &str, s: &Arc<Session>) -> Result<Value, String> {
    match cmd {
        "view" => to_json(s.view().map_err(err)?),
        "refresh" => to_json(s.refresh().map_err(err)?),
        "set-root" => to_json(s.set_root(text(p, "file")?).map_err(err)?),
        "set-state" => to_json(s.set_state(patch(p)?).map_err(err)?),
        "file-info" => to_json(s.file_info(text(p, "file")?).map_err(err)?),
        "compile" => {
            if let Some(root) = p.get("root").and_then(Value::as_str) {
                s.set_root(root).map_err(err)?;
            }
            if let Some(selection) = field::<Vec<String>>(p, "parts")? {
                s.set_state(StatePatch { selection: Some(selection), ..Default::default() }).map_err(err)?;
            }
            to_json(s.request_build(p.get("profile").and_then(Value::as_str)).map_err(err)?)
        }
        "cancel" => Ok(json!({ "cancelled": s.cancel() })),
        "status" => Ok(json!({ "building": s.is_building(), "lockedBy": s.view().map_err(err)?.locked_by })),
        "problems" => to_json(s.problems(text(p, "profile")?)),
        "symbols" => to_json(s.symbols().map_err(err)?),
        "synctex-forward" => to_json(s.synctex_forward(text(p, "file")?, number(p, "line")? as u32).map_err(err)?),
        "synctex-inverse" => to_json(s.synctex_inverse(text(p, "profile")?, number(p, "page")? as u32, number(p, "x")?, number(p, "y")?).map_err(err)?),
        "pdf-for" => to_json(s.elegir_pdf(text(p, "file")?).map_err(err)?),
        "figures-status" => to_json(s.figures_status().map_err(err)?),
        "figure-images" => to_json(s.figure_images(text(p, "file")?).map_err(err)?),
        "figures-bake" => to_json(s.request_bake().map_err(err)?),
        "figures-clean-preview" => to_json(s.figures_clean_preview().map_err(err)?),
        "figures-clean" => to_json(s.figures_clean().map_err(err)?),
        "export" => to_json(s.request_export(field(p, "parts")?).map_err(err)?),
        "fragment" => to_json(s.request_fragment(text(p, "text")?.to_string()).map_err(err)?),
        "publish" => to_json(s.publish(text(p, "profile")?).map_err(err)?),
        "output-dir" => {
            let which = match text(p, "which")? {
                "publish" => "publicar",
                other => other,
            };
            to_json(s.carpeta_de_salida(which).map_err(err)?)
        }
        "history" => to_json(s.history(field::<usize>(p, "limit")?.unwrap_or(100))),
        "typical-times" => to_json(s.typical_times()),
        "doctor" => to_json(s.doctor().map_err(err)?),
        "orphans" => to_json(s.huerfanos()),
        "kill-orphans" => to_json(s.matar_huerfanos(&field::<Vec<u32>>(p, "pids")?.ok_or("missing `pids`")?).map_err(err)?),
        "detect" => to_json(s.detect_project(p.get("root").and_then(Value::as_str)).map_err(err)?),
        "config-read" => to_json(s.config_on_disk().map_err(err)?),
        "config-validate" => to_json(s.validate_config(text(p, "text")?)),
        "config-write" => to_json(s.write_config(text(p, "text")?).map_err(err)?),
        "config-probe" => to_json(s.probe_config(text(p, "text")?, p.get("part").and_then(Value::as_str)).map_err(err)?),
        other => Err(format!("unknown command: {other}")),
    }
}

fn handle(p: Value, session: &mut Option<Arc<Session>>, out: &Out) {
    let id = p.get("id").cloned().unwrap_or(Value::Null);
    let cmd = match text(&p, "cmd") {
        Ok(c) => c.to_string(),
        Err(e) => return respond(out, id, Err(e)),
    };
    match cmd.as_str() {
        "open" => respond(out, id, open(&p, session, out)),
        "close" => {
            if let Some(s) = session.take() {
                s.cancel();
            }
            respond(out, id, Ok(Value::Null))
        }
        _ => {
            let Some(s) = session.clone() else { return respond(out, id, Err("no project is open".into())) };
            if is_async(&cmd) {
                let out = out.clone();
                std::thread::spawn(move || respond(&out, id, run(&p, &cmd, &s)));
            } else {
                respond(out, id, run(&p, &cmd, &s));
            }
        }
    }
}

fn main() {
    let out: Out = Arc::new(Mutex::new(std::io::stdout()));
    emit(&out, &json!({ "type": "hello", "protocol": PROTOCOL, "version": env!("CARGO_PKG_VERSION") }));
    let mut session: Option<Arc<Session>> = None;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(p) => handle(p, &mut session, &out),
            Err(e) => respond(&out, Value::Null, Err(format!("invalid JSON: {e}"))),
        }
    }
    if let Some(s) = session {
        s.cancel();
    }
    // Exit rather than wait for threads: when the process dies the Job Objects close and KILL_ON_JOB_CLOSE takes the tree.
    std::process::exit(0);
}
