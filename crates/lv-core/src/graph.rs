//! Grafo de inclusión y partes del proyecto (4.3 del plan).
//!
//! Se recorre desde la raíz siguiendo `\input`, `\include`, `\subfile` e `\import`. Las **partes** son las entradas de
//! primer nivel hechas con los comandos de `parts.commands`, en el orden en que aparecen en el documento: en el libro
//! son los `\Capitulo{...}` de `libro_cuerpo.tex`, que entra por `\input` desde la raíz, así que no alcanza con mirar la
//! raíz. El nombre de una parte es el argumento tal cual (`Secciones/Desnormalización`), que es lo que lleva
//! `\includeonly`.
//!
//! No es un parser de TeX: busca los comandos con sus argumentos entre llaves, ignora los comentarios y descarta los
//! argumentos que son parámetros de macro (`\input{#1}` dentro de la definición de `\Capitulo`). Alcanza para decidir
//! qué archivos pertenecen a qué parte; lo que se le escape es un archivo que no aparece, no un build roto.

use crate::macros::{LoadKind, Macros, PathTemplate};
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Input,
    Include,
    Subfile,
    Import,
    Graphics,
    Bib,
    /// Un comando de `parts.commands` que no es de los de arriba (`\Capitulo`).
    Part,
}

impl EdgeKind {
    pub(crate) fn estructural(self) -> bool {
        matches!(self, EdgeKind::Input | EdgeKind::Include | EdgeKind::Subfile | EdgeKind::Import | EdgeKind::Part)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub kind: EdgeKind,
    pub command: String,
    /// El argumento como está escrito (sin comillas).
    pub raw: String,
    /// El archivo que resuelve, relativo a la raíz y con `/`, si existe.
    pub target: Option<String>,
    pub line: u32,
    /// La inclusión ocurre dentro de un `tikzpicture` (o de un archivo que entra desde uno): pgf decide si la figura cambió con el
    /// texto del dibujo tal como está escrito, y ese texto no incluye el contenido del archivo.
    pub en_tikz: bool,
    /// Además, ese `tikzpicture` está dentro de un entorno `figure` (lo único que se externaliza con `onlyInFigureEnv`).
    pub en_figure: bool,
}

/// Un archivo que una figura lee desde adentro de su `tikzpicture` (`\input`, `\include`, `\includegraphics`, `plot file`, `table`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct DatoDeTikz {
    /// El archivo con el `tikzpicture` (el de `\input{x}`); si el dato entra por un archivo que a su vez entró desde un `tikzpicture`,
    /// sigue siendo el archivo del dibujo.
    pub incluye: String,
    /// El archivo leído, relativo a la raíz y con `/`.
    pub dato: String,
    pub line: u32,
    /// El `tikzpicture` está dentro de un entorno `figure`. Los del template (el encabezado de capítulo con una imagen, por ejemplo)
    /// no lo están, y con `onlyInFigureEnv` no se externalizan: sus datos no invalidan ninguna figura.
    pub en_figure: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Part {
    /// Lo que va en `\includeonly`.
    pub name: String,
    /// Su archivo, si existe.
    pub file: Option<String>,
    pub command: String,
    /// Archivo y línea donde aparece el comando.
    pub source: String,
    pub line: u32,
    /// A part a loader macro brings in with `\input` (`\Ejercicio{slug}`): `\includeonly` cannot leave it out, so the driver
    /// wraps the macro and skips the calls not chosen. `None` for an `\include` part.
    #[serde(skip)]
    pub gate: Option<Gate>,
    /// The other files the same call loads (`soluciones/slug.tex`), which belong to this part too.
    #[serde(skip)]
    pub others: Vec<String>,
}

/// A loader macro's signature, for wrapping it: `arity` mandatory parameters, and `arg` (0-based) is the part's name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Gate {
    pub arity: usize,
    pub arg: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Affects {
    /// El archivo entra en lo que compila el perfil.
    Yes,
    /// Es de una parte que el perfil no incluye.
    OtherPart(String),
    /// No está en el grafo desde la raíz.
    Unrelated,
}

#[derive(Debug, Clone, Default)]
pub struct ProjectIndex {
    pub root_file: String,
    /// Aristas de cada `.tex` leído.
    pub files: BTreeMap<String, Vec<Edge>>,
    pub parts: Vec<Part>,
    /// Todo lo que se alcanza desde la raíz (`.tex`, imágenes, `.bib`).
    pub reachable: BTreeSet<String>,
    /// hijo → quién lo trae por una arista estructural.
    parents: BTreeMap<String, Vec<String>>,
    /// Lo que las figuras leen desde adentro de un `tikzpicture` (ver `DatoDeTikz`), sin repetidos y en orden.
    pub datos_de_tikz: Vec<DatoDeTikz>,
    pub scan_ms: u64,
}

// --- lectura de los comandos -------------------------------------------------------------------------------------------

/// Texto sin lo que sigue a un `%` que no esté escapado (`\%` es un porcentaje; `\\%` es salto de línea y comentario).
pub(crate) fn sin_comentario(linea: &str) -> &str {
    let mut barras = 0;
    for (i, c) in linea.char_indices() {
        if c == '\\' {
            barras += 1;
            continue;
        }
        if c == '%' && barras % 2 == 0 {
            return &linea[..i];
        }
        barras = 0;
    }
    linea
}

struct Crudo {
    comando: String,
    args: Vec<String>,
    linea: u32,
}

fn cantidad_de_argumentos(c: &str) -> usize {
    match c {
        "import" | "subimport" => 2,
        _ => 1,
    }
}

const MAX_ARGUMENTO: usize = 2000;

/// Argumento entre llaves que empieza en `b[i]` (que tiene que ser `{`). Devuelve el contenido y la posición siguiente.
fn argumento(b: &[u8], texto: &str, i: usize) -> Option<(String, usize)> {
    if b.get(i) != Some(&b'{') {
        return None;
    }
    let mut prof = 0;
    let mut j = i;
    while j < b.len() && j - i < MAX_ARGUMENTO {
        match b[j] {
            b'\\' => j += 1, // lo que sigue a una barra no abre ni cierra nada
            b'{' => prof += 1,
            b'}' => {
                prof -= 1;
                if prof == 0 {
                    return Some((texto[i + 1..j].to_string(), j + 1));
                }
            }
            _ => {}
        }
        j += 1;
    }
    None
}

fn saltar_blancos(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

#[cfg(test)]
fn escanear(texto: &str, interesantes: &HashSet<&str>) -> Vec<Crudo> {
    escanear_con(texto, &|n| interesantes.contains(n).then(|| cantidad_de_argumentos(n)))
}

/// A command found by `escanear_con`: its name, its brace arguments and its line.
pub(crate) type Llamada = (String, Vec<String>, u32);

/// Calls to the commands `aridad` knows (it gives how many brace arguments each takes), without comments.
pub(crate) fn llamadas(texto: &str, aridad: &dyn Fn(&str) -> Option<usize>) -> Vec<Llamada> {
    escanear_con(texto, aridad).into_iter().map(|c| (c.comando, c.args, c.linea)).collect()
}

fn escanear_con(texto: &str, aridad: &dyn Fn(&str) -> Option<usize>) -> Vec<Crudo> {
    let limpio: String = texto.lines().map(sin_comentario).collect::<Vec<_>>().join("\n");
    let b = limpio.as_bytes();
    let mut out = Vec::new();
    let (mut i, mut linea) = (0usize, 1u32);
    while i < b.len() {
        match b[i] {
            b'\n' => {
                linea += 1;
                i += 1;
            }
            b'\\' => {
                if i + 1 >= b.len() || !b[i + 1].is_ascii_alphabetic() {
                    i += 2; // `\\`, `\%`, `\{`...
                    continue;
                }
                let ini = i + 1;
                let mut j = ini;
                while j < b.len() && b[j].is_ascii_alphabetic() {
                    j += 1;
                }
                let nombre = &limpio[ini..j];
                i = j;
                let Some(n_args) = aridad(nombre) else { continue };
                let mut k = saltar_blancos(b, j);
                if b.get(k) == Some(&b'*') {
                    k += 1;
                }
                // Argumentos opcionales: `\includegraphics[width=3cm]{x}`.
                loop {
                    k = saltar_blancos(b, k);
                    if b.get(k) != Some(&b'[') {
                        break;
                    }
                    match limpio[k..].find(']') {
                        Some(f) if f < MAX_ARGUMENTO => k += f + 1,
                        _ => break,
                    }
                }
                let mut args = Vec::new();
                for _ in 0..n_args {
                    k = saltar_blancos(b, k);
                    match argumento(b, &limpio, k) {
                        Some((a, sig)) => {
                            args.push(a);
                            k = sig;
                        }
                        None => break,
                    }
                }
                if args.len() == n_args {
                    out.push(Crudo { comando: nombre.to_string(), args, linea });
                }
            }
            _ => i += 1,
        }
    }
    out
}

/// Los archivos que leen `plot file {x}`, `plot[...] file {x}` y `table[...] {x}` (pgfplots) dentro de cada `tikzpicture` de un texto
/// ya sin comentarios, con su línea.
fn datos_de_plot(limpio: &str) -> Vec<(String, u32, bool)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"(?:plot\s*(?:\[[^\]]*\])?\s*file|\btable)\s*(?:\[[^\]]*\])?\s*\{\s*([^}\s]+)\s*\}").expect("patrón válido"));
    let mut out = Vec::new();
    for env in ["tikzpicture", "circuitikz"] {
        let (abre, cierra) = (format!("\\begin{{{env}}}"), format!("\\end{{{env}}}"));
        let mut pos = 0;
        while let Some(i) = limpio[pos..].find(&abre) {
            let ini = pos + i;
            let fin = limpio[ini..].find(&cierra).map_or(limpio.len(), |j| ini + j);
            for c in re.captures_iter(&limpio[ini..fin]) {
                if let Some(m) = c.get(1) {
                    let antes = &limpio[..ini];
                    let en_figure = antes.matches("\\begin{figure").count() > antes.matches("\\end{figure").count();
                    out.push((m.as_str().to_string(), 1 + limpio[..ini + m.start()].matches('\n').count() as u32, en_figure));
                }
            }
            pos = fin.max(ini + 1);
        }
    }
    out
}

// --- resolución de rutas -----------------------------------------------------------------------------------------------

fn normalizar(raw: &str) -> Option<String> {
    let s = raw.trim().trim_matches('"').trim().replace('\\', "/");
    let s = s.strip_prefix("./").unwrap_or(&s).to_string();
    if s.is_empty() || s.starts_with('/') || s.contains(':') || s.split('/').any(|c| c == "..") {
        return None;
    }
    Some(s)
}

fn existe(root: &Path, rel: &str) -> bool {
    root.join(rel).is_file()
}

fn resolver_tex(root: &Path, raw: &str) -> Option<String> {
    let base = normalizar(raw)?;
    let con_ext = if base.to_lowercase().ends_with(".tex") { base.clone() } else { format!("{base}.tex") };
    [con_ext, base].into_iter().find(|c| existe(root, c))
}

fn resolver_imagen(root: &Path, raw: &str) -> Option<String> {
    let base = normalizar(raw)?;
    std::iter::once(base.clone())
        .chain(["pdf", "png", "jpg", "jpeg", "eps", "svg"].iter().map(|e| format!("{base}.{e}")))
        .find(|c| existe(root, c))
}

fn resolver_bib(root: &Path, raw: &str) -> Option<String> {
    let base = normalizar(raw)?;
    let c = if base.to_lowercase().ends_with(".bib") { base } else { format!("{base}.bib") };
    existe(root, &c).then_some(c)
}

/// Nombre de la parte tal como lo lleva `\includeonly`: el argumento, con `/` y sin la extensión `.tex`.
fn nombre_de_parte(raw: &str) -> Option<String> {
    let n = normalizar(raw)?;
    Some(n.strip_suffix(".tex").map(str::to_string).unwrap_or(n))
}

fn leer_texto(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let sin_bom = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Some(String::from_utf8_lossy(sin_bom).into_owned())
}

// --- el índice ---------------------------------------------------------------------------------------------------------

/// Loader macros by name (see `macros`).
type Loaders = BTreeMap<String, Vec<PathTemplate>>;

/// What every file of one walk is read with.
struct Contexto<'a> {
    /// The commands read, with how many brace arguments each takes.
    interesantes: HashMap<&'a str, usize>,
    /// `parts.commands`.
    cmds: HashSet<&'a str>,
    loaders: &'a Loaders,
    /// Loaders whose parameters are all mandatory, with how many: their calls in the body can be parts.
    aridades: &'a BTreeMap<String, usize>,
}

impl ProjectIndex {
    /// Recorre el proyecto desde `root_file`. Un archivo que no se puede leer se salta: el índice es una ayuda, no
    /// puede impedir abrir ni compilar.
    pub fn build(root: &Path, root_file: &str, commands: &[String]) -> ProjectIndex {
        let t0 = Instant::now();
        // User macros that load files (`\Ejercicio{slug}` → `\input{ejercicios/slug}`) are only known after reading their
        // definitions, which are in files the graph reaches: walk, read the definitions, and walk again while that finds more.
        let mut loaders = Loaders::new();
        let mut aridades = BTreeMap::new();
        let mut ix = Self::walk(root, root_file, commands, &loaders, &aridades);
        for _ in 0..3 {
            let mut m = Macros::default();
            for rel in ix.files.keys() {
                if let Some(t) = leer_texto(&root.join(rel)) {
                    m.read(&t);
                }
            }
            let found: Loaders = m
                .loaders()
                .into_iter()
                // a call in a document is a name of letters; a part command that includes its argument as is (`\Capitulo`) already works
                .filter(|(n, ts)| n.bytes().all(|c| c.is_ascii_alphabetic()) && !(commands.contains(n) && ts.iter().all(|t| t.path == "{}")))
                .collect();
            if found == loaders {
                break;
            }
            aridades = found.keys().filter_map(|n| Some((n.clone(), m.mandatory_arity(n)?))).collect();
            loaders = found;
            ix = Self::walk(root, root_file, commands, &loaders, &aridades);
        }
        ix.scan_ms = t0.elapsed().as_millis() as u64;
        ix
    }

    fn walk(root: &Path, root_file: &str, commands: &[String], loaders: &Loaders, aridades: &BTreeMap<String, usize>) -> ProjectIndex {
        let mut ix = ProjectIndex { root_file: root_file.to_string(), ..Default::default() };
        // `begin` y `end` sólo se miran para llevar la cuenta de los `tikzpicture` abiertos.
        let mut interesantes: HashMap<&str, usize> =
            ["input", "include", "subfile", "import", "subimport", "includegraphics", "bibliography", "addbibresource", "begin", "end"].into_iter().map(|c| (c, cantidad_de_argumentos(c))).collect();
        interesantes.extend(commands.iter().map(|c| (c.as_str(), 1)));
        for (name, ts) in loaders {
            let n = ts.iter().map(|t| t.arg + 1).max().unwrap_or(1);
            let e = interesantes.entry(name.as_str()).or_insert(n);
            *e = (*e).max(n);
        }
        let cmds: HashSet<&str> = commands.iter().map(String::as_str).collect();
        let ctx = Contexto { interesantes, cmds, loaders, aridades };
        let mut visitados = HashSet::new();
        ix.visitar(root, root_file, false, false, None, "", &ctx, &mut visitados);
        ix.datos_de_tikz.sort();
        ix.datos_de_tikz.dedup();
        ix
    }

    /// `dentro`: el archivo con el `tikzpicture` desde el que se llegó a éste, y si ese dibujo está en un `figure` (todo lo que éste
    /// incluya es un dato de ese dibujo).
    #[allow(clippy::too_many_arguments)]
    /// `base`: the folder an `\import` set for this file (empty for none): with the `import` package, an `\input` inside an imported
    /// file is read from the imported folder first.
    /// `cuerpo`: this file is read after `\begin{document}`.
    #[allow(clippy::too_many_arguments)]
    fn visitar(&mut self, root: &Path, rel: &str, en_parte: bool, cuerpo: bool, dentro: Option<(&str, bool)>, base: &str, ctx: &Contexto, vistos: &mut HashSet<String>) {
        if !vistos.insert(rel.to_string()) {
            return;
        }
        self.reachable.insert(rel.to_string());
        let Some(texto) = leer_texto(&root.join(rel)) else { return };
        let mut aristas = Vec::new();
        // whether each edge is in the document body, for what its file reads
        let mut en_cuerpo: Vec<bool> = Vec::new();
        let mut cuerpo_aqui = cuerpo;
        // the edges of loader calls that are parts: what they load is in that part
        let mut de_cargador: HashSet<usize> = HashSet::new();
        let aridad = |n: &str| ctx.interesantes.get(n).copied();
        // Cuántos `\begin{tikzpicture}` hay abiertos en este punto del archivo (sin contar los comentarios: `escanear` los saca).
        let mut tikz_abiertos: u32 = 0;
        let mut figure_abiertos: u32 = 0;
        for c in escanear_con(&texto, &aridad) {
            if matches!(c.comando.as_str(), "begin" | "end") {
                let abre = c.comando == "begin";
                let cuenta = |n: u32| if abre { n + 1 } else { n.saturating_sub(1) };
                match c.args[0].trim() {
                    "tikzpicture" | "circuitikz" => tikz_abiertos = cuenta(tikz_abiertos),
                    "figure" | "figure*" => figure_abiertos = cuenta(figure_abiertos),
                    "document" if abre => cuerpo_aqui = true,
                    _ => {}
                }
                continue;
            }
            let en_tikz = tikz_abiertos > 0 || dentro.is_some();
            let en_figure = en_tikz && (figure_abiertos > 0 || dentro.is_some_and(|d| d.1));
            if let Some(ts) = ctx.loaders.get(c.comando.as_str()) {
                // A loader macro: one edge per path it builds. In the body it is like a part command (its files are not
                // the preamble, which `formato` fingerprints); before `\begin{document}` it is an `\input`.
                // A call in the body that only `\input`s is a part of its own, named by its argument, so a profile can choose it.
                let gate = match ctx.aridades.get(c.comando.as_str()) {
                    Some(&arity) if cuerpo_aqui && !en_parte && !ctx.cmds.contains(c.comando.as_str()) && ts.iter().all(|t| t.kind == LoadKind::Input) => {
                        Some(Gate { arity, arg: ts[0].arg })
                    }
                    _ => None,
                };
                let nombre = gate
                    .and_then(|g| c.args.get(g.arg))
                    .map(|a| a.trim().to_string())
                    .filter(|a| !a.is_empty() && a.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/')));
                let desde = aristas.len();
                for (n, t) in ts.iter().enumerate() {
                    let Some(arg) = c.args.get(t.arg) else { continue };
                    let raw = t.path.replace("{}", arg.trim().trim_matches('"').trim());
                    if arg.trim().is_empty() || raw.contains('#') || raw.contains('\\') {
                        continue;
                    }
                    let kind = match t.kind {
                        _ if ctx.cmds.contains(c.comando.as_str()) => EdgeKind::Part,
                        LoadKind::Include => EdgeKind::Include,
                        LoadKind::Subfile => EdgeKind::Subfile,
                        LoadKind::Input if cuerpo_aqui => EdgeKind::Part,
                        LoadKind::Input => EdgeKind::Input,
                    };
                    let target = if !base.is_empty() { resolver_tex(root, &format!("{base}/{raw}")).or_else(|| resolver_tex(root, &raw)) } else { resolver_tex(root, &raw) };
                    // a later path that names no file (`sol/x` when there is no solution) adds nothing
                    if target.is_none() && n > 0 {
                        continue;
                    }
                    aristas.push(Edge { kind, command: c.comando.clone(), raw, target, line: c.linea, en_tikz, en_figure });
                    en_cuerpo.push(cuerpo_aqui);
                }
                if let Some(name) = nombre {
                    let files: Vec<String> = aristas[desde..].iter().filter_map(|e| e.target.clone()).collect();
                    if !files.is_empty() && !self.parts.iter().any(|p| p.name == name) {
                        de_cargador.extend(desde..aristas.len());
                        self.parts.push(Part { name, file: Some(files[0].clone()), command: c.comando.clone(), source: rel.to_string(), line: c.linea, gate, others: files[1..].to_vec() });
                    }
                }
                continue;
            }
            let (kind, args): (EdgeKind, Vec<String>) = match c.comando.as_str() {
                "includegraphics" => (EdgeKind::Graphics, c.args),
                "bibliography" => (EdgeKind::Bib, c.args[0].split(',').map(|s| s.trim().to_string()).collect()),
                "addbibresource" => (EdgeKind::Bib, c.args),
                "import" => (EdgeKind::Import, vec![format!("{}/{}", c.args[0].trim().trim_end_matches('/'), c.args[1].trim())]),
                // `\subimport` is relative to the file it is written in
                "subimport" => {
                    let aqui = rel.rsplit_once('/').map_or("", |(d, _)| d);
                    let dir = c.args[0].trim().trim_end_matches('/');
                    let dir = if aqui.is_empty() { dir.to_string() } else if dir.is_empty() { aqui.to_string() } else { format!("{aqui}/{dir}") };
                    (EdgeKind::Import, vec![if dir.is_empty() { c.args[1].trim().to_string() } else { format!("{dir}/{}", c.args[1].trim()) }])
                }
                "input" => (EdgeKind::Input, c.args),
                "include" => (EdgeKind::Include, c.args),
                "subfile" => (EdgeKind::Subfile, c.args),
                _ => (EdgeKind::Part, c.args),
            };
            for raw in args {
                // `\input{#1}` y compañía: parámetros de macro, no archivos.
                if raw.is_empty() || raw.contains('#') || raw.contains('\\') {
                    continue;
                }
                let raw = raw.trim().trim_matches('"').to_string();
                let target = match kind {
                    EdgeKind::Graphics => resolver_imagen(root, &raw),
                    EdgeKind::Bib => resolver_bib(root, &raw),
                    // inside an imported file, its folder first and then the project's top
                    _ if !base.is_empty() && !matches!(kind, EdgeKind::Import) => resolver_tex(root, &format!("{base}/{raw}")).or_else(|| resolver_tex(root, &raw)),
                    _ => resolver_tex(root, &raw),
                };
                aristas.push(Edge { kind, command: c.comando.clone(), raw, target, line: c.linea, en_tikz, en_figure });
                en_cuerpo.push(cuerpo_aqui);
            }
        }
        // `plot file {x}` y `table {x}` no son comandos con el archivo entre llaves: se buscan dentro de cada `tikzpicture`.
        if texto.contains("tikzpicture") || texto.contains("circuitikz") {
            let limpio: String = texto.lines().map(sin_comentario).collect::<Vec<_>>().join("\n");
            for (raw, linea, en_figure) in datos_de_plot(&limpio) {
                if let Some(dato) = normalizar(&raw).filter(|d| existe(root, d)) {
                    let (incluye, heredada) = dentro.map_or((rel, false), |d| (d.0, d.1));
                    self.datos_de_tikz.push(DatoDeTikz { incluye: incluye.to_string(), dato, line: linea, en_figure: en_figure || heredada });
                }
            }
        }
        self.files.insert(rel.to_string(), aristas.clone());
        for (i, (e, cuerpo_e)) in aristas.into_iter().zip(en_cuerpo).enumerate() {
            if let Some(t) = &e.target {
                self.reachable.insert(t.clone());
                if e.kind.estructural() {
                    self.parents.entry(t.clone()).or_default().push(rel.to_string());
                }
                if e.en_tikz && e.kind != EdgeKind::Bib {
                    self.datos_de_tikz.push(DatoDeTikz { incluye: dentro.map_or(rel, |d| d.0).to_string(), dato: t.clone(), line: e.line, en_figure: e.en_figure });
                }
            }
            let es_parte = (ctx.cmds.contains(e.command.as_str()) && !en_parte) || de_cargador.contains(&i);
            if es_parte && !de_cargador.contains(&i) {
                if let Some(name) = nombre_de_parte(&e.raw) {
                    // La misma parte dos veces (por ejemplo en un `\if`) cuenta una.
                    if !self.parts.iter().any(|p| p.name == name) {
                        self.parts.push(Part { name, file: e.target.clone(), command: e.command.clone(), source: rel.to_string(), line: e.line, gate: None, others: vec![] });
                    }
                }
            }
            if let (true, Some(t)) = (e.kind.estructural(), &e.target) {
                if t.to_lowercase().ends_with(".tex") {
                    let desde = if e.en_tikz { Some((dentro.map_or(rel, |d| d.0), e.en_figure)) } else { None };
                    // an imported file sets its folder for what it inputs; anything else passes the current one on
                    let carpeta = if e.kind == EdgeKind::Import { t.rsplit_once('/').map_or("", |(d, _)| d).to_string() } else { base.to_string() };
                    self.visitar(root, t, en_parte || es_parte, cuerpo_e, desde, &carpeta, ctx, vistos);
                }
            }
        }
    }

    /// Lo que las figuras leen desde adentro de un `tikzpicture`: con `solo_en_figure` (la opción `onlyInFigureEnv` del cache) sólo los de
    /// un `tikzpicture` dentro de un `figure`, que es lo único que se externaliza.
    pub fn datos_de_figuras(&self, solo_en_figure: bool) -> impl Iterator<Item = &DatoDeTikz> {
        self.datos_de_tikz.iter().filter(move |d| d.en_figure || !solo_en_figure)
    }

    /// Los archivos de `datos_de_figuras`, sin repetir (para la huella de las figuras).
    pub fn archivos_de_datos(&self, solo_en_figure: bool) -> BTreeSet<String> {
        self.datos_de_figuras(solo_en_figure).map(|d| d.dato.clone()).collect()
    }

    /// Where `rel` enters the document: the line of each load from the root down to it (`[12, 40]` is line 40 of the file that
    /// line 12 of the root loads). Comparing `position(file) ++ [line]` orders anything in the project in document order.
    pub fn position(&self, rel: &str) -> Vec<u32> {
        let mut out = Vec::new();
        let mut f = rel.to_string();
        let mut vistos = HashSet::new();
        while f != self.root_file && vistos.insert(f.clone()) {
            let Some(padre) = self.parents.get(&f).and_then(|ps| ps.first()).cloned() else { break };
            let linea = self.files.get(&padre).and_then(|es| es.iter().find(|e| e.target.as_deref() == Some(f.as_str()))).map_or(0, |e| e.line);
            out.push(linea);
            f = padre;
        }
        out.reverse();
        out
    }

    /// The loader macros whose calls are parts, once each, for the driver to wrap.
    pub fn loader_gates(&self) -> Vec<(String, Gate)> {
        let mut out: Vec<(String, Gate)> = Vec::new();
        for p in &self.parts {
            if let Some(g) = p.gate {
                if !out.iter().any(|(c, _)| *c == p.command) {
                    out.push((p.command.clone(), g));
                }
            }
        }
        out
    }

    pub fn part_names(&self) -> Vec<String> {
        self.parts.iter().map(|p| p.name.clone()).collect()
    }

    /// Índice de la parte a la que pertenece `rel`: ella misma si lo es, o la parte que la trae (recursivo, la más
    /// cercana). `None` para lo que no es de ninguna parte (el preámbulo, `libro_cuerpo.tex`, una portada).
    pub fn part_of(&self, rel: &str) -> Option<usize> {
        let mut cola = vec![rel.to_string()];
        let mut vistos = HashSet::new();
        while !cola.is_empty() {
            let mut siguiente = Vec::new();
            for f in cola {
                if !vistos.insert(f.clone()) {
                    continue;
                }
                if let Some(i) = self.parts.iter().position(|p| p.file.as_deref() == Some(f.as_str()) || p.others.contains(&f)) {
                    return Some(i);
                }
                if let Some(ps) = self.parents.get(&f) {
                    siguiente.extend(ps.iter().cloned());
                }
            }
            cola = siguiente;
        }
        None
    }

    /// Si guardar `rel` cambia lo que compila un perfil que incluye `seleccion` (`None` = todas las partes).
    pub fn affects(&self, rel: &str, seleccion: Option<&[String]>) -> Affects {
        if !self.reachable.contains(rel) {
            return Affects::Unrelated;
        }
        match (self.part_of(rel), seleccion) {
            (None, _) | (Some(_), None) => Affects::Yes,
            (Some(i), Some(sel)) => {
                if sel.iter().any(|s| *s == self.parts[i].name) {
                    Affects::Yes
                } else {
                    Affects::OtherPart(self.parts[i].name.clone())
                }
            }
        }
    }

    /// Carpetas donde `\include` escribe sus `.aux` dentro del directorio de salida (`Secciones`, `Capítulos/Desarrollo`).
    /// MiKTeX las crea solo; TeX Live no (S1): se crean antes por portabilidad.
    pub fn include_dirs(&self, commands: &[String]) -> BTreeSet<String> {
        let mut dirs = BTreeSet::new();
        let nombres = self
            .files
            .values()
            .flatten()
            .filter(|e| e.kind == EdgeKind::Include || commands.iter().any(|c| *c == e.command))
            .filter_map(|e| nombre_de_parte(&e.raw));
        for n in nombres {
            if let Some((dir, _)) = n.rsplit_once('/') {
                dirs.insert(dir.to_string());
            }
        }
        dirs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_loader_macro_brings_its_files_into_the_body_not_the_preamble() {
        let d = tempfile::tempdir().unwrap();
        let w = |rel: &str, t: &str| {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w("main.tex", "\\input{defs}\n\\Load{early}\n\\begin{document}\n\\Ex{a}\n\\Ex{missing}\n\\end{document}\n");
        w("defs.tex", "\\makeatletter\n\\newcommand{\\Ex}[1]{\\ex@go{1}{#1}}\n\\def\\ex@go#1#2{\\input{ex/#2}\\IfFileExists{sol/#2.tex}{\\input{sol/#2}}{}}\n\\newcommand{\\Load}[1]{\\input{sty/#1}}\n\\makeatother\n");
        w("ex/a.tex", "\\includegraphics{ex/a-fig}\n");
        w("ex/a-fig.pdf", "%PDF");
        w("sol/a.tex", "Solution.\n");
        w("sty/early.tex", "\\relax\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include"]));
        for f in ["ex/a.tex", "ex/a-fig.pdf", "sol/a.tex", "sty/early.tex"] {
            assert!(ix.reachable.contains(f), "{f} not reached");
        }
        let main = &ix.files["main.tex"];
        let kinds: Vec<_> = main.iter().filter(|e| e.command != "input").map(|e| (e.command.as_str(), e.kind, e.raw.as_str(), e.target.is_some())).collect();
        assert_eq!(
            kinds,
            [("Load", EdgeKind::Input, "sty/early", true), ("Ex", EdgeKind::Part, "ex/a", true), ("Ex", EdgeKind::Part, "sol/a", true), ("Ex", EdgeKind::Part, "ex/missing", false)]
        );
        // each call in the body is a part named by its argument; one that loads no file is not
        let partes: Vec<_> = ix.parts.iter().map(|p| (p.name.as_str(), p.file.as_deref(), p.others.clone(), p.gate)).collect();
        assert_eq!(partes, [("a", Some("ex/a.tex"), vec!["sol/a.tex".to_string()], Some(Gate { arity: 1, arg: 0 }))]);
        assert_eq!(ix.loader_gates(), [("Ex".to_string(), Gate { arity: 1, arg: 0 })]);
        assert_eq!(ix.affects("sol/a.tex", Some(&[])), Affects::OtherPart("a".into()));
        let pre = crate::formato::archivos_del_preambulo(&ix);
        assert!(pre.contains("sty/early.tex") && !pre.contains("ex/a.tex"));
    }

    fn cmds(c: &[&str]) -> Vec<String> {
        c.iter().map(|s| s.to_string()).collect()
    }

    fn escanear_todo(t: &str) -> Vec<(String, Vec<String>, u32)> {
        let i: HashSet<&str> = ["input", "include", "import", "includegraphics", "Capitulo"].into_iter().collect();
        escanear(t, &i).into_iter().map(|c| (c.comando, c.args, c.linea)).collect()
    }

    #[test]
    fn los_comentarios_no_cuentan_pero_el_porcentaje_escapado_si_es_texto() {
        assert_eq!(sin_comentario("a % b"), "a ");
        assert_eq!(sin_comentario("100\\% seguro"), "100\\% seguro");
        assert_eq!(sin_comentario("\\\\% comentario"), "\\\\");
        let r = escanear_todo("%\\include{a}\n\\input{b} % \\input{c}\n\\input{d}\\%\\input{e}");
        let args: Vec<_> = r.iter().map(|x| x.1[0].as_str()).collect();
        assert_eq!(args, ["b", "d", "e"]);
    }

    #[test]
    fn lee_argumentos_con_espacios_tildes_llaves_y_opciones() {
        let r = escanear_todo(
            "\\include{Capítulos/Introducción general}\n\\input {x}\n\\includegraphics[width=3cm, scale=1]{img/a b}\n\\Capitulo*{Secciones/Uno}\n\\import{dir/}{f}",
        );
        assert_eq!(r[0].1, ["Capítulos/Introducción general"]);
        assert_eq!(r[1].1, ["x"]);
        assert_eq!(r[2].1, ["img/a b"]);
        assert_eq!((r[3].0.as_str(), r[3].1[0].as_str(), r[3].2), ("Capitulo", "Secciones/Uno", 4));
        assert_eq!(r[4].1, ["dir/", "f"]);
        // Llaves anidadas y un comando sin argumento no rompen nada.
        let r = escanear_todo("\\input{a{b}c}\n\\input\n\\include{z}");
        assert_eq!(r.iter().map(|x| x.1[0].as_str()).collect::<Vec<_>>(), ["a{b}c", "z"]);
    }

    #[test]
    fn dos_barras_y_comandos_parecidos_no_se_confunden() {
        // `\includeonly` y `\inputencoding` no son `\include` ni `\input`.
        let r = escanear_todo("\\includeonly{a}\n\\inputencoding{utf8}\n\\\\input{no}\n\\input{si}");
        assert_eq!(r.iter().map(|x| x.1[0].as_str()).collect::<Vec<_>>(), ["si"]);
    }

    fn proyecto(archivos: &[(&str, &str)]) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for (rel, texto) in archivos {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, texto).unwrap();
        }
        d
    }

    /// El libro en chiquito: la raíz trae `libro_cuerpo.tex` por `\input`, y ahí están los `\Capitulo`.
    fn libro_chico() -> tempfile::TempDir {
        proyecto(&[
            ("main.tex", "\\documentclass{book}\n\\input{structure}\n\\begin{document}\n\\input{libro_cuerpo}\n\\end{document}\n"),
            ("structure.tex", "\\newcommand{\\Capitulo}[1]{\\clearpage\\include{#1}}\n\\newcommand{\\Otra}[1]{\\input{#1}}\n"),
            (
                "libro_cuerpo.tex",
                "\\Capitulo{Secciones/Uno}\n\\Capitulo{Secciones/Dos}\n%\\Capitulo{Secciones/Comentado}\n\\input{Secciones/Prueba}\n\\Capitulo{Secciones/Tres}\n",
            ),
            ("Secciones/Uno.tex", "uno \\input{Secciones/fig_a} \\includegraphics{img/foto}\n\\cite{x}\n"),
            ("Secciones/fig_a.tex", "figura\n"),
            ("Secciones/Dos.tex", "dos \\input{Secciones/Anexo}\n"),
            ("Secciones/Anexo.tex", "anexo \\input{Secciones/fig_a}\n"),
            ("Secciones/Tres.tex", "tres\n"),
            ("Secciones/Prueba.tex", "prueba\n"),
            ("Secciones/Suelto.tex", "nadie lo incluye\n"),
            ("img/foto.png", "x"),
        ])
    }

    #[test]
    fn las_partes_salen_en_orden_aunque_esten_en_un_archivo_que_entra_por_input() {
        let d = libro_chico();
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include", "Capitulo"]));
        assert_eq!(ix.part_names(), ["Secciones/Uno", "Secciones/Dos", "Secciones/Tres"], "sin el comentado ni el \\input suelto");
        assert_eq!(ix.parts[0].file.as_deref(), Some("Secciones/Uno.tex"));
        assert_eq!((ix.parts[0].source.as_str(), ix.parts[0].line), ("libro_cuerpo.tex", 1));
        assert_eq!(ix.parts[0].command, "Capitulo");
    }

    #[test]
    fn sin_los_comandos_de_parte_el_capitulo_es_un_input_mas() {
        let d = libro_chico();
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include"]));
        assert!(ix.parts.is_empty(), "`\\include{{#1}}` de la definición de \\Capitulo es un parámetro, no una parte");
    }

    #[test]
    fn la_parte_de_un_archivo_es_ella_misma_o_la_que_lo_trae() {
        let d = libro_chico();
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include", "Capitulo"]));
        let nombre = |rel: &str| ix.part_of(rel).map(|i| ix.parts[i].name.clone());
        assert_eq!(nombre("Secciones/Uno.tex").as_deref(), Some("Secciones/Uno"));
        assert_eq!(nombre("Secciones/fig_a.tex").as_deref(), Some("Secciones/Uno"), "una figura va con el capítulo que la trae");
        assert_eq!(nombre("Secciones/Anexo.tex").as_deref(), Some("Secciones/Dos"), "recursivo: Dos trae a Anexo");
        assert_eq!(nombre("libro_cuerpo.tex"), None);
        assert_eq!(nombre("structure.tex"), None);
        assert_eq!(nombre("Secciones/Prueba.tex"), None, "un \\input fuera de las partes es global");
        assert_eq!(nombre("Secciones/Suelto.tex"), None);
    }

    #[test]
    fn que_archivos_cambian_lo_que_compila_un_perfil() {
        let d = libro_chico();
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include", "Capitulo"]));
        let sel = vec!["Secciones/Uno".to_string()];
        assert_eq!(ix.affects("Secciones/Uno.tex", Some(&sel)), Affects::Yes);
        assert_eq!(ix.affects("Secciones/fig_a.tex", Some(&sel)), Affects::Yes);
        assert_eq!(ix.affects("Secciones/Dos.tex", Some(&sel)), Affects::OtherPart("Secciones/Dos".into()));
        assert_eq!(ix.affects("structure.tex", Some(&sel)), Affects::Yes, "el preámbulo afecta a todo");
        assert_eq!(ix.affects("Secciones/Dos.tex", None), Affects::Yes, "perfil con todas las partes");
        assert_eq!(ix.affects("Secciones/Suelto.tex", None), Affects::Unrelated);
        assert_eq!(ix.affects("no-existe.tex", None), Affects::Unrelated);
    }

    #[test]
    fn las_inclusiones_dentro_de_un_tikzpicture_se_marcan_y_se_siguen_por_los_archivos_que_entran() {
        let d = proyecto(&[
            ("main.tex", "\\input{cap}\n"),
            (
                "cap.tex",
                "\\input{antes}\n% \\begin{tikzpicture}\n\\begin{figure}\n\\begin{tikzpicture}[scale=2]\n  \\input{engranaje}\n  % \\input{comentado}\n  \\node{\\includegraphics{img/foto}};\n  \\draw plot file {datos/curva.dat};\n  \\addplot table[x=a] {datos/tabla.csv};\n\\end{tikzpicture}\n\\input{despues}\n\\end{figure}\n\\input{despues2}\n\\begin{tikzpicture}[remember picture,overlay]\\node{\\includegraphics{img/marca}};\\end{tikzpicture}\n",
            ),
            ("img/marca.png", "m"),
            ("antes.tex", "a\n"),
            ("engranaje.tex", "\\draw (0,0); \\input{anidado}\n"),
            ("anidado.tex", "\\draw (1,1);\n"),
            ("comentado.tex", "c\n"),
            ("despues.tex", "d\n"),
            ("despues2.tex", "d2\n"),
            ("img/foto.png", "x"),
            ("datos/curva.dat", "0 0\n1 1\n"),
            ("datos/tabla.csv", "a,b\n1,2\n"),
        ]);
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&[]));
        let en_tikz: Vec<(&str, bool)> = ix.files["cap.tex"].iter().map(|e| (e.raw.as_str(), e.en_tikz)).collect();
        assert_eq!(
            en_tikz,
            [("antes", false), ("engranaje", true), ("img/foto", true), ("despues", false), ("despues2", false), ("img/marca", true)],
            "el `\\begin{{tikzpicture}}` comentado no abre nada y el `\\input` comentado no existe"
        );
        assert!(ix.files["engranaje.tex"][0].en_tikz, "lo que incluye un archivo que entra desde un tikzpicture también es del dibujo");
        let datos: Vec<(&str, &str)> = ix.datos_de_tikz.iter().map(|d| (d.incluye.as_str(), d.dato.as_str())).collect();
        assert_eq!(
            datos,
            [
                ("cap.tex", "anidado.tex"),
                ("cap.tex", "datos/curva.dat"),
                ("cap.tex", "datos/tabla.csv"),
                ("cap.tex", "engranaje.tex"),
                ("cap.tex", "img/foto.png"),
                ("cap.tex", "img/marca.png")
            ],
            "el dibujo es el archivo del `tikzpicture`, aunque el dato entre por otro archivo"
        );
        assert!(!ix.reachable.contains("datos/curva.dat"), "los datos de `plot file` no son archivos del grafo");
        assert_eq!(ix.archivos_de_datos(false).len(), 6);
        // Con `onlyInFigureEnv` sólo cuentan los de un `tikzpicture` dentro de un `figure`: la marca de agua del template no.
        let en_figure = ix.archivos_de_datos(true);
        assert_eq!(en_figure.len(), 5);
        assert!(!en_figure.contains("img/marca.png") && en_figure.contains("anidado.tex") && en_figure.contains("datos/tabla.csv"), "{en_figure:?}");
    }

    #[test]
    fn el_grafo_resuelve_imagenes_y_extensiones_omitidas() {
        let d = libro_chico();
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["Capitulo"]));
        let uno = &ix.files["Secciones/Uno.tex"];
        let img = uno.iter().find(|e| e.kind == EdgeKind::Graphics).unwrap();
        assert_eq!(img.target.as_deref(), Some("img/foto.png"));
        assert!(ix.reachable.contains("img/foto.png"));
        assert!(!ix.reachable.contains("Secciones/Suelto.tex"));
    }

    #[test]
    fn las_carpetas_de_include_salen_de_los_nombres_de_las_partes() {
        let d = libro_chico();
        let c = cmds(&["include", "Capitulo"]);
        let ix = ProjectIndex::build(d.path(), "main.tex", &c);
        assert_eq!(ix.include_dirs(&c).into_iter().collect::<Vec<_>>(), ["Secciones"]);
        let d2 = proyecto(&[
            ("main.tex", "\\documentclass{book}\n\\include{Capítulos/Uno}\n\\include{Capítulos/Desarrollo/Dos}\n\\include{plano}\n"),
            ("Capítulos/Uno.tex", ""),
            ("Capítulos/Desarrollo/Dos.tex", ""),
            ("plano.tex", ""),
        ]);
        let c = cmds(&["include"]);
        let ix = ProjectIndex::build(d2.path(), "main.tex", &c);
        assert_eq!(ix.part_names(), ["Capítulos/Uno", "Capítulos/Desarrollo/Dos", "plano"]);
        assert_eq!(ix.include_dirs(&c).into_iter().collect::<Vec<_>>(), ["Capítulos", "Capítulos/Desarrollo"]);
    }

    #[test]
    fn los_ciclos_y_los_archivos_ausentes_no_cuelgan_ni_rompen() {
        let d = proyecto(&[("a.tex", "\\input{b}\n\\input{falta}\n"), ("b.tex", "\\input{a}\n\\input{../afuera}\n")]);
        let ix = ProjectIndex::build(d.path(), "a.tex", &cmds(&["include"]));
        assert!(ix.reachable.contains("b.tex"));
        let faltante = ix.files["a.tex"].iter().find(|e| e.raw == "falta").unwrap();
        assert!(faltante.target.is_none());
        assert!(ix.files["b.tex"].iter().find(|e| e.raw == "../afuera").unwrap().target.is_none(), "`..` no se resuelve");
        let sin_raiz = ProjectIndex::build(d.path(), "no-existe.tex", &cmds(&["include"]));
        assert!(sin_raiz.parts.is_empty());
    }

    #[test]
    fn un_bom_al_principio_no_estorba() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.tex"), b"\xEF\xBB\xBF\\include{b}\n").unwrap();
        std::fs::write(d.path().join("b.tex"), "x").unwrap();
        let ix = ProjectIndex::build(d.path(), "a.tex", &cmds(&["include"]));
        assert_eq!(ix.part_names(), ["b"]);
    }
}
