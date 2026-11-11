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
    /// What the app calls it, in Contents and in the profiles alike (`etiquetas::de_parte`): its title when the file gives one.
    pub label: String,
    /// The part this one is inside, when parts nest one level: an exercise a guide's file loads (`\exercise{slug}`) is a part of
    /// its own inside the guide's `\subfile` part. Choosing it brings its guide in; choosing the guide brings all of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// The other parts it is inside: a solutions book that loads its guide's exercise list holds the same exercises.
    /// Choosing one of them brings the exercise in, as choosing its guide does.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<String>,
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
    /// The project's own classes and packages the document loads (`style/tc2-guide.cls`), in the order they are found. They
    /// are not part of the document, but the macros they define say what the document's commands load and print.
    pub packages: Vec<String>,
    pub scan_ms: u64,
    /// What the index was read from, to tell whether it still holds (`vigente`).
    pub huella: Huella,
}

/// The size and time of each file the index read, and the time of each folder it looked in. A folder's time moves when a file
/// is created, removed or renamed in it, so a missing `\input` that appears, or a new `.sty`, changes it too.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Huella {
    comandos: Vec<String>,
    sellos: Vec<(std::path::PathBuf, Option<(u64, std::time::SystemTime)>)>,
}

fn sello(p: &Path) -> Option<(u64, std::time::SystemTime)> {
    let m = std::fs::metadata(p).ok()?;
    Some((if m.is_dir() { 0 } else { m.len() }, m.modified().ok()?))
}

// --- lectura de los comandos -------------------------------------------------------------------------------------------

/// For each line of a text without comments, the switch whose true branch it is in, innermost first: `X` inside
/// `\ifdefined\X ... \else`, `iffalse` inside `\iffalse`; `None` elsewhere (any other conditional is not followed).
pub(crate) fn guardas_por_linea(t: &str) -> Vec<Option<String>> {
    static R: OnceLock<Regex> = OnceLock::new();
    // every control word: the conditionals change the state, the first other one is where the line's command is
    let re = R.get_or_init(|| Regex::new(r"\\(ifdefined\s*\\([A-Za-z@]+)|[A-Za-z@]+)").expect("patrón válido"));
    // each open conditional: the switch of its true branch, and whether we are past its \else
    let mut pila: Vec<(Option<String>, bool)> = Vec::new();
    let actual = |p: &Vec<(Option<String>, bool)>| p.iter().rev().find_map(|(g, e)| if *e { None } else { g.clone() });
    let mut out = Vec::new();
    for l in t.lines() {
        // the state where the line's first command (other than a conditional) is: `\ifdefined\X\input{a}\fi` is behind X,
        // `\ifdefined\X\else\input{a}\fi` is not
        let mut estado = None;
        for c in re.captures_iter(l) {
            let tok = c.get(1).map_or("", |m| m.as_str());
            let inicio = c.get(0).map_or(0, |m| m.start());
            let condicional = c.get(2).is_some() || tok == "fi" || tok == "else" || (tok.starts_with("if") && tok != "ifthenelse");
            if !condicional {
                if estado.is_none() {
                    estado = Some(actual(&pila));
                }
                continue;
            }
            // `\newif\ifx` declares, `\ifthenelse` is a macro: neither opens anything a `\fi` closes
            if tok == "ifthenelse" || l[..inicio].trim_end().ends_with("\\newif") {
                continue;
            }
            if let Some(x) = c.get(2) {
                pila.push((Some(x.as_str().to_string()), false));
            } else if tok == "fi" {
                pila.pop();
            } else if tok == "else" {
                if let Some(top) = pila.last_mut() {
                    top.1 = true;
                }
            } else if tok == "iffalse" {
                pila.push((Some("iffalse".into()), false));
            } else if tok.starts_with("if") {
                pila.push((None, false));
            }
        }
        out.push(estado.unwrap_or_else(|| actual(&pila)));
    }
    out
}

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
        "import" | "subimport" | "inputfrom" | "includefrom" | "subinputfrom" | "subincludefrom" => 2,
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

/// A path relative to the project's top, with `/`: `.` and `..` are folded (`contents/G1/../common/x` is `contents/common/x`),
/// and a path that leaves the project, is absolute or names a drive is not followed.
fn normalizar(raw: &str) -> Option<String> {
    let s = raw.trim().trim_matches('"').trim().replace('\\', "/");
    if s.is_empty() || s.starts_with('/') || s.contains(':') {
        return None;
    }
    let mut partes: Vec<&str> = Vec::new();
    for c in s.split('/') {
        match c {
            "" | "." => {}
            ".." => {
                partes.pop()?;
            }
            _ => partes.push(c),
        }
    }
    (!partes.is_empty()).then(|| partes.join("/"))
}

/// The folder of a path relative to the project's top (empty at the top).
fn carpeta_de(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(d, _)| d)
}

/// `rel` read from `base` (a folder relative to the project's top; empty for the top).
fn desde(base: &str, rel: &str) -> String {
    if base.is_empty() {
        rel.to_string()
    } else {
        format!("{base}/{rel}")
    }
}

/// Folders a project's own classes and packages are not looked for in: build output and tools.
const SIN_PAQUETES: [&str; 7] = [".git", ".latexfrog", ".texpile", "node_modules", "target", "output", "_draft"];

/// The project's own `.cls` and `.sty` files by name (`tc2-guide.cls`), wherever they are: TeX finds them through `TEXINPUTS`
/// (`style//` in a `latexmkrc`, or a folder Overleaf searches), which the index does not read, so a name that is unique in the
/// project is taken as that file. A name found twice keeps the shallowest one.
fn paquetes_del_proyecto(root: &Path, vistas: &mut Vec<String>) -> HashMap<String, String> {
    fn rec(root: &Path, rel: &str, nivel: u32, out: &mut HashMap<String, String>, cuenta: &mut usize, vistas: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(root.join(rel)) else { return };
        vistas.push(rel.to_string());
        let mut hijos: Vec<_> = rd.flatten().collect();
        hijos.sort_by_key(|e| e.file_name());
        let mut carpetas = Vec::new();
        for e in hijos {
            *cuenta += 1;
            if *cuenta > 20_000 {
                return;
            }
            let nombre = e.file_name().to_string_lossy().to_string();
            let hijo = desde(rel, &nombre);
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                if !nombre.starts_with('.') && !SIN_PAQUETES.contains(&nombre.as_str()) && nivel < 6 {
                    carpetas.push(hijo);
                }
                continue;
            }
            let lower = nombre.to_lowercase();
            if lower.ends_with(".cls") || lower.ends_with(".sty") {
                out.entry(lower).or_insert(hijo);
            }
        }
        // the files of a folder before those of its subfolders: the shallowest of a repeated name wins
        for c in carpetas {
            rec(root, &c, nivel + 1, out, cuenta, vistas);
        }
    }
    let mut out = HashMap::new();
    rec(root, "", 0, &mut out, &mut 0, vistas);
    out
}

/// The classes and packages a text loads by name: `\documentclass`, `\usepackage`, `\RequirePackage`, `\LoadClass` and their
/// `WithOptions` forms, each with its extension (`tc2-guide.cls`, `tc2-plots.sty`).
fn paquetes_cargados(texto: &str) -> Vec<String> {
    let aridad = |n: &str| {
        matches!(n, "documentclass" | "usepackage" | "RequirePackage" | "RequirePackageWithOptions" | "LoadClass" | "LoadClassWithOptions").then_some(1)
    };
    let mut out = Vec::new();
    for (cmd, args, _) in llamadas(texto, &aridad) {
        let ext = if matches!(cmd.as_str(), "documentclass" | "LoadClass" | "LoadClassWithOptions") { "cls" } else { "sty" };
        for n in args[0].split(',').map(str::trim).filter(|n| !n.is_empty() && !n.contains('#') && !n.contains('\\')) {
            out.push(format!("{}.{ext}", n.to_lowercase()));
        }
    }
    out
}

/// Every graphics folder a text names with `\graphicspath{{a/}{b/}}`, without the trailing `/`. Read anywhere, a macro body
/// included: a class that sets it per chapter (`\graphicspath{{figures/}}` in a setup macro) still says where images are.
fn carpetas_de_imagenes(texto: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (_, args, _) in llamadas(texto, &|n| (n == "graphicspath").then_some(1)) {
        let b = args[0].as_bytes();
        let mut i = 0;
        while i < b.len() {
            match argumento(b, &args[0], i) {
                Some((d, sig)) => {
                    let d = d.trim().trim_matches('"').trim_end_matches('/').to_string();
                    if !d.contains('#') && !d.contains('\\') {
                        out.push(d);
                    }
                    i = sig;
                }
                None => i += 1,
            }
        }
    }
    out
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

/// An image as graphicx looks for it: from the folder the file is read in (`base`), then from the project's top, and then in
/// every `\graphicspath` folder, each one from `base` first.
fn resolver_imagen_en(root: &Path, raw: &str, base: &str, carpetas: &[String]) -> Option<String> {
    let mut intentos = vec![desde(base, raw), raw.to_string()];
    for c in carpetas {
        intentos.push(desde(base, &desde(c, raw)));
        intentos.push(desde(c, raw));
    }
    intentos.iter().find_map(|i| resolver_imagen(root, i))
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
    /// The `\graphicspath` folders named anywhere in the project's files and packages.
    imagenes: &'a [String],
}

/// What a walk learns that the next one reads with: the loader macros and the graphics folders.
#[derive(Default, PartialEq)]
struct Aprendido {
    loaders: Loaders,
    aridades: BTreeMap<String, usize>,
    imagenes: Vec<String>,
}

impl ProjectIndex {
    /// Recorre el proyecto desde `root_file`. Un archivo que no se puede leer se salta: el índice es una ayuda, no
    /// puede impedir abrir ni compilar.
    pub fn build(root: &Path, root_file: &str, commands: &[String]) -> ProjectIndex {
        let t0 = Instant::now();
        // User macros that load files (`\Ejercicio{slug}` → `\input{ejercicios/slug}`) are only known after reading their
        // definitions, which are in files the graph reaches or in the project's own classes and packages they load: walk, read
        // the definitions, and walk again while that finds more.
        let mut carpetas = Vec::new();
        let propios = paquetes_del_proyecto(root, &mut carpetas);
        let mut aprendido = Aprendido::default();
        let mut ix = Self::walk(root, root_file, commands, &aprendido);
        // the project's macros that set a title (`\metaEjercicio{Título}{...}`): they name the part that opens with one
        let mut titulos: Vec<(String, usize)> = Vec::new();
        // loaders that set a label from their argument, with that label (`{}` for the argument) and the word their heading prints
        // (`\exercisename`): a part with no title of its own goes by its number in the last build, as the document prints it
        let mut numerados: HashMap<String, (String, Option<String>)> = HashMap::new();
        for _ in 0..3 {
            ix.packages = Self::paquetes_de(root, &ix, &propios);
            let mut m = Macros::default();
            let mut imagenes: Vec<String> = Vec::new();
            // the packages first: a definition in the document overrides one in its class, as it does in TeX
            for rel in ix.packages.iter().chain(ix.files.keys()) {
                if let Some(t) = leer_texto(&root.join(rel)) {
                    m.read(&t);
                    for c in carpetas_de_imagenes(&t) {
                        if !imagenes.contains(&c) {
                            imagenes.push(c);
                        }
                    }
                }
            }
            let loaders: Loaders = m
                .loaders()
                .into_iter()
                // a call in a document is a name of letters; a part command that includes its argument as is (`\Capitulo`) already works
                .filter(|(n, ts)| n.bytes().all(|c| c.is_ascii_alphabetic()) && !(commands.contains(n) && ts.iter().all(|t| t.path == "{}")))
                .collect();
            let aridades = loaders.keys().filter_map(|n| Some((n.clone(), m.mandatory_arity(n)?))).collect();
            // a loader that opens a section takes the title from its file's name: that is the path, not a title
            titulos = m.headings().into_iter().filter(|(n, _)| !loaders.contains_key(n)).map(|(n, h)| (n, h.arg)).collect();
            numerados = m
                .label_makers()
                .into_iter()
                .filter(|(n, _)| loaders.contains_key(n))
                .map(|(n, (_, plantilla))| {
                    let palabra = m.plain_text(&format!("{n}name"));
                    (n, (plantilla, palabra))
                })
                .collect();
            let found = Aprendido { loaders, aridades, imagenes };
            if found == aprendido {
                break;
            }
            aprendido = found;
            ix = Self::walk(root, root_file, commands, &aprendido);
        }
        ix.packages = Self::paquetes_de(root, &ix, &propios);
        let mut numeros: Option<HashMap<String, String>> = None;
        for p in ix.parts.iter_mut() {
            p.label = crate::etiquetas::de_parte(root, p, &titulos);
            if let Some((plantilla, palabra)) = numerados.get(&p.command).filter(|_| p.label == crate::etiquetas::de_ruta(&p.name)) {
                let numeros = numeros.get_or_insert_with(|| crate::symbols::numeros_compilados(root));
                if let Some(n) = numeros.get(&plantilla.replace("{}", &p.name)) {
                    p.label = match palabra {
                        Some(w) => format!("{w} {n}"),
                        None => format!("{n} {}", p.label),
                    };
                }
            }
        }
        // in document order: a guide's exercises are found after the guides beside it, and right after their guide is where
        // Contents and the profiles show them
        let claves: Vec<Vec<u32>> = ix.parts.iter().map(|p| [ix.position(&p.source), vec![p.line]].concat()).collect();
        let mut orden: Vec<usize> = (0..ix.parts.len()).collect();
        orden.sort_by(|&a, &b| claves[a].cmp(&claves[b]));
        let mut viejas: Vec<Option<Part>> = std::mem::take(&mut ix.parts).into_iter().map(Some).collect();
        ix.parts = orden.into_iter().filter_map(|i| viejas[i].take()).collect();
        ix.huella = ix.huella_de(root, commands, &carpetas, numeros.is_some());
        ix.scan_ms = t0.elapsed().as_millis() as u64;
        ix
    }

    /// Whether an index built now would come out the same: the same root and commands, and nothing it read or looked for changed.
    pub fn vigente(&self, root_file: &str, commands: &[String]) -> bool {
        self.root_file == root_file && self.huella.comandos == commands && self.huella.sellos.iter().all(|(p, s)| sello(p) == *s)
    }

    fn huella_de(&self, root: &Path, commands: &[String], carpetas: &[String], leyo_numeros: bool) -> Huella {
        let mut rels: BTreeSet<&str> = BTreeSet::new();
        rels.extend(self.files.keys().map(String::as_str));
        rels.extend(self.packages.iter().map(String::as_str));
        rels.extend(self.reachable.iter().map(String::as_str));
        rels.extend(self.files.values().flatten().filter_map(|e| e.target.as_deref()));
        let mut sellos: Vec<_> = carpetas.iter().map(|c| root.join(c)).chain(rels.into_iter().map(|r| root.join(r))).map(|p| {
            let s = sello(&p);
            (p, s)
        }).collect();
        // the numbers a part takes from the last build (`numeros_compilados`): the build's aux files
        if leyo_numeros {
            let mut pendientes = vec![root.join(".latexfrog").join("build")];
            while let Some(dir) = pendientes.pop() {
                sellos.push((dir.clone(), sello(&dir)));
                let Ok(rd) = std::fs::read_dir(&dir) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        pendientes.push(p);
                    } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("aux")) {
                        let s = sello(&p);
                        sellos.push((p, s));
                    }
                }
            }
        }
        Huella { comandos: commands.to_vec(), sellos }
    }

    /// The project's own classes and packages that the walked files load, and those they load in turn.
    fn paquetes_de(root: &Path, ix: &ProjectIndex, propios: &HashMap<String, String>) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut cola: Vec<String> = ix.files.keys().cloned().collect();
        while let Some(rel) = cola.pop() {
            let Some(t) = leer_texto(&root.join(&rel)) else { continue };
            for nombre in paquetes_cargados(&t) {
                if let Some(p) = propios.get(&nombre) {
                    if !out.contains(p) {
                        out.push(p.clone());
                        cola.push(p.clone());
                    }
                }
            }
        }
        out
    }

    fn walk(root: &Path, root_file: &str, commands: &[String], aprendido: &Aprendido) -> ProjectIndex {
        let (loaders, aridades) = (&aprendido.loaders, &aprendido.aridades);
        let mut ix = ProjectIndex { root_file: root_file.to_string(), ..Default::default() };
        // `begin` y `end` sólo se miran para llevar la cuenta de los `tikzpicture` abiertos.
        let mut interesantes: HashMap<&str, usize> =
            [
                "input", "include", "subfile", "import", "subimport", "inputfrom", "includefrom", "subinputfrom", "subincludefrom", "includegraphics", "bibliography",
                "addbibresource", "begin", "end",
            ]
            .into_iter()
            .map(|c| (c, cantidad_de_argumentos(c)))
            .collect();
        interesantes.extend(commands.iter().map(|c| (c.as_str(), 1)));
        for (name, ts) in loaders {
            let n = ts.iter().map(|t| t.arg + 1).max().unwrap_or(1);
            let e = interesantes.entry(name.as_str()).or_insert(n);
            *e = (*e).max(n);
        }
        let cmds: HashSet<&str> = commands.iter().map(String::as_str).collect();
        let ctx = Contexto { interesantes, cmds, loaders, aridades, imagenes: &aprendido.imagenes };
        let mut visitados = HashSet::new();
        // TeX runs in the root file's folder: what it reads is found from there first
        ix.visitar(root, root_file, false, None, false, None, carpeta_de(root_file), &ctx, &mut visitados);
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
    /// `grupo`: the `\subfile` part this file is in, while no part inside it has been entered: its loader calls are parts too.
    fn visitar(
        &mut self,
        root: &Path,
        rel: &str,
        en_parte: bool,
        grupo: Option<&str>,
        cuerpo: bool,
        dentro: Option<(&str, bool)>,
        base: &str,
        ctx: &Contexto,
        vistos: &mut HashSet<String>,
    ) {
        if !vistos.insert(rel.to_string()) {
            // a guide that loads a list another guide already read (a solutions book and its guide): the list's parts are in it too
            if let Some(g) = grupo.filter(|_| en_parte) {
                for p in self.parts.iter_mut().filter(|p| p.source == rel && p.group.as_deref().is_some_and(|x| x != g) && !p.also.iter().any(|a| a == g)) {
                    p.also.push(g.to_string());
                }
            }
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
                    Some(&arity) if cuerpo_aqui && (!en_parte || grupo.is_some()) && !ctx.cmds.contains(c.comando.as_str()) && ts.iter().all(|t| t.kind == LoadKind::Input) => {
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
                        self.parts.push(Part { name, label: String::new(), group: grupo.filter(|_| en_parte).map(String::from), file: Some(files[0].clone()), command: c.comando.clone(), source: rel.to_string(), line: c.linea, gate, others: files[1..].to_vec(), also: vec![] });
                    }
                }
                continue;
            }
            let (kind, args): (EdgeKind, Vec<String>) = match c.comando.as_str() {
                "includegraphics" => (EdgeKind::Graphics, c.args),
                "bibliography" => (EdgeKind::Bib, c.args[0].split(',').map(|s| s.trim().to_string()).collect()),
                "addbibresource" => (EdgeKind::Bib, c.args),
                // the import package: `\import{dir/}{file}` from the folder TeX runs in, `\subimport` from the file it is written in
                "import" | "inputfrom" | "includefrom" => (EdgeKind::Import, vec![desde(c.args[0].trim().trim_end_matches('/'), c.args[1].trim())]),
                "subimport" | "subinputfrom" | "subincludefrom" => {
                    let dir = desde(carpeta_de(rel), c.args[0].trim().trim_end_matches('/'));
                    (EdgeKind::Import, vec![desde(dir.trim_end_matches('/'), c.args[1].trim())])
                }
                "input" => (EdgeKind::Input, c.args),
                "include" => (EdgeKind::Include, c.args),
                "subfile" => (EdgeKind::Subfile, c.args),
                _ => (EdgeKind::Part, c.args),
            };
            // A `\subfile` in the body, outside any part, brings a whole document of its own (a chapter, one guide of a
            // course): it is a part even when `parts.commands` does not name it. `\includeonly` does not reach it, so the driver
            // gates it like a loader macro (`Gate`), and its name is the argument as written, which is what the gate compares.
            let subdocumento = c.comando == "subfile" && cuerpo_aqui && !en_parte;
            for raw in args {
                // `\input{#1}` y compañía: parámetros de macro, no archivos.
                if raw.is_empty() || raw.contains('#') || raw.contains('\\') {
                    continue;
                }
                let raw = raw.trim().trim_matches('"').to_string();
                let target = match kind {
                    EdgeKind::Graphics => resolver_imagen_en(root, &raw, base, ctx.imagenes),
                    EdgeKind::Bib => resolver_bib(root, &desde(base, &raw)).or_else(|| resolver_bib(root, &raw)),
                    // inside an imported file or a subfile, its folder first and then the project's top
                    _ if !base.is_empty() && !matches!(kind, EdgeKind::Import) => resolver_tex(root, &desde(base, &raw)).or_else(|| resolver_tex(root, &raw)),
                    _ => resolver_tex(root, &raw),
                };
                if subdocumento && target.is_some() && !self.parts.iter().any(|p| p.name == raw) {
                    de_cargador.insert(aristas.len());
                    self.parts.push(Part {
                        name: raw.clone(),
                        label: String::new(),
                        group: None,
                        file: target.clone(),
                        command: c.comando.clone(),
                        source: rel.to_string(),
                        line: c.linea,
                        gate: Some(Gate { arity: 1, arg: 0 }),
                        others: vec![],
                        also: vec![],
                    });
                }
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
                        self.parts.push(Part { name, label: String::new(), group: None, file: e.target.clone(), command: e.command.clone(), source: rel.to_string(), line: e.line, gate: None, others: vec![], also: vec![] });
                    }
                }
            }
            if let (true, Some(t)) = (e.kind.estructural(), &e.target) {
                if t.to_lowercase().ends_with(".tex") {
                    let desde = if e.en_tikz { Some((dentro.map_or(rel, |d| d.0), e.en_figure)) } else { None };
                    // an imported file or a subfile (subfiles reads it with `\import`) sets its folder for what it inputs; anything
                    // else passes the current one on
                    let carpeta = if matches!(e.kind, EdgeKind::Import | EdgeKind::Subfile) || (e.kind == EdgeKind::Part && e.command == "subfile") {
                        carpeta_de(t).to_string()
                    } else {
                        base.to_string()
                    };
                    // a guide (a `\subfile` part) is the group of the parts its files load; inside one of those, no more nesting
                    let sub = es_parte && e.command == "subfile";
                    let grupo_e = if sub { Some(e.raw.as_str()) } else if es_parte { None } else { grupo };
                    self.visitar(root, t, en_parte || es_parte, grupo_e, cuerpo_e, desde, &carpeta, ctx, vistos);
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

    /// The parts a choice compiles, in document order, with their groups made whole: a chosen exercise brings its guide (the guide
    /// prints its cover and calls the exercise), and a chosen guide brings every exercise in it.
    pub fn with_groups(&self, chosen: &[String]) -> Vec<String> {
        let elegida = |n: &str| chosen.iter().any(|c| c == n);
        self.parts
            .iter()
            .filter(|p| {
                elegida(&p.name)
                    || p.group.iter().chain(&p.also).any(|g| elegida(g))
                    || self.parts.iter().any(|q| q.group.as_deref() == Some(p.name.as_str()) && elegida(&q.name))
            })
            .map(|p| p.name.clone())
            .collect()
    }

    pub fn part_names(&self) -> Vec<String> {
        self.parts.iter().map(|p| p.name.clone()).collect()
    }

    /// Índice de la parte a la que pertenece `rel`: ella misma si lo es, o la parte que la trae (recursivo, la más
    /// cercana). `None` para lo que no es de ninguna parte (el preámbulo, `libro_cuerpo.tex`, una portada).
    /// The folders where the engine found the images that `rel` inserts, and those of the files it brings in (not into another
    /// part), in the order they come, without repeats. An editor that shows `rel` looks for its images there too: a guide's class
    /// sets `\graphicspath{{figures/}}` relative to the guide's folder, which nothing in the open file says.
    pub fn image_dirs(&self, rel: &str) -> Vec<String> {
        let parte = self.part_of(rel);
        let mut out: Vec<String> = Vec::new();
        let mut cola = vec![rel.to_string()];
        let mut vistos = HashSet::new();
        while let Some(f) = cola.pop() {
            if !vistos.insert(f.clone()) {
                continue;
            }
            let Some(edges) = self.files.get(&f) else { continue };
            for e in edges {
                let Some(t) = e.target.as_deref() else { continue };
                if e.kind == EdgeKind::Graphics {
                    let dir = t.rsplit_once('/').map_or("", |(d, _)| d).to_string();
                    if !out.contains(&dir) {
                        out.push(dir);
                    }
                }
            }
            // depth first, in document order: the files it brings, unless they are another part
            for e in edges.iter().rev().filter(|e| e.kind.estructural()) {
                if let Some(t) = e.target.as_deref() {
                    if parte.is_none() || self.part_of(t) == parte {
                        cola.push(t.to_string());
                    }
                }
            }
        }
        out
    }

    /// The files the document reads only behind a switch that is off: every inclusion of the file (or of a file that brings it)
    /// sits in the true branch of `\ifdefined\X` with `\X` defined nowhere in the project, or inside `\iffalse`. Maps each such
    /// file to the switch (`X`, or `iffalse`). A test bench a book loads with `\ifdefined\BancoDePruebas` is code of the project,
    /// but not in its PDF until someone defines the macro.
    pub fn conditional_files(&self, root: &Path) -> BTreeMap<String, String> {
        let textos: HashMap<&str, String> = self
            .files
            .keys()
            .chain(self.packages.iter())
            .filter_map(|f| leer_texto(&root.join(f)).map(|t| (f.as_str(), t.lines().map(sin_comentario).collect::<Vec<_>>().join("\n"))))
            .collect();
        let definida = |x: &str| {
            let re = Regex::new(&format!(r"\\(?:[gex]?def|let|global\\let)\s*\\{x}\b|\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*\{{?\s*\\{x}\b|\\csname\s+{x}\\endcsname")).ok();
            re.is_some_and(|re| textos.values().any(|t| re.is_match(t)))
        };
        // the switch each structural inclusion is behind, per parent file
        let mut guarda_de: HashMap<(String, String), Option<String>> = HashMap::new();
        for (padre, aristas) in &self.files {
            let Some(t) = textos.get(padre.as_str()) else { continue };
            let por_linea = guardas_por_linea(t);
            for e in aristas.iter().filter(|e| e.kind.estructural()) {
                if let Some(h) = &e.target {
                    let g = por_linea.get(e.line as usize - 1).cloned().flatten().filter(|x| x == "iffalse" || !definida(x));
                    let k = (padre.clone(), h.clone());
                    // two inclusions from one parent: the file is off only if both are
                    let prev = guarda_de.remove(&k);
                    guarda_de.insert(k, match prev {
                        Some(None) => None,
                        _ => g,
                    });
                }
            }
        }
        let mut out = BTreeMap::new();
        let mut memo: HashMap<String, Option<String>> = HashMap::new();
        fn apagado(f: &str, ix: &ProjectIndex, g: &HashMap<(String, String), Option<String>>, memo: &mut HashMap<String, Option<String>>, pila: &mut HashSet<String>) -> Option<String> {
            if let Some(m) = memo.get(f) {
                return m.clone();
            }
            if f == ix.root_file || !pila.insert(f.to_string()) {
                return None;
            }
            let padres = ix.parents.get(f).cloned().unwrap_or_default();
            let mut razon = None;
            let mut todos = !padres.is_empty();
            for p in &padres {
                let r = g.get(&(p.clone(), f.to_string())).cloned().flatten().or_else(|| apagado(p, ix, g, memo, pila));
                match r {
                    Some(x) => razon = razon.or(Some(x)),
                    None => todos = false,
                }
            }
            pila.remove(f);
            let r = if todos { razon } else { None };
            memo.insert(f.to_string(), r.clone());
            r
        }
        for f in self.files.keys() {
            if let Some(x) = apagado(f, self, &guarda_de, &mut memo, &mut HashSet::new()) {
                out.insert(f.clone(), x);
            }
        }
        out
    }

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

    #[test]
    fn exercises_a_guide_loads_are_parts_inside_the_guide_named_by_their_title_macro() {
        let d = tempfile::tempdir().unwrap();
        let w = |rel: &str, t: &str| {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w(
            "main.tex",
            "\\documentclass{article}\n\\usepackage{subfiles}\n\\newcommand\\exercisename{Ejercicio}\n\\newcommand{\\exercise}[1]{\\section{}\\label{ex:#1}\\input{ex/#1}}\n\\newcommand{\\meta}[2]{\\gdef\\t{#1}{\\Large\\textbf{#1}}}\n\\begin{document}\n\\subfile{g1/main}\n\\subfile{g2/main}\n\\end{document}\n",
        );
        w("g1/main.tex", "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\setup{title = {Primera gu\\'ia}}\n\\exercise{a}\n\\exercise{b}\n\\end{document}\n");
        w("g2/main.tex", "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\exercise{c}\n\\end{document}\n");
        w("g1/ex/a.tex", "\\meta{Ejercicio con t\\'itulo}{Rev 1}\nTexto.\n");
        w("g1/ex/b.tex", "Sin t\\'itulo.\n");
        w("g2/ex/c.tex", "Otro.\n");
        // the last build numbered b: it goes by "Ejercicio 1.2", as printed; c was never built and keeps its file's name
        w(".latexfrog/build/default/lv-default.aux", "\\relax\n\\newlabel{ex:b}{{1.2}{3}{}{section.2}{}}\n\\newlabel{odd}{{\\relax 1}{1}}\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include", "subfile"]));
        let partes: Vec<_> = ix.parts.iter().map(|p| (p.name.as_str(), p.group.as_deref(), p.label.as_str())).collect();
        assert_eq!(
            partes,
            [
                ("g1/main", None, "Primera gu\u{ed}a"),
                ("a", Some("g1/main"), "Ejercicio con t\u{ed}tulo"),
                ("b", Some("g1/main"), "Ejercicio 1.2"),
                ("g2/main", None, "g2"),
                ("c", Some("g2/main"), "c"),
            ]
        );
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        // an exercise brings its guide's frame; a guide brings all its exercises
        assert_eq!(ix.with_groups(&s(&["b"])), s(&["g1/main", "b"]));
        assert_eq!(ix.with_groups(&s(&["g2/main"])), s(&["g2/main", "c"]));
        // Contents says the same, and going to the exercise opens its own file, not the guide that calls it
        let sym = crate::symbols::Symbols::build(d.path(), &ix);
        let comp = crate::composicion::build(&ix, &sym.sections, &[]);
        let b = comp.iter().find_map(|it| match it {
            crate::composicion::Item::Section { index, opens, .. } if sym.sections[*index].title == "Ejercicio 1.2" => Some(opens.clone()),
            _ => None,
        });
        assert_eq!(b, Some(Some("g1/ex/b.tex".to_string())));
    }

    #[test]
    fn a_solutions_book_that_loads_its_guides_list_holds_the_same_exercises() {
        let d = tempfile::tempdir().unwrap();
        let w = |rel: &str, t: &str| {
            let p = d.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w(
            "main.tex",
            "\\documentclass{article}\n\\usepackage{subfiles}\n\\newcommand{\\exercise}[1]{\\section{}\\input{ex/#1}}\n\\begin{document}\n\\subfile{g3/main}\n\\subfile{g3/solutions}\n\\end{document}\n",
        );
        w("g3/main.tex", "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\input{list}\n\\end{document}\n");
        w("g3/solutions.tex", "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\input{list}\n\\end{document}\n");
        w("g3/list.tex", "\\exercise{a}\n\\exercise{b}\n");
        w("g3/ex/a.tex", "A.\n");
        w("g3/ex/b.tex", "B.\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include", "subfile"]));
        let partes: Vec<_> = ix.parts.iter().map(|p| (p.name.as_str(), p.group.as_deref(), p.also.clone())).collect();
        let sol = vec!["g3/solutions".to_string()];
        assert_eq!(partes, [("g3/main", None, vec![]), ("a", Some("g3/main"), sol.clone()), ("b", Some("g3/main"), sol), ("g3/solutions", None, vec![])]);
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        // the solutions book alone prints every exercise's solution: its exercises come with it, its guide does not
        assert_eq!(ix.with_groups(&s(&["g3/solutions"])), s(&["a", "b", "g3/solutions"]));
        assert_eq!(ix.with_groups(&s(&["g3/main"])), s(&["g3/main", "a", "b"]));
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

    #[test]
    fn a_subfile_reads_from_its_folder_is_a_gated_part_and_its_class_macros_load_files() {
        let d = proyecto(&[
            ("main.tex", "\\documentclass{guide}\n\\begin{document}\n\\subfile{contents/G1/main}\n\\end{document}\n"),
            ("style/guide.cls", "\\LoadClass{article}\n\\RequirePackage{extras}\n\\NewDocumentCommand\\exercise{m}{\\section{}\\input{exercises/#1}}\n"),
            ("style/sub/extras.sty", "\\newcommand\\example[1]{\\input{examples/#1}}\n"),
            ("contents/G1/main.tex", "\\documentclass[../../main.tex]{subfiles}\n\\begin{document}\n\\input{list}\n\\input{../shared/notes}\n\\end{document}\n"),
            ("contents/G1/list.tex", "\\exercise{one}\n\\example{two}\n"),
            ("contents/G1/exercises/one.tex", "x\n"),
            ("contents/G1/examples/two.tex", "x\n"),
            ("contents/shared/notes.tex", "y\n"),
        ]);
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include"]));
        let mut paquetes = ix.packages.clone();
        paquetes.sort();
        assert_eq!(paquetes, ["style/guide.cls", "style/sub/extras.sty"]);
        for f in ["contents/G1/list.tex", "contents/G1/exercises/one.tex", "contents/G1/examples/two.tex", "contents/shared/notes.tex"] {
            assert!(ix.reachable.contains(f), "{f} is not reached");
        }
        // the guide is the part, and each exercise or example its class loads is a part inside it; what the guide loads
        // otherwise belongs to the guide
        assert_eq!(ix.part_names(), ["contents/G1/main", "one", "two"]);
        assert!(ix.parts[1..].iter().all(|p| p.group.as_deref() == Some("contents/G1/main")));
        assert_eq!(ix.part_of("contents/G1/exercises/one.tex"), Some(1));
        assert_eq!(ix.part_of("contents/shared/notes.tex"), Some(0));
    }

    #[test]
    fn dot_dot_folds_inside_the_project_and_stops_outside_it() {
        assert_eq!(normalizar("a/b/../c").as_deref(), Some("a/c"));
        assert_eq!(normalizar("./a/./b").as_deref(), Some("a/b"));
        assert_eq!(normalizar("../a"), None);
        assert_eq!(normalizar("a/../.."), None);
    }

    #[test]
    fn images_are_found_from_the_file_folder_and_every_graphicspath() {
        let d = proyecto(&[
            ("main.tex", "\\documentclass{article}\n\\newcommand\\setup{\\graphicspath{{figures/}{../common/}}}\n\\begin{document}\n\\subfile{ch/one}\n\\end{document}\n"),
            ("ch/one.tex", "\\includegraphics{a}\n\\includegraphics{b}\n"),
            ("ch/figures/a.png", "x"),
            ("common/b.pdf", "x"),
        ]);
        let ix = ProjectIndex::build(d.path(), "main.tex", &cmds(&["include"]));
        let targets: Vec<Option<String>> = ix.files["ch/one.tex"].iter().map(|e| e.target.clone()).collect();
        assert_eq!(targets, [Some("ch/figures/a.png".to_string()), Some("common/b.pdf".to_string())]);
    }

    /// The index kept between requests holds while nothing it read or looked for changed, and only then.
    #[test]
    fn an_index_holds_until_a_file_it_read_or_a_folder_it_looked_in_changes() {
        let d = proyecto(&[
            ("main.tex", "\\documentclass{book}\n\\begin{document}\n\\include{ch/one}\n\\input{ch/two}\n\\end{document}\n"),
            ("ch/one.tex", "\\chapter{One}\n"),
        ]);
        let c = cmds(&["include"]);
        let pausa = || std::thread::sleep(std::time::Duration::from_millis(30));
        let ix = ProjectIndex::build(d.path(), "main.tex", &c);
        assert!(ix.vigente("main.tex", &c));
        assert!(!ix.vigente("other.tex", &c), "another root");
        assert!(!ix.vigente("main.tex", &cmds(&["include", "Capitulo"])), "other part commands");

        // an edit in a part
        pausa();
        std::fs::write(d.path().join("ch/one.tex"), "\\chapter{One, edited}\n").unwrap();
        assert!(!ix.vigente("main.tex", &c));
        let ix = ProjectIndex::build(d.path(), "main.tex", &c);
        assert!(ix.vigente("main.tex", &c));

        // the file `\input{ch/two}` asked for, missing until now
        pausa();
        std::fs::write(d.path().join("ch/two.tex"), "two\n").unwrap();
        assert!(!ix.vigente("main.tex", &c));
        let ix = ProjectIndex::build(d.path(), "main.tex", &c);
        assert!(ix.files.contains_key("ch/two.tex"));

        // a class or package of the project's own, anywhere in it
        pausa();
        std::fs::create_dir_all(d.path().join("style")).unwrap();
        assert!(!ix.vigente("main.tex", &c), "a new folder");
        let ix = ProjectIndex::build(d.path(), "main.tex", &c);
        pausa();
        std::fs::write(d.path().join("style/mine.sty"), "\\ProvidesPackage{mine}\n").unwrap();
        assert!(!ix.vigente("main.tex", &c), "a new .sty");
    }
}
