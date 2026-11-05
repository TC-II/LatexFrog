//! Historial de trabajos (9 del plan, F8): `.latexfrog/history.jsonl`, **una línea por cada trabajo de la cola** (build, cocción de figuras,
//! exportación y vista previa de un fragmento), no sólo por build. Es de esta máquina (`.latexfrog/` no se versiona) y se rota al llegar a ~1 MB.
//!
//! Cada línea lleva lo que hace falta para explicar por qué un trabajo tardó lo que tardó: las pasadas y lo que tardó cada herramienta
//! (sacado del stdout de latexmk), las figuras que pgf cocinó adentro del build, los auxiliares que faltaban, si el build anterior no
//! terminó, si hubo que reparar un `.aux` truncado, qué archivo que lee una figura cambió (y por eso se borraron `.md5` y
//! `.fdb_latexmk`), si se salteó el listado de figuras o por qué no, qué lo disparó (un guardado, un archivo cambiado afuera) y cuántos
//! otros procesos de TeX había corriendo. `pistas` convierte eso en frases para el panel.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

pub const HISTORY_FILE: &str = ".latexfrog/history.jsonl";
/// Al pasar de este tamaño se queda la mitad más nueva.
pub const LIMITE_DE_BYTES: u64 = 1_000_000;

fn es_cero<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Herramienta {
    pub nombre: String,
    pub ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listado {
    /// El build de un perfil que sólo consume el cache saltó el listado previo de las figuras.
    pub salteado: bool,
    pub motivo: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParteExportada {
    pub parte: String,
    pub num: Option<String>,
    pub ms: u64,
    pub ok: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Entrada {
    /// Cuándo arrancó (ms desde 1970).
    pub inicio_ms: u64,
    /// `build`, `bake`, `export` o `fragment`.
    pub tipo: String,
    pub perfil: Option<String>,
    /// Qué lo pidió: `manual`, `guardado: <archivo>`, `afuera: <archivo>`, `antes del build de <perfil>`...
    pub motivo: String,
    pub ms: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "es_cero")]
    pub cancelado: bool,

    // --- build y fragmento ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codigo: Option<i32>,
    #[serde(skip_serializing_if = "es_cero")]
    pub pasadas: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub herramientas: Vec<Herramienta>,
    #[serde(skip_serializing_if = "es_cero")]
    pub errores: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub avisos: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub cajas: u32,
    /// Las figuras que pgf cocinó adentro del build.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub figuras_en_el_build: Vec<String>,
    /// El perfil limpia sus auxiliares antes de compilar (`cleanBefore`).
    #[serde(skip_serializing_if = "es_cero")]
    pub limpio_antes: bool,
    /// Lo que no estaba al empezar: `fdb_latexmk` y `aux`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aux_faltantes: Vec<String>,
    #[serde(skip_serializing_if = "es_cero")]
    pub sospechoso_antes: bool,
    /// Hubo que borrar los auxiliares y compilar otra vez (`.aux` truncado).
    #[serde(skip_serializing_if = "es_cero")]
    pub reparado: bool,
    /// Cuántos otros procesos de TeX había corriendo al empezar.
    #[serde(skip_serializing_if = "es_cero")]
    pub otros_tex: u32,
    /// Archivos que una figura lee desde adentro de su `tikzpicture` y cambiaron.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub datos_cambiados: Vec<String>,
    /// Los que la app veía por primera vez (sin registro previo en `.latexfrog/tikz-datos.json`): no se sabe si cambiaron, se invalidan por las dudas.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub datos_nuevos: Vec<String>,
    /// Cuántos `.md5` de figuras se borraron por eso.
    #[serde(skip_serializing_if = "es_cero")]
    pub figuras_invalidadas: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listado: Option<Listado>,

    // --- cocción ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fase: Option<String>,
    #[serde(skip_serializing_if = "es_cero")]
    pub listado_ms: u64,
    /// Figuras que lista el documento (o las partes del perfil) y cuántas había que cocinar.
    #[serde(skip_serializing_if = "es_cero")]
    pub figuras_listadas: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub a_cocinar: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub cocidas: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub fallidas: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub restantes: u32,
    #[serde(skip_serializing_if = "es_cero")]
    pub cedio: bool,
    #[serde(skip_serializing_if = "es_cero")]
    pub trabajos: u32,

    // --- exportación ---
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub partes: Vec<ParteExportada>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destino: Option<String>,
}

/// Una línea del historial con sus pistas, tal como la ve el panel.
#[derive(Debug, Clone, Serialize)]
pub struct EntradaView {
    #[serde(flatten)]
    pub entrada: Entrada,
    pub pistas: Vec<String>,
}

// --- el archivo --------------------------------------------------------------------------------------------------------------

static ESCRIBIENDO: Mutex<()> = Mutex::new(());

/// Agrega una línea. Es lo último que tiene que fallar un build: si no se puede escribir (carpeta de sólo lectura, disco lleno) se sigue.
pub fn registrar(root: &Path, e: &Entrada) {
    let Ok(linea) = serde_json::to_string(e) else { return };
    let _g = ESCRIBIENDO.lock().unwrap_or_else(|p| p.into_inner());
    let ruta = root.join(HISTORY_FILE);
    if let Some(dir) = ruta.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&ruta) else { return };
    let _ = writeln!(f, "{linea}");
    drop(f);
    if fs::metadata(&ruta).is_ok_and(|m| m.len() > LIMITE_DE_BYTES) {
        rotar(&ruta);
    }
}

/// Se queda con la mitad más nueva de las líneas. Escritura atómica: un cierre en el medio no deja el historial a medias.
fn rotar(ruta: &Path) {
    let Ok(texto) = fs::read_to_string(ruta) else { return };
    let lineas: Vec<&str> = texto.lines().filter(|l| !l.trim().is_empty()).collect();
    let desde = lineas.len() / 2;
    let mut nuevo = lineas[desde..].join("\n");
    nuevo.push('\n');
    let _ = crate::fsio::escribir_atomico(ruta, nuevo.as_bytes());
}

/// Las últimas `limite` líneas, la más nueva primero. Una línea que no se entiende (un historial de otra versión, una escritura cortada) se salta.
pub fn leer(root: &Path, limite: usize) -> Vec<Entrada> {
    let Ok(texto) = fs::read_to_string(root.join(HISTORY_FILE)) else { return vec![] };
    let mut v: Vec<Entrada> = texto.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.reverse();
    v.truncate(limite);
    v
}

pub fn con_pistas(e: Entrada) -> EntradaView {
    let pistas = pistas(&e);
    EntradaView { entrada: e, pistas }
}

/// Lo que tarda un build de un perfil en esta máquina, para que la barra lo ponga al lado del tiempo que va corriendo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tipico {
    /// La mediana de los últimos builds buenos del perfil.
    pub ms: u64,
    pub pasadas: u32,
    /// Cuántos builds entraron en la cuenta.
    pub n: u32,
}

/// De cuántos builds se saca el típico: los últimos.
const BUILDS_PARA_EL_TIPICO: usize = 10;

fn mediana(mut v: Vec<u64>) -> u64 {
    v.sort_unstable();
    v[v.len() / 2]
}

/// El tiempo típico de cada perfil: la mediana de sus últimos 10 builds que salieron bien, sin cancelar y sin reparar (dos builds en uno).
/// Si hay al menos 3 «en caliente» (con los auxiliares y el `.fdb_latexmk` del perfil ya ahí), cuentan sólo ésos: el primero de un perfil
/// recompila todo y no es lo que se espera de un guardado. `lineas`: las más nuevas primero (`leer`).
pub fn tipicos_de(lineas: &[Entrada]) -> BTreeMap<String, Tipico> {
    let mut por_perfil: BTreeMap<&str, Vec<&Entrada>> = BTreeMap::new();
    for e in lineas.iter().filter(|e| e.tipo == "build" && e.ok && !e.cancelado && !e.reparado) {
        if let Some(p) = e.perfil.as_deref() {
            let v = por_perfil.entry(p).or_default();
            if v.len() < BUILDS_PARA_EL_TIPICO {
                v.push(e);
            }
        }
    }
    por_perfil
        .into_iter()
        .map(|(perfil, v)| {
            let calientes: Vec<&Entrada> = v.iter().copied().filter(|e| e.aux_faltantes.is_empty() && !e.limpio_antes).collect();
            let usadas = if calientes.len() >= 3 { calientes } else { v };
            let ms = mediana(usadas.iter().map(|e| e.ms).collect());
            let pasadas = mediana(usadas.iter().map(|e| u64::from(e.pasadas)).collect()) as u32;
            (perfil.to_string(), Tipico { ms, pasadas, n: usadas.len() as u32 })
        })
        .collect()
}

pub fn tipicos(root: &Path) -> BTreeMap<String, Tipico> {
    tipicos_de(&leer(root, 400))
}

// --- las pistas ----------------------------------------------------------------------------------------------------------------

/// La fase se guarda como la nombra el motor (`todo`, `perfil x`): esto es lo que lee una persona.
fn fase_legible(fase: Option<&str>) -> String {
    match fase {
        None | Some("todo") => "the whole document".to_string(),
        Some(f) => f.strip_prefix("perfil ").map_or_else(|| f.to_string(), |x| format!("profile {x}")),
    }
}

fn seg(ms: u64) -> String {
    format!("{:.1} s", ms as f64 / 1000.0)
}

fn plural(n: usize, uno: &str, varios: &str) -> String {
    if n == 1 {
        format!("{n} {uno}")
    } else {
        format!("{n} {varios}")
    }
}

fn nombre_corto(n: &str) -> &str {
    n.rsplit('/').next().unwrap_or(n)
}

/// Por qué tardó lo que tardó, en frases (6 del plan: «faltaba el `.fdb_latexmk`: recompilación completa», «3 figuras cocinadas: 4,1 s»).
pub fn pistas(e: &Entrada) -> Vec<String> {
    let mut p = Vec::new();
    match e.tipo.as_str() {
        "bake" => pistas_de_coccion(e, &mut p),
        "export" => pistas_de_exportacion(e, &mut p),
        _ => pistas_de_build(e, &mut p),
    }
    if let Some(m) = e.motivo.strip_prefix("afuera: ") {
        p.push(format!("set off by a file changed outside the app: {m}"));
    } else if let Some(m) = e.motivo.strip_prefix("guardado: ") {
        p.push(format!("set off by saving {m}"));
    } else if let Some(m) = e.motivo.strip_prefix("antes del build de ") {
        p.push(format!("baked before compiling \"{m}\": its figures were not up to date"));
    } else if e.motivo == "el resto" {
        p.push("the rest of the figures, baked after the build".to_string());
    }
    if e.cancelado {
        p.push("cancelled".to_string());
    }
    p
}

fn pistas_de_build(e: &Entrada, p: &mut Vec<String>) {
    if e.limpio_antes {
        p.push("the profile cleans its auxiliary files before compiling (cleanBefore): it starts from scratch".to_string());
    }
    if e.aux_faltantes.iter().any(|a| a == "fdb_latexmk") {
        p.push("the .fdb_latexmk was missing: latexmk did not know what changed and recompiled everything".to_string());
    }
    if e.aux_faltantes.iter().any(|a| a == "aux") && !e.limpio_antes {
        p.push("the profile's .aux files were missing: extra passes are needed to resolve references".to_string());
    }
    if e.sospechoso_antes {
        p.push("the previous build of this profile did not end well: its auxiliary files were suspect and were not seeded from there".to_string());
    }
    if e.reparado {
        p.push("the .aux was truncated: the profile's auxiliary files were deleted and it compiled again (two builds in one)".to_string());
    }
    if !e.datos_cambiados.is_empty() {
        let que = e.datos_cambiados.iter().map(|d| nombre_corto(d)).collect::<Vec<_>>().join(", ");
        p.push(format!(
            "{que} changed, which a figure reads from inside its tikzpicture: {} and the .fdb_latexmk were deleted, so latexmk recompiled and pgf rebaked those figures",
            plural(e.figuras_invalidadas as usize, ".md5", ".md5")
        ));
    }
    if !e.datos_nuevos.is_empty() {
        let que = e.datos_nuevos.iter().map(|d| nombre_corto(d)).collect::<Vec<_>>().join(", ");
        p.push(format!(
            "the app saw {que} for the first time, which a figure reads from inside its tikzpicture: with no earlier record it cannot tell if it changed, so to be safe {} and the .fdb_latexmk were deleted (latexmk recompiled and pgf rebaked those figures)",
            plural(e.figuras_invalidadas as usize, ".md5", ".md5")
        ));
    }
    if !e.figuras_en_el_build.is_empty() {
        let n = e.figuras_en_el_build.len();
        let nombres = e.figuras_en_el_build.iter().take(3).map(|f| nombre_corto(f).to_string()).collect::<Vec<_>>().join(", ");
        let mas = if n > 3 { format!(" and {} more", n - 3) } else { String::new() };
        let tiempo = e.herramientas.iter().find(|h| h.nombre.starts_with("pdflatex") || h.nombre.starts_with("xelatex") || h.nombre.starts_with("lualatex")).map(|h| format!(" (the first pass took {})", seg(h.ms))).unwrap_or_default();
        p.push(format!("{} inside the pass, one at a time: {nombres}{mas}{tiempo}", plural(n, "figure baked by pgf", "figures baked by pgf")));
    }
    if let Some(l) = &e.listado {
        if l.salteado {
            p.push(format!("figure listing skipped: {}", l.motivo));
        } else {
            p.push(format!("figures listed before compiling: {}", l.motivo));
        }
    }
    if e.otros_tex > 0 {
        p.push(format!("{} running: they compete for the CPU and the files", plural(e.otros_tex as usize, "more TeX process", "more TeX processes")));
    }
    // Lo más lento: sólo si pesa de verdad.
    if e.ms >= 3000 {
        if let Some(h) = e.herramientas.iter().max_by_key(|h| h.ms) {
            if h.ms * 2 >= e.ms && e.herramientas.len() > 1 {
                p.push(format!("the slowest was {}: {} of {}", h.nombre, seg(h.ms), seg(e.ms)));
            }
        }
        if let Some(b) = e.herramientas.iter().find(|h| h.nombre == "biber" || h.nombre == "bibtex") {
            if b.ms >= 2000 {
                p.push(format!("{}: {}", b.nombre, seg(b.ms)));
            }
        }
    }
    if e.pasadas >= 4 {
        p.push(format!("{} pdflatex runs: references, contents and bibliography take time to settle", e.pasadas));
    }
    if !e.ok && !e.cancelado {
        p.push(format!("failed{}", e.codigo.map(|c| format!(" (code {c})")).unwrap_or_default()));
    }
}

fn pistas_de_coccion(e: &Entrada, p: &mut Vec<String>) {
    if e.listado_ms > 0 {
        p.push(format!("the listing took {} (a pass that draws nothing, with {})", seg(e.listado_ms), fase_legible(e.fase.as_deref())));
    }
    if e.a_cocinar > 0 {
        let por = if e.cocidas > 0 { format!(", {} per figure", seg((e.ms.saturating_sub(e.listado_ms)) / u64::from(e.cocidas.max(1)))) } else { String::new() };
        p.push(format!(
            "baked {} of {} figures with {} at once: {}{por}",
            e.cocidas,
            e.a_cocinar,
            // Con 2 figuras para cocinar no corren 16 a la vez, aunque el máximo sea 16.
            plural(e.trabajos.min(e.a_cocinar) as usize, "subcompilation", "subcompilations"),
            seg(e.ms.saturating_sub(e.listado_ms))
        ));
    } else {
        p.push(format!("nothing to bake: only the listing ({} figures up to date)", e.figuras_listadas));
    }
    if e.cedio {
        p.push(format!("gave way to a build: {} left to bake", e.restantes));
    }
    if e.fallidas > 0 {
        p.push(format!("{} failed: they are in the Figures panel, with their error", plural(e.fallidas as usize, "figure", "figures")));
    }
    if !e.datos_cambiados.is_empty() {
        let que = e.datos_cambiados.iter().map(|d| nombre_corto(d)).collect::<Vec<_>>().join(", ");
        p.push(format!("{que} changed, which a figure reads from inside its tikzpicture: its figures were marked pending"));
    }
    if !e.datos_nuevos.is_empty() {
        let que = e.datos_nuevos.iter().map(|d| nombre_corto(d)).collect::<Vec<_>>().join(", ");
        p.push(format!("the app saw {que} for the first time, which a figure reads from inside its tikzpicture: to be safe its figures were marked pending"));
    }
}

fn pistas_de_exportacion(e: &Entrada, p: &mut Vec<String>) {
    let n = e.partes.len();
    if n > 0 {
        let ok = e.partes.iter().filter(|x| x.ok).count();
        p.push(format!("{ok} of {} exported: {} per part", plural(n, "part", "parts"), seg(e.ms / n as u64)));
        let lenta = e.partes.iter().max_by_key(|x| x.ms);
        if let Some(l) = lenta {
            // La más lenta se nombra si pasa del promedio por un 20 %.
            if n > 1 && l.ms * 5 >= (e.ms / n as u64) * 6 {
                p.push(format!("the slowest was {}: {}", nombre_corto(&l.parte), seg(l.ms)));
            }
        }
        for x in e.partes.iter().filter(|x| !x.ok) {
            p.push(format!("{} failed: its errors are in the problems of the export profile", nombre_corto(&x.parte)));
        }
    }
    p.push("each part is a build with another `\\includeonly`, so latexmk always recompiles".to_string());
    if let Some(d) = &e.destino {
        p.push(format!("the PDFs are in {d}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build() -> Entrada {
        Entrada { tipo: "build".into(), perfil: Some("rapido".into()), motivo: "manual".into(), ms: 9500, ok: true, pasadas: 1, ..Default::default() }
    }

    #[test]
    fn una_linea_por_trabajo_se_lee_de_nuevo_con_la_mas_nueva_primero() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..5u64 {
            registrar(d.path(), &Entrada { inicio_ms: i, tipo: "bake".into(), ok: true, ..Default::default() });
        }
        let v = leer(d.path(), 3);
        assert_eq!(v.iter().map(|e| e.inicio_ms).collect::<Vec<_>>(), [4, 3, 2]);
        assert!(leer(&d.path().join("no-hay"), 3).is_empty());
        // Una línea ilegible (otra versión, una escritura cortada) se salta y las demás siguen.
        let ruta = d.path().join(HISTORY_FILE);
        let mut t = fs::read_to_string(&ruta).unwrap();
        t.push_str("{ esto no\n");
        fs::write(&ruta, t).unwrap();
        registrar(d.path(), &Entrada { inicio_ms: 9, tipo: "build".into(), ..Default::default() });
        assert_eq!(leer(d.path(), 10).len(), 6);
    }

    #[test]
    fn el_archivo_no_pasa_de_un_mega_y_se_queda_con_lo_mas_nuevo() {
        let d = tempfile::tempdir().unwrap();
        let gorda = |i: u64| Entrada { inicio_ms: i, tipo: "build".into(), figuras_en_el_build: (0..40).map(|n| format!("figuras-cache/ABCDEF-capitulo-{n}")).collect(), ..Default::default() };
        // Se escribe hasta que una escritura haga que el archivo se achique: ahí se rotó.
        let mut n = 0u64;
        let mut anterior = 0u64;
        loop {
            registrar(d.path(), &gorda(n));
            n += 1;
            let ahora = fs::metadata(d.path().join(HISTORY_FILE)).unwrap().len();
            if ahora < anterior {
                break;
            }
            anterior = ahora;
            assert!(n < 5000, "nunca rotó");
        }
        assert!(anterior > LIMITE_DE_BYTES - 20_000, "rotó recién al llegar al límite ({anterior} bytes antes de la escritura que rotó)");
        let tamano = fs::metadata(d.path().join(HISTORY_FILE)).unwrap().len();
        assert!(tamano < LIMITE_DE_BYTES, "se rotó: {tamano} bytes");
        let v = leer(d.path(), 100_000);
        assert_eq!(v[0].inicio_ms, n - 1, "lo más nuevo se conserva");
        assert!(v.len() as u64 > n / 3 && (v.len() as u64) < n, "{} de {n}", v.len());
        registrar(d.path(), &gorda(n));
        assert_eq!(leer(d.path(), 1)[0].inicio_ms, n, "y se sigue escribiendo");
    }

    #[test]
    fn las_pistas_de_un_build_dicen_por_que_tardo() {
        let mut e = build();
        e.aux_faltantes = vec!["fdb_latexmk".into(), "aux".into()];
        e.sospechoso_antes = true;
        e.reparado = true;
        e.figuras_en_el_build = vec!["figuras-cache/AB-cauer-3".into(), "figuras-cache/AB-cauer-4".into()];
        e.herramientas = vec![Herramienta { nombre: "pdflatex".into(), ms: 7000 }, Herramienta { nombre: "biber".into(), ms: 2500 }];
        e.otros_tex = 2;
        e.listado = Some(Listado { salteado: false, motivo: "cambió el sello de las figuras".into() });
        e.motivo = "afuera: Secciones/fig_engranaje_pinon.tex".into();
        let p = pistas(&e).join(" | ");
        for frase in [
            "the .fdb_latexmk was missing",
            ".aux files were missing",
            "did not end well",
            "the .aux was truncated",
            "2 figures baked by pgf inside the pass, one at a time: AB-cauer-3, AB-cauer-4 (the first pass took 7.0 s)",
            "figures listed before compiling: cambió el sello",
            "2 more TeX processes running",
            "the slowest was pdflatex: 7.0 s of 9.5 s",
            "biber: 2.5 s",
            "set off by a file changed outside the app: Secciones/fig_engranaje_pinon.tex",
        ] {
            assert!(p.contains(frase), "falta «{frase}» en: {p}");
        }
    }

    #[test]
    fn una_pista_por_cada_cosa_nueva_de_f6_y_f7() {
        let mut e = build();
        e.perfil = Some("completo".into());
        e.listado = Some(Listado { salteado: true, motivo: "nada cambió desde la última cocción completa".into() });
        e.datos_cambiados = vec!["Secciones/fig_engranaje_pinon.tex".into(), "Secciones/fig_engranaje_rueda.tex".into()];
        e.figuras_invalidadas = 2;
        e.limpio_antes = true;
        let p = pistas(&e).join(" | ");
        assert!(p.contains("figure listing skipped: nada cambió desde la última cocción completa"), "{p}");
        assert!(p.contains("fig_engranaje_pinon.tex, fig_engranaje_rueda.tex changed, which a figure reads from inside its tikzpicture: 2 .md5 and the .fdb_latexmk"), "{p}");
        assert!(p.contains("cleanBefore"), "{p}");
        assert!(pistas(&Entrada { ok: false, codigo: Some(12), ..build() }).iter().any(|x| x == "failed (code 12)"));
        assert!(pistas(&Entrada { ok: false, cancelado: true, ..build() }).iter().any(|x| x == "cancelled"));
    }

    #[test]
    fn el_tipico_de_un_perfil_es_la_mediana_de_sus_ultimos_builds_buenos_en_caliente() {
        let b = |perfil: &str, ms: u64| Entrada { tipo: "build".into(), perfil: Some(perfil.into()), ms, ok: true, pasadas: 2, ..Default::default() };
        // Más nuevos primero. Uno cancelado, uno fallido, uno reparado y uno en frío (le faltaba el .fdb_latexmk) no cuentan si hay en caliente.
        let lineas = vec![
            b("parcial", 5000),
            Entrada { cancelado: true, ok: false, ..b("parcial", 90_000) },
            b("parcial", 4000),
            Entrada { ok: false, ..b("parcial", 1) },
            Entrada { reparado: true, ..b("parcial", 70_000) },
            b("parcial", 6000),
            Entrada { aux_faltantes: vec!["fdb_latexmk".into()], ..b("parcial", 40_000) },
            Entrada { tipo: "bake".into(), perfil: Some("parcial".into()), ms: 123_456, ok: true, ..Default::default() },
            b("rapido", 10_000),
        ];
        let t = tipicos_de(&lineas);
        assert_eq!(t["parcial"], Tipico { ms: 5000, pasadas: 2, n: 3 }, "mediana de 5, 4 y 6 s: sin el cancelado, el fallido, el reparado ni el de frío");
        // Con menos de 3 en caliente se usan todos los buenos (el de frío incluido): mejor eso que nada.
        assert_eq!(t["rapido"], Tipico { ms: 10_000, pasadas: 2, n: 1 });
        // Sólo cuentan los últimos 10.
        let muchas: Vec<Entrada> = (0..15).map(|i| b("completo", if i < 10 { 3000 } else { 99_000 })).collect();
        assert_eq!(tipicos_de(&muchas)["completo"].n, 10);
        assert_eq!(tipicos_de(&muchas)["completo"].ms, 3000);
        assert!(tipicos_de(&[]).is_empty());
    }

    #[test]
    fn un_dato_que_la_app_veia_por_primera_vez_no_se_dice_que_cambio() {
        let mut e = build();
        e.datos_nuevos = vec!["Secciones/fig_engranaje_pinon.tex".into()];
        e.figuras_invalidadas = 1;
        let p = pistas(&e).join(" | ");
        assert!(p.contains("the app saw fig_engranaje_pinon.tex for the first time"), "{p}");
        assert!(p.contains("with no earlier record it cannot tell if it changed"), "{p}");
        assert!(!p.contains("fig_engranaje_pinon.tex changed"), "{p}");
        // Y en la cocción también.
        let c = Entrada { tipo: "bake".into(), datos_nuevos: vec!["datos.tex".into()], ok: true, ..Default::default() };
        let p = pistas(&c).join(" | ");
        assert!(p.contains("the app saw datos.tex for the first time") && !p.contains("datos.tex changed"), "{p}");
    }

    #[test]
    fn una_coccion_de_pocas_figuras_no_dice_que_corrieron_tantas_a_la_vez_como_el_maximo() {
        let c = Entrada { tipo: "bake".into(), a_cocinar: 2, cocidas: 2, trabajos: 16, ms: 10_000, ok: true, ..Default::default() };
        let p = pistas(&c).join(" | ");
        assert!(p.contains("baked 2 of 2 figures with 2 subcompilations at once"), "{p}");
    }

    #[test]
    fn las_pistas_de_una_coccion_y_de_una_exportacion() {
        let c = Entrada {
            tipo: "bake".into(),
            motivo: "antes del build de parcial".into(),
            fase: Some("perfil parcial".into()),
            ms: 29_000,
            listado_ms: 4_000,
            figuras_listadas: 46,
            a_cocinar: 46,
            cocidas: 46,
            trabajos: 16,
            ok: true,
            ..Default::default()
        };
        let p = pistas(&c).join(" | ");
        assert!(p.contains("the listing took 4.0 s"), "{p}");
        assert!(p.contains("baked 46 of 46 figures with 16 subcompilations at once: 25.0 s, 0.5 s per figure"), "{p}");
        assert!(p.contains("baked before compiling \"parcial\""), "{p}");
        let sin = Entrada { tipo: "bake".into(), figuras_listadas: 158, listado_ms: 7000, ms: 7100, ok: true, ..Default::default() };
        assert!(pistas(&sin).iter().any(|x| x.contains("nothing to bake: only the listing (158 figures up to date)")));
        let ced = Entrada { tipo: "bake".into(), a_cocinar: 100, cocidas: 40, restantes: 60, cedio: true, trabajos: 8, ms: 30_000, ..Default::default() };
        assert!(pistas(&ced).iter().any(|x| x.contains("gave way to a build: 60 left to bake")));
        let x = Entrada {
            tipo: "export".into(),
            ms: 30_000,
            ok: false,
            partes: vec![
                ParteExportada { parte: "Secciones/Uno".into(), num: Some("8".into()), ms: 12_000, ok: true },
                ParteExportada { parte: "Secciones/Roto".into(), num: None, ms: 18_000, ok: false },
            ],
            destino: Some("export".into()),
            ..Default::default()
        };
        let p = pistas(&x).join(" | ");
        assert!(p.contains("1 of 2 parts exported: 15.0 s per part"), "{p}");
        assert!(p.contains("the slowest was Roto: 18.0 s") && p.contains("Roto failed"), "{p}");
    }
}
