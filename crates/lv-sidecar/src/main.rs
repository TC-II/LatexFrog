//! lv-core como proceso aparte, para anfitriones que no son la app de Tauri (Texpile): una sesión viva y JSON por línea.
//!
//! Por stdin llegan pedidos `{"id":1,"pedido":"build",...}`; por stdout salen la respuesta `{"tipo":"respuesta","id":1,"ok":true,...}`
//! y los eventos de compilación `{"tipo":"evento","evento":{...}}`. El primer mensaje es `{"tipo":"hola","protocolo":1,...}`.
//! Cerrar stdin cancela lo que esté corriendo y termina: si el anfitrión muere, no queda nada compilando.
//!
//! Por ahora trae lo que necesita el experimento de compilar de H1; el resto de los pedidos llega después de esa decisión.

use lv_core::build::Sink;
use lv_core::config::StatePatch;
use lv_core::session::Session;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

const PROTOCOLO: u32 = 1;

/// stdout lo comparten el lector de pedidos y los hilos del motor: cada línea se escribe entera, con el candado tomado.
type Salida = Arc<Mutex<std::io::Stdout>>;

fn emitir(salida: &Salida, v: &Value) {
    let mut o = salida.lock().unwrap_or_else(|e| e.into_inner());
    let _ = writeln!(o, "{v}");
    let _ = o.flush();
}

fn texto<'a>(p: &'a Value, clave: &str) -> Result<&'a str, String> {
    p.get(clave).and_then(Value::as_str).ok_or_else(|| format!("falta `{clave}`"))
}

fn json_de<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn atender(p: &Value, sesion: &mut Option<Arc<Session>>, salida: &Salida) -> Result<Value, String> {
    let pedido = texto(p, "pedido")?;
    if pedido == "abrir" {
        let raiz = texto(p, "raiz")?;
        // Primero se suelta la anterior: su candado no tiene que trabar la apertura de la misma carpeta.
        *sesion = None;
        let eventos = salida.clone();
        let sink: Sink = Arc::new(move |ev| match serde_json::to_value(&ev) {
            Ok(evento) => emitir(&eventos, &json!({ "tipo": "evento", "evento": evento })),
            Err(e) => eprintln!("evento sin serializar: {e}"),
        });
        let s = Session::open(Path::new(raiz), sink).map_err(|e| e.to_string())?;
        let vista = s.view().map_err(|e| e.to_string())?;
        *sesion = Some(s);
        return json_de(vista);
    }
    let s = sesion.as_ref().ok_or("no hay un proyecto abierto")?;
    let error = |e: lv_core::error::Error| e.to_string();
    match pedido {
        "vista" => json_de(s.view().map_err(error)?),
        "estado" => {
            let mut patch = StatePatch::default();
            if let Some(v) = p.get("perfil").and_then(Value::as_str) {
                patch.active_profile = Some(v.to_string());
            }
            if let Some(v) = p.get("seleccion").and_then(Value::as_array) {
                patch.selection = Some(v.iter().filter_map(Value::as_str).map(str::to_string).collect());
            }
            json_de(s.set_state(patch).map_err(error)?)
        }
        "archivo-actual" => json_de(s.file_info(texto(p, "archivo")?).map_err(error)?),
        "build" => json_de(s.request_build(p.get("perfil").and_then(Value::as_str)).map_err(error)?),
        "cancelar" => Ok(json!({ "cancelado": s.cancel() })),
        "synctex-forward" => {
            let linea = p.get("linea").and_then(Value::as_u64).ok_or("falta `linea`")? as u32;
            json_de(s.synctex_forward(texto(p, "archivo")?, linea).map_err(error)?)
        }
        "synctex-inverse" => {
            let num = |c: &str| p.get(c).and_then(Value::as_f64).ok_or_else(|| format!("falta `{c}`"));
            json_de(s.synctex_inverse(texto(p, "perfil")?, num("pagina")? as u32, num("x")?, num("y")?).map_err(error)?)
        }
        otro => Err(format!("pedido desconocido: {otro}")),
    }
}

fn main() {
    let salida: Salida = Arc::new(Mutex::new(std::io::stdout()));
    emitir(&salida, &json!({ "tipo": "hola", "protocolo": PROTOCOLO, "version": env!("CARGO_PKG_VERSION") }));
    let mut sesion: Option<Arc<Session>> = None;
    for linea in std::io::stdin().lock().lines() {
        let Ok(linea) = linea else { break };
        if linea.trim().is_empty() {
            continue;
        }
        let (id, res) = match serde_json::from_str::<Value>(&linea) {
            Ok(p) => (p.get("id").cloned().unwrap_or(Value::Null), atender(&p, &mut sesion, &salida)),
            Err(e) => (Value::Null, Err(format!("JSON inválido: {e}"))),
        };
        let r = match res {
            Ok(datos) => json!({ "tipo": "respuesta", "id": id, "ok": true, "datos": datos }),
            Err(error) => json!({ "tipo": "respuesta", "id": id, "ok": false, "error": error }),
        };
        emitir(&salida, &r);
    }
    if let Some(s) = sesion {
        s.cancel();
    }
    // Sale con exit y no esperando hilos: al morir el proceso se cierran los Job Objects y KILL_ON_JOB_CLOSE se lleva el árbol.
    std::process::exit(0);
}
