//! Las piezas del documento que un perfil puede sacar sin tocar el proyecto: el índice, la bibliografía, el índice alfabético y cada
//! PDF insertado con `\includepdf` (la carátula, la contratapa). Se detectan en los archivos que alcanza la raíz y que no son partes
//! (los capítulos no son piezas: entran o no por `\includeonly`), y el driver las anula redefiniendo el comando al empezar el
//! documento.
//!
//! Se eligió anular el comando y no envolver el bloque con una macro propia: así sirve para cualquier proyecto sin pedirle que
//! cambie nada. El libro las colgaba todas de `\CompilacionReducida`, que no permite sacar una y dejar otra.

use crate::graph::ProjectIndex;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pieza {
    Toc,
    Bibliography,
    Index,
    /// Un `\includepdf{archivo}`; el nombre tal como está escrito.
    Pdf(String),
    /// A block the document body prints outside the parts (a title page drawn by a macro, a `titlepage` environment): its
    /// command or environment name, with `#2`, `#3`... for later ones of the same name. It is left out by commenting its lines in
    /// a copy of the file (`copias`).
    Bloque(String),
    /// A part inside a chosen group left out (an exercise of a chosen guide): it leaves the profile's parts, not the driver.
    Parte(String),
}

impl Pieza {
    pub fn clave(&self) -> String {
        match self {
            Pieza::Toc => "toc".into(),
            Pieza::Bibliography => "bibliography".into(),
            Pieza::Index => "index".into(),
            Pieza::Pdf(a) => format!("pdf:{a}"),
            Pieza::Bloque(n) => format!("block:{n}"),
            Pieza::Parte(n) => format!("part:{n}"),
        }
    }

    pub fn de_clave(c: &str) -> Option<Pieza> {
        match c {
            "toc" => Some(Pieza::Toc),
            "bibliography" => Some(Pieza::Bibliography),
            "index" => Some(Pieza::Index),
            _ if c.starts_with("block:") => c
                .strip_prefix("block:")
                .filter(|n| !n.is_empty() && n.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '#' | '*' | '@' | '/' | '-' | '_' | '.')))
                .map(|n| Pieza::Bloque(n.into())),
            _ if c.starts_with("part:") => c.strip_prefix("part:").filter(|n| !n.is_empty() && !n.contains(['{', '}', '\\', '%', ','])).map(|n| Pieza::Parte(n.into())),
            _ => c.strip_prefix("pdf:").filter(|a| !a.is_empty() && !a.contains(['{', '}', '\\', '%'])).map(|a| Pieza::Pdf(a.into())),
        }
    }
}

/// Una pieza encontrada, para la interfaz.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PiezaInfo {
    pub clave: String,
    pub nombre: String,
    pub archivo: String,
    pub linea: u32,
    /// El bloque que se saca cuando el perfil la omite (líneas, inclusive): la bibliografía y el índice alfabético llevan su título,
    /// su `\cleardoublepage` y sus secciones, no sólo el `\printbibliography`.
    pub desde: u32,
    pub hasta: u32,
    /// Dónde está respecto de las partes: antes de la primera (`antes`), después de la última (`despues`), entre ellas, o
    /// adentro de una (`dentro`, y `parte` dice cuál).
    pub lugar: String,
    /// The part whose file prints it (a guide's cover), by its `\includeonly` name; `None` in the frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parte: Option<String>,
    /// For a piece inside a part, set (empty) when the driver can leave it out: its part is read through a macro the driver wraps,
    /// so a copy of its file is read in its place while that part is read (`copias_en_partes`). `None` when it cannot: a part an
    /// `\include` brings. (The name is the app's.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firma: Option<String>,
}

/// The text with the given lines (from 1) commented out (`% lv: `), keeping its line ends; a line that opens or closes a
/// conditional or the document stays as it is.
fn comentar(texto: &str, lineas: &std::collections::BTreeSet<u32>) -> String {
    let eol = if texto.contains("\r\n") { "\r\n" } else { "\n" };
    texto
        .split(eol)
        .enumerate()
        .map(|(n, l)| if lineas.contains(&(n as u32 + 1)) && !es_borde(l) { format!("% lv: {l}") } else { l.to_string() })
        .collect::<Vec<_>>()
        .join(eol)
}

/// The sectioning commands, from the outermost: a heading's level is its place here.
const SECCIONES: &[&str] = &["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];

/// The level of the heading a whole line is (`\part*{Ejercicios}`), if it is one.
fn nivel_de_titulo(l: &str) -> Option<usize> {
    let l = sin_comentario(l).trim();
    let r = l.strip_prefix('\\')?;
    let (i, c) = SECCIONES.iter().enumerate().find(|(_, c)| r.starts_with(**c))?;
    let resto = &r[c.len()..];
    resto.starts_with(['*', '{', '[']).then_some(i)
}

/// The guides in the build only because a part inside them was chosen (the chapter I am in is an exercise): they come for their
/// setup, and none of their own pieces print. A guide chosen itself, or whole, keeps them as the profile says.
pub fn solo_marco(ix: &ProjectIndex, elegidas: &[String], compiladas: &[String]) -> Vec<String> {
    ix.parts
        .iter()
        .filter(|g| compiladas.contains(&g.name) && !elegidas.contains(&g.name))
        .filter(|g| ix.parts.iter().any(|q| elegidas.contains(&q.name) && (q.group.as_deref() == Some(g.name.as_str()) || q.also.contains(&g.name))))
        .map(|g| g.name.clone())
        .collect()
}

/// Whether a profile leaves out the piece `clave`. A guide's pieces are named after their guide (`block:makecover@g1/main`);
/// a key without a guide (`block:makecover`, or `block:makecover#2` from before guides had their own) leaves that piece out of
/// every guide, which is what a profile of the chapter I am in needs.
pub fn omitida(clave: &str, omitir: &[String]) -> bool {
    let base = |k: &str| k.split(['#', '@']).next().unwrap_or(k).to_string();
    omitir.iter().any(|o| o == clave || (o.starts_with("block:") && !o.contains('@') && clave.contains('@') && base(o) == base(clave)))
}

/// The copies of the files of each part the profile changes, as `(part, file, text)`. In each, the lines of the pieces inside that
/// part it leaves out (a guide's cover, its credits) are commented, and so is a heading left with nothing compiled under it
/// (`\part*{Ejercicios}` once every exercise below it is out). `compiladas` is the parts the profile compiles (`None`: all).
///
/// The driver reads a copy in place of its file only while its part is read (`build`, `\lvEntra`): the kernel's file substitution
/// knows a file by its name without its folder, and the root and every guide are `main.tex`. Read under the original's name, a
/// subfile still finds its own files (`\input{exercise-list}`, its figures) in its own folder. Lines are commented, never taken
/// out, so each line keeps its number.
pub fn copias_en_partes(root: &Path, ix: &ProjectIndex, piezas: &[PiezaInfo], omitir: &[String], compiladas: Option<&[String]>, solo_marco: &[String]) -> Vec<(String, String, String)> {
    use std::collections::BTreeSet;
    let de_otras: BTreeSet<&str> = ix.parts.iter().filter_map(|p| p.file.as_deref()).collect();
    let mut out = Vec::new();
    for (i, p) in ix.parts.iter().enumerate().filter(|(_, p)| p.gate.is_some()) {
        let Some(propio) = p.file.as_deref() else { continue };
        // a part the profile does not compile is never read
        if compiladas.is_some_and(|c| !c.contains(&p.name)) {
            continue;
        }
        // its own file and the files it inputs that are not parts of their own (a guide's exercise list)
        let mut archivos: Vec<&str> = vec![propio];
        archivos.extend(ix.files.keys().map(String::as_str).filter(|f| *f != propio && !de_otras.contains(f) && ix.part_of(f) == Some(i)));
        for rel in archivos {
            let mut sale: BTreeSet<u32> = piezas
                .iter()
                .filter(|x| x.parte.as_deref() == Some(p.name.as_str()) && x.archivo == rel && x.firma.is_some() && omitida(&x.clave, omitir))
                .flat_map(|x| x.desde..=x.hasta)
                .collect();
            let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
            if solo_marco.contains(&p.name) {
                // a guide that is here only for an exercise chosen in it: its headings ("Ejercicios") are not what was chosen
                sale.extend(texto.lines().enumerate().filter(|(_, l)| nivel_de_titulo(l).is_some()).map(|(n, _)| n as u32 + 1));
            }
            if let Some(dentro) = compiladas {
                // the lines that load a part the profile leaves out
                let fuera: BTreeSet<u32> = ix.parts.iter().filter(|q| q.source == rel && !dentro.contains(&q.name)).map(|q| q.line).collect();
                if !fuera.is_empty() {
                    sale.extend(titulos_vacios(&texto.lines().collect::<Vec<_>>(), &fuera, &sale));
                }
            }
            if !sale.is_empty() {
                out.push((p.name.clone(), rel.to_string(), comentar(&texto, &sale)));
            }
        }
    }
    out
}

/// The headings (lines from 1) with nothing left under them: everything down to the next heading of the same level or above is
/// blank, a comment, a commented line (`sale`), the load of a part left out (`fuera`) or a heading itself empty, and at least one
/// part left out is there. A heading that is empty in the source too is not touched.
fn titulos_vacios(lineas: &[&str], fuera: &std::collections::BTreeSet<u32>, sale: &std::collections::BTreeSet<u32>) -> Vec<u32> {
    let titulos: Vec<(usize, usize)> = lineas.iter().enumerate().filter_map(|(n, l)| Some((n, nivel_de_titulo(l)?))).collect();
    let fin = lineas.iter().position(|l| sin_comentario(l).contains("\\end{document}")).unwrap_or(lineas.len());
    let mut vacios: Vec<usize> = Vec::new();
    for (k, &(n, nivel)) in titulos.iter().enumerate().rev() {
        let hasta = titulos[k + 1..].iter().find(|(_, v)| *v <= nivel).map_or(fin, |(m, _)| *m);
        let mut alguna = false;
        let vacio = (n + 1..hasta).all(|j| {
            let num = j as u32 + 1;
            if fuera.contains(&num) || vacios.contains(&j) {
                alguna = true;
                return true;
            }
            sale.contains(&num) || sin_comentario(lineas[j]).trim().is_empty()
        });
        if vacio && alguna {
            vacios.push(n);
        }
    }
    vacios.into_iter().map(|n| n as u32 + 1).collect()
}

/// Una línea que no se puede comentar sin romper el documento: abre, cambia o cierra un condicional, o es el fin del documento.
fn es_borde(l: &str) -> bool {
    let l = sin_comentario(l);
    l.contains("\\fi") || l.contains("\\else") || l.contains("\\if") || l.contains("\\end{document}") || l.contains("\\begin{document}")
}

fn es_salto_de_pagina(l: &str) -> bool {
    let l = sin_comentario(l);
    l.contains("\\cleardoublepage") || l.contains("\\clearpage") || l.contains("\\newpage")
}

/// El bloque de una pieza de varias líneas (bibliografía, índice alfabético): hacia atrás hasta su `\cleardoublepage` (si hay uno
/// cerca) y hacia adelante hasta el próximo salto de página, un borde de condicional u otra pieza. Medido en el libro: la bibliografía
/// va de su `\cleardoublepage` a la línea antes del `\cleardoublepage` del índice; el índice, hasta el `\fi`.
fn bloque(lineas: &[&str], i: usize, prohibidas: &[usize]) -> (usize, usize) {
    let mut desde = i;
    for j in (i.saturating_sub(30)..i).rev() {
        if es_borde(lineas[j]) || prohibidas.contains(&j) {
            break;
        }
        if es_salto_de_pagina(lineas[j]) {
            desde = j;
            break;
        }
    }
    let mut hasta = i;
    for (j, l) in lineas.iter().enumerate().skip(i + 1).take(30) {
        if es_borde(l) || es_salto_de_pagina(l) || prohibidas.contains(&j) {
            break;
        }
        hasta = j;
    }
    // Las líneas en blanco del final no son parte del bloque.
    while hasta > i && lineas[hasta].trim().is_empty() {
        hasta -= 1;
    }
    (desde, hasta)
}

/// Las copias de los archivos con piezas omitidas: el mismo texto con las líneas del bloque de cada pieza comentadas (`% lv: `). Se
/// compilan en lugar del original (`\declare@file@substitution`, del núcleo de LaTeX), así el proyecto no se toca. Devuelve
/// `(archivo, contenido)`.
pub fn copias(root: &Path, piezas: &[PiezaInfo], omitir: &[String]) -> Vec<(String, String)> {
    let mut por_archivo: std::collections::BTreeMap<&str, Vec<&PiezaInfo>> = std::collections::BTreeMap::new();
    // A piece inside a part is left out by its part's copy (`copias_en_partes`), read only while that part is read.
    for p in piezas.iter().filter(|p| omitir.contains(&p.clave) && p.parte.is_none()) {
        por_archivo.entry(p.archivo.as_str()).or_default().push(p);
    }
    let mut out = Vec::new();
    for (rel, ps) in por_archivo {
        let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
        let lineas = ps.iter().flat_map(|p| p.desde..=p.hasta).collect();
        out.push((rel.to_string(), comentar(&texto, &lineas)));
    }
    out
}

/// Opening minus closing braces of a line without its comment (`\{` and `\}` are characters, not groups).
fn llaves(l: &str) -> i64 {
    let b = l.as_bytes();
    let mut d = 0;
    for i in 0..b.len() {
        let escapada = i > 0 && b[i - 1] == b'\\' && !(i > 1 && b[i - 2] == b'\\');
        match b[i] {
            b'{' if !escapada => d += 1,
            b'}' if !escapada => d -= 1,
            _ => {}
        }
    }
    d
}

/// Whether commenting these lines keeps the file's braces and environments balanced.
fn balanceado(lineas: &[&str]) -> bool {
    let mut d = 0i64;
    let mut pila: Vec<String> = Vec::new();
    for l in lineas {
        let l = sin_comentario(l);
        d += llaves(l);
        if d < 0 {
            return false;
        }
        let mut r = l;
        while let Some(i) = r.find('\\') {
            r = &r[i + 1..];
            let (abre, resto) = if let Some(x) = r.strip_prefix("begin{") {
                (true, x)
            } else if let Some(x) = r.strip_prefix("end{") {
                (false, x)
            } else {
                continue;
            };
            let Some((nombre, _)) = resto.split_once('}') else { return false };
            if abre {
                pila.push(nombre.to_string());
            } else if pila.pop().as_deref() != Some(nombre) {
                return false;
            }
        }
    }
    d == 0 && pila.is_empty()
}

fn sin_comentario(l: &str) -> &str {
    let b = l.as_bytes();
    for i in 0..b.len() {
        if b[i] == b'%' && (i == 0 || b[i - 1] != b'\\') {
            return &l[..i];
        }
    }
    l
}

/// Las piezas del documento, en el orden en que aparecen en los archivos que no son partes. Un PDF repetido sale una vez.
pub fn detectar(root: &Path, ix: &ProjectIndex) -> Vec<PiezaInfo> {
    let archivos_de_partes: std::collections::BTreeSet<&str> = ix.parts.iter().filter_map(|p| p.file.as_deref()).collect();
    let mut orden: Vec<&String> = ix.reachable.iter().filter(|f| !archivos_de_partes.contains(f.as_str())).collect();
    // La raíz primero; el resto en el orden en que se incluye no lo sabemos acá y no hace falta: el lugar lo da la línea.
    orden.sort_by_key(|f| (*f != &ix.root_file, (*f).clone()));
    let mut out: Vec<PiezaInfo> = Vec::new();
    for rel in orden {
        let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
        // Las partes de este archivo, por línea: para decir si la pieza va antes o después de los capítulos.
        let lineas_de_partes: Vec<u32> = ix.parts.iter().filter(|p| &p.source == rel).map(|p| p.line).collect();
        let todas: Vec<&str> = texto.lines().collect();
        // Líneas que un bloque no puede cruzar: las de las partes y las de piezas de OTRO tipo (las dos `\printbibliography` del libro,
        // una por sección, son un solo bloque).
        let tipo = |l: &str| -> Option<&'static str> {
            let l = sin_comentario(l);
            [("\\tableofcontents", "toc"), ("\\printbibliography", "bib"), ("\\bibliography{", "bib"), ("\\printindex", "index"), ("\\includepdf", "pdf")]
                .iter()
                .find(|(c, _)| l.contains(c))
                .map(|(_, t)| *t)
        };
        let partes_ix: Vec<usize> = lineas_de_partes.iter().map(|l| *l as usize - 1).collect();
        // Only real calls count: in a file that opens the document, none before `\begin{document}` (a `\pretocmd{\printbibliography}`
        // in the preamble is not the bibliography), and none inside an open brace group (an argument of another macro).
        let inicio = todas.iter().position(|l| sin_comentario(l).contains("\\begin{document}")).unwrap_or(0);
        let mut profundidad = Vec::with_capacity(todas.len());
        let mut d: i64 = 0;
        for l in &todas {
            profundidad.push(d);
            d += llaves(sin_comentario(l));
        }
        for (n, l) in todas.iter().enumerate() {
            if n < inicio || profundidad[n] != 0 {
                continue;
            }
            let linea = n as u32 + 1;
            let propio = tipo(l);
            let otras: Vec<usize> = (0..todas.len())
                .filter(|&j| j != n && (partes_ix.contains(&j) || tipo(todas[j]).is_some_and(|t| Some(t) != propio || t == "pdf")))
                .collect();
            let l = sin_comentario(l);
            let (b_desde, b_hasta) = bloque(&todas, n, &otras);
            let (b_desde, b_hasta) = (b_desde as u32 + 1, b_hasta as u32 + 1);
            let lugar = match (lineas_de_partes.first(), lineas_de_partes.last()) {
                (Some(&a), _) if linea < a => "antes",
                (_, Some(&z)) if linea > z => "despues",
                (Some(_), _) => "entre",
                _ => "",
            };
            // La bibliografía y el índice alfabético se sacan con su bloque (título, salto de página, secciones); el resto, sólo su línea.
            let mut push = |p: Pieza, nombre: String| {
                let (desde, hasta) = if matches!(p, Pieza::Bibliography | Pieza::Index) { (b_desde, b_hasta) } else { (linea, linea) };
                // Commenting must not leave a group or an environment open: a block that would is cut to its line, and a line that
                // would is not a piece (the driver still empties the command itself).
                let (desde, hasta) = if balanceado(&todas[desde as usize - 1..hasta as usize]) {
                    (desde, hasta)
                } else if balanceado(&todas[n..=n]) {
                    (linea, linea)
                } else {
                    return;
                };
                if !out.iter().any(|x| x.clave == p.clave()) {
                    out.push(PiezaInfo { clave: p.clave(), nombre, archivo: rel.clone(), linea, desde, hasta, lugar: lugar.into(), parte: None, firma: None });
                }
            };
            if l.contains("\\tableofcontents") {
                push(Pieza::Toc, "Contents".into());
            }
            if l.contains("\\printbibliography") || l.contains("\\bibliography{") {
                push(Pieza::Bibliography, "Bibliography".into());
            }
            if l.contains("\\printindex") {
                push(Pieza::Index, "Index".into());
            }
            let mut resto = l;
            while let Some(i) = resto.find("\\includepdf") {
                resto = &resto[i + "\\includepdf".len()..];
                let mut r = resto.trim_start();
                if r.starts_with('[') {
                    match r.find(']') {
                        Some(j) => r = r[j + 1..].trim_start(),
                        None => break,
                    }
                }
                if let Some(arg) = r.strip_prefix('{').and_then(|a| a.split_once('}')).map(|(a, _)| a.trim()) {
                    if Pieza::de_clave(&format!("pdf:{arg}")).is_some() {
                        let base = arg.rsplit('/').next().unwrap_or(arg);
                        let nombre = base.strip_suffix(".pdf").unwrap_or(base).to_string();
                        push(Pieza::Pdf(arg.into()), nombre);
                    }
                }
            }
        }
    }
    bloques(root, ix, &mut out);
    out
}

/// Commands at the top of the body that print nothing (or are handled elsewhere): they are never pieces.
const NO_PIEZA: &[&str] = &[
    "pagestyle", "thispagestyle", "pagenumbering", "setcounter", "addtocounter", "stepcounter", "refstepcounter", "setlength", "addtolength",
    "linespread", "def", "gdef", "edef", "xdef", "let", "newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "NewDocumentCommand",
    "RenewDocumentCommand", "newif", "newcounter", "newlength", "makeatletter", "makeatother", "clearpage", "cleardoublepage", "newpage", "pagebreak",
    "frontmatter", "mainmatter", "backmatter", "appendix", "selectlanguage", "input", "include", "includeonly", "subfile", "import", "subimport",
    "usepackage", "hypersetup", "tikzset", "pgfkeys", "setkeys", "ctikzset", "sisetup", "graphicspath", "raggedbottom", "flushbottom", "onecolumn",
    "twocolumn", "normalsize", "small", "large", "centering", "noindent", "relax", "label", "phantomsection", "addcontentsline", "bookmarksetup",
    "tikzexternalize", "tikzexternaldisable", "tikzexternalenable", "tikzsetfigurename", "AtBeginDocument", "AddToHook", "color", "definecolor",
    "colorlet", "captionsetup", "setcounter", "tableofcontents", "listoffigures", "listoftables", "printbibliography", "bibliography",
    "bibliographystyle", "printindex", "includepdf", "end", "begin", "par", "vfill", "null", "global", "expandafter", "immediate", "write",
];

/// What a macro may call and still print nothing (`configurarFooter` is a `pgfkeys`).
const SOLO_AJUSTAN: &[&str] = &[
    "def", "gdef", "edef", "xdef", "let", "global", "pgfkeys", "setkeys", "setcounter", "addtocounter", "setlength", "addtolength", "definecolor",
    "colorlet", "newcommand", "renewcommand", "pagestyle", "tikzset", "ctikzset", "hypersetup", "sisetup", "expandafter", "csname", "endcsname",
];

/// The blocks the document body prints outside the parts, one piece each: a top-level call such as
/// `\soloEnPDFCompleto{\caratulaTributo{...}}` (named after the innermost command of the leading chain, `caratulaTributo`), or an
/// environment such as `titlepage`. Only whole lines: a block that shares a line with something else is not offered.
///
/// Inside a part's own file, around what it loads, a block is a call to a project macro that prints something of its own
/// (`\makecover`, `\makesolutions`; `Macros::prints`) or an environment (a guide's `credits`); loose commands are not pieces.
fn bloques(root: &Path, ix: &ProjectIndex, out: &mut Vec<PiezaInfo>) {
    let mut m = crate::macros::Macros::default();
    // the project's classes first, as TeX reads them: `\makecover` is defined in the guide's class
    for rel in ix.packages.iter().chain(ix.files.keys()) {
        if let Ok(t) = std::fs::read_to_string(root.join(rel)) {
            m.read(&t);
        }
    }
    let cargadores = m.loaders();
    // a macro that sets a title heads what follows: it is a heading of the outline, not a piece
    let titulos = m.headings();
    let preambulo = crate::formato::archivos_del_preambulo(ix);
    let de_partes: std::collections::BTreeSet<&str> =
        ix.parts.iter().flat_map(|p| p.file.iter().chain(p.others.iter())).map(String::as_str).collect();
    // the frame: the root and the files that call the parts (`libro_cuerpo.tex`); a content file outside any part is not one
    let marco: std::collections::BTreeSet<&str> = ix.parts.iter().map(|p| p.source.as_str()).collect();
    let mut archivos: Vec<(&String, Option<&str>)> = ix
        .files
        .keys()
        // a guide's exercise list calls parts (its exercises) but is inside a part itself: content, not frame
        .filter(|f| *f == &ix.root_file || (marco.contains(f.as_str()) && !preambulo.contains(f.as_str()) && !de_partes.contains(f.as_str()) && ix.part_of(f).is_none()))
        .map(|f| (f, None))
        .collect();
    archivos.sort_by_key(|(f, _)| (*f != &ix.root_file, (*f).clone()));
    // then each part's own file, in the parts' order
    for p in &ix.parts {
        if let Some(f) = p.file.as_ref().filter(|f| ix.files.contains_key(*f) && !archivos.iter().any(|(a, _)| a == f)) {
            archivos.push((f, Some(p.name.as_str())));
        }
    }
    let mut vistos: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (rel, parte) in archivos {
        let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
        let lineas: Vec<&str> = texto.lines().collect();
        // lines that load files or parts: not blocks
        let cargan: std::collections::BTreeSet<u32> =
            ix.files.get(rel).into_iter().flatten().filter(|e| e.kind.estructural()).map(|e| e.line).collect();
        // A part's pieces frame the parts it holds (a guide's cover before its exercise list, its credits). A part that holds
        // none (an exercise, even one that `\input`s its plots) is all content: a list or a figure in it is not a piece.
        let (primera, ultima) = (cargan.first().copied().unwrap_or(0), cargan.last().copied().unwrap_or(0));
        let sostiene = |p: &str| ix.parts.iter().any(|q| q.group.as_deref() == Some(p) || q.also.iter().any(|a| a == p));
        if parte.is_some_and(|p| cargan.is_empty() || !sostiene(p)) {
            continue;
        }
        let lineas_de_partes: Vec<u32> = ix.parts.iter().filter(|p| &p.source == rel).map(|p| p.line).collect();
        // the root's preamble is not the body
        // and neither is a subfile's (an `\include`d chapter has none)
        let cuerpo = lineas.iter().position(|l| sin_comentario(l).contains("\\begin{document}")).map(|i| i + 1);
        let mut n = match (cuerpo, rel == &ix.root_file || parte.is_some()) {
            (Some(i), true) => i,
            (None, _) if parte.is_some() => 0,
            (_, false) => 0,
            (None, true) => continue,
        };
        while n < lineas.len() {
            let l = sin_comentario(lineas[n]).trim();
            if !l.starts_with('\\') || es_borde(lineas[n]) {
                n += 1;
                continue;
            }
            let fin = fin_del_bloque(&lineas, n);
            let Some(fin) = fin else {
                n += 1;
                continue;
            };
            let nombre = nombre_del_bloque(l);
            let linea = n as u32 + 1;
            let carga = (linea..=fin as u32 + 1).any(|x| cargan.contains(&x));
            let cruza = (n..=fin).skip(1).any(|j| es_borde(lineas[j]));
            let imprime = nombre.as_deref().is_some_and(|c| {
                !NO_PIEZA.contains(&c)
                    && !c.ends_with("true")
                    && !c.ends_with("false")
                    && !m.only_sets(c, SOLO_AJUSTAN)
                    && !cargadores.contains_key(c)
                    && (parte.is_none() || l.starts_with("\\begin{") || (m.prints(c) && !titulos.contains_key(c)))
            });
            let enmarca = parte.is_none() || linea < primera || linea > ultima;
            if let (Some(c), true, false, false, true) = (nombre, imprime, carga, cruza, enmarca) {
                // inside a part, its key names the part: it stays the same when another guide gains or loses one.
                // A second block of the same name gets `#2`, counted within its part (two lists in one exercise).
                let k = vistos.entry(match parte {
                    Some(p) => format!("{c}@{p}"),
                    None => c.clone(),
                });
                let k = k.or_insert(0);
                *k += 1;
                let n = if *k == 1 { c.clone() } else { format!("{c}#{k}") };
                let id = match parte {
                    Some(p) => format!("{n}@{p}"),
                    None => n,
                };
                let lugar = match (parte, lineas_de_partes.first(), lineas_de_partes.last()) {
                    (Some(_), _, _) => "dentro",
                    (_, Some(&a), _) if linea < a => "antes",
                    (_, _, Some(&z)) if linea > z => "despues",
                    (_, Some(_), _) => "entre",
                    _ => "",
                };
                out.push(PiezaInfo {
                    clave: Pieza::Bloque(id).clave(),
                    archivo: rel.clone(),
                    linea,
                    desde: linea,
                    hasta: fin as u32 + 1,
                    lugar: lugar.into(),
                    parte: parte.map(String::from),
                    firma: parte.filter(|p| ix.parts.iter().any(|q| q.name == *p && q.gate.is_some())).map(|_| String::new()),
                    nombre: c,
                });
            }
            n = fin + 1;
        }
    }
}

/// The last line of the statement that starts at line `n`: where its braces close (an environment: its `\end`). `None` when it
/// never closes, or closes with something after it on that line.
fn fin_del_bloque(lineas: &[&str], n: usize) -> Option<usize> {
    let primera = sin_comentario(lineas[n]).trim();
    if let Some(env) = primera.strip_prefix("\\begin{").and_then(|r| r.split_once('}')).map(|(e, _)| e.to_string()) {
        if env == "document" {
            return None;
        }
        let (abre, cierra) = (format!("\\begin{{{env}}}"), format!("\\end{{{env}}}"));
        let mut prof = 0i32;
        for (j, l) in lineas.iter().enumerate().skip(n).take(400) {
            let l = sin_comentario(l);
            prof += l.matches(abre.as_str()).count() as i32 - l.matches(cierra.as_str()).count() as i32;
            if prof <= 0 {
                let resto = l.rsplit_once(cierra.as_str()).map_or("", |(_, r)| r);
                return resto.trim().is_empty().then_some(j);
            }
        }
        return None;
    }
    let mut prof = 0i32;
    for (j, l) in lineas.iter().enumerate().skip(n).take(400) {
        let b = sin_comentario(l).as_bytes();
        let mut ultimo_cierre = None;
        for (i, &c) in b.iter().enumerate() {
            let escapado = i > 0 && b[i - 1] == b'\\';
            match c {
                b'{' if !escapado => prof += 1,
                b'}' if !escapado => {
                    prof -= 1;
                    ultimo_cierre = Some(i);
                }
                _ => {}
            }
        }
        if prof <= 0 {
            // a call with no braces (`\maketitle`) is its line; one with braces ends at its last `}`, with nothing after it
            let resto = ultimo_cierre.map_or("", |i| std::str::from_utf8(&b[i + 1..]).unwrap_or("x"));
            return (prof == 0 && resto.trim().is_empty()).then_some(j);
        }
    }
    None
}

/// `\a{\b{...}}` → `b`; `\begin{titlepage}` → `titlepage`; `\maketitle` → `maketitle`.
fn nombre_del_bloque(l: &str) -> Option<String> {
    if let Some(env) = l.strip_prefix("\\begin{").and_then(|r| r.split_once('}')).map(|(e, _)| e) {
        return Some(env.to_string());
    }
    let mut r = l;
    let mut nombre = None;
    while let Some(s) = r.strip_prefix('\\') {
        let len = s.bytes().take_while(|c| c.is_ascii_alphabetic() || *c == b'@').count();
        if len == 0 {
            break;
        }
        let c = &s[..len];
        // a wrapper that only decides (`\soloEnPDFCompleto{\caratulaTributo{...}}`) is named after what it wraps
        nombre = Some(c.to_string());
        r = s[len..].trim_start();
        match r.strip_prefix('{') {
            Some(dentro) if dentro.trim_start().starts_with('\\') => r = dentro.trim_start(),
            _ => break,
        }
    }
    nombre
}

/// Las líneas del driver que sacan esas piezas. Van en `begindocument/before`: ahí los paquetes ya definieron sus comandos y el
/// cuerpo todavía no los usó. `\RenewDocumentCommand` (del núcleo de LaTeX desde 2020) acepta los argumentos opcionales de cada uno.
/// The comment line that heads the pieces in a driver; the one line after it is their hook (`build::driver_lineas` writes both).
pub const MARCA_DEL_DRIVER: &str = "% --- piezas que el perfil saca ---";

/// What the pieces' hook runs, `None` if nothing is redefined. The profile's driver runs it at `begindocument/before`, Live's
/// right after `\begin{document}` (`build::render_driver_live`).
pub fn redefiniciones_del_driver(omitir: &[Pieza]) -> Option<String> {
    let mut cuerpo = Vec::new();
    for p in omitir {
        match p {
            Pieza::Toc => cuerpo.push("\\RenewDocumentCommand\\tableofcontents{}{}".to_string()),
            Pieza::Bibliography => {
                cuerpo.push("\\ifdefined\\printbibliography\\RenewDocumentCommand\\printbibliography{o}{}\\fi".into());
                cuerpo.push("\\ifdefined\\bibliography\\RenewDocumentCommand\\bibliography{m}{}\\fi".into());
            }
            Pieza::Index => cuerpo.push("\\ifdefined\\printindex\\RenewDocumentCommand\\printindex{o}{}\\fi".into()),
            // its lines are commented in a copy of its file: nothing to redefine
            Pieza::Bloque(_) | Pieza::Parte(_) => {}
            Pieza::Pdf(a) => cuerpo.push(format!("\\expandafter\\def\\csname lvsinpdf@\\detokenize{{{a}}}\\endcsname{{}}")),
        }
    }
    if omitir.iter().any(|p| matches!(p, Pieza::Pdf(_))) {
        // Un `\includepdf` cuyo archivo está en la lista no inserta nada; los demás siguen como siempre.
        cuerpo.push(
            "\\ifdefined\\includepdf\\NewCommandCopy\\lvIncludepdf\\includepdf\\RenewDocumentCommand\\includepdf{O{}m}{\\ifcsname lvsinpdf@\\detokenize{#2}\\endcsname\\else\\lvIncludepdf[#1]{#2}\\fi}\\fi"
                .into(),
        );
    }
    (!cuerpo.is_empty()).then(|| cuerpo.join(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_claves_van_y_vuelven() {
        for p in [Pieza::Toc, Pieza::Bibliography, Pieza::Index, Pieza::Pdf("Imagenes/Carátula/Tapa Libro R3.pdf".into())] {
            assert_eq!(Pieza::de_clave(&p.clave()), Some(p));
        }
        assert_eq!(Pieza::de_clave("pdf:"), None);
        assert_eq!(Pieza::de_clave("pdf:a}b"), None);
        assert_eq!(Pieza::de_clave("portada"), None);
    }

    #[test]
    fn a_mention_in_the_preamble_or_in_an_argument_is_not_the_bibliography_and_a_block_never_breaks_balance() {
        let d = tempfile::tempdir().unwrap();
        // the biblatex example: the preamble patches \printbibliography inside an open group
        std::fs::write(
            d.path().join("main.tex"),
            "\\documentclass{article}\n\\ifdefstring{\\x}{y}{%\n\\pretocmd{\\printbibliography}{\\greektext}{}{}}{}\n\\begin{document}\nText.\n\\printbibliography\n\\end{document}\n",
        )
        .unwrap();
        let ix = ProjectIndex::build(d.path(), "main.tex", &[]);
        let p = detectar(d.path(), &ix);
        let b = p.iter().find(|x| x.clave == "bibliography").unwrap();
        assert_eq!((b.linea, b.desde, b.hasta), (6, 6, 6));
        // the thesis: the block would run into an environment opened before it
        std::fs::write(
            d.path().join("main.tex"),
            "\\documentclass{book}\n\\begin{document}\n\\begin{spacing}{1}\n\\cleardoublepage\n\\bibliography{refs}\n\\end{spacing}\n\\begin{appendices}\nA\n\\end{appendices}\n\\end{document}\n",
        )
        .unwrap();
        let ix = ProjectIndex::build(d.path(), "main.tex", &[]);
        let p = detectar(d.path(), &ix);
        let b = p.iter().find(|x| x.clave == "bibliography").unwrap();
        assert!(b.hasta < 6, "the block must not swallow the end of spacing: {}..{}", b.desde, b.hasta);
    }

    #[test]
    fn detecta_las_piezas_del_marco_y_no_las_de_los_capitulos() {
        let d = tempfile::tempdir().unwrap();
        let w = |r: &str, t: &str| {
            let p = d.path().join(r);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w(
            "main.tex",
            "\\documentclass{book}\n\\begin{document}\n\\includepdf[width=1cm]{Imagenes/Tapa.pdf}\n\\tableofcontents\n% \\printindex\n\\include{cap1}\n\\include{cap2}\n\\printbibliography[heading=x]\n\\printindex\n\\includepdf{Imagenes/Contra.pdf}\n\\end{document}\n",
        );
        w("cap1.tex", "\\chapter{A}\\tableofcontents\n");
        w("cap2.tex", "\\chapter{B}\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &["include".to_string()]);
        let p = detectar(d.path(), &ix);
        let claves: Vec<&str> = p.iter().map(|x| x.clave.as_str()).collect();
        assert_eq!(claves, ["pdf:Imagenes/Tapa.pdf", "toc", "bibliography", "index", "pdf:Imagenes/Contra.pdf"]);
        assert_eq!(p[0].nombre, "Tapa");
        assert_eq!(p[0].lugar, "antes");
        assert_eq!(p[4].lugar, "despues");
        assert_eq!(p[3].linea, 9, "el \\printindex comentado de la línea 5 no cuenta");
    }

    #[test]
    fn a_block_the_body_prints_outside_the_parts_is_a_piece() {
        let d = tempfile::tempdir().unwrap();
        let w = |r: &str, t: &str| {
            let p = d.path().join(r);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w(
            "main.tex",
            "\\documentclass{article}\n\\input{defs}\n\\begin{document}\n\\pagestyle{empty}\n\\setFooter{a=b}\n\\onlyFull{\\cover{\n  title = {X},\n}}\n\\begin{titlepage}\nT\n\\end{titlepage}\n\\Ex{a}\n\\Ex{b}\n\\stamp{x} trailing\n\\end{document}\n",
        );
        w("defs.tex", "\\newcommand{\\Ex}[1]{\\input{ex/#1}}\n\\newcommand{\\setFooter}[1]{\\pgfkeys{/f/.cd,#1}}\n\\newcommand{\\onlyFull}[1]{#1}\n\\newcommand{\\cover}[1]{\\null}\n");
        w("ex/a.tex", "A\n");
        w("ex/b.tex", "B\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &["include".to_string()]);
        let p = detectar(d.path(), &ix);
        let got: Vec<(&str, u32, u32, &str)> = p.iter().map(|x| (x.clave.as_str(), x.desde, x.hasta, x.lugar.as_str())).collect();
        // `\pagestyle` and a macro that only sets keys print nothing; the parts are parts; a call with text after it is not offered
        assert_eq!(got, [("block:cover", 6, 8, "antes"), ("block:titlepage", 9, 11, "antes")]);
        let c = copias(d.path(), &p, &["block:cover".to_string()]);
        assert_eq!(c.len(), 1);
        assert!(c[0].1.contains("% lv: \\onlyFull{\\cover{\n% lv:   title = {X},\n% lv: }}\n\\begin{titlepage}"), "{}", c[0].1);
        assert_eq!(Pieza::de_clave("block:cover#2"), Some(Pieza::Bloque("cover#2".into())));
    }

    #[test]
    fn a_guide_is_read_from_a_copy_without_the_pieces_left_out_and_without_its_empty_headings() {
        let d = tempfile::tempdir().unwrap();
        let w = |r: &str, t: &str| {
            let p = d.path().join(r);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        w(
            "main.tex",
            "\\documentclass{article}\n\\usepackage{subfiles}\n\\newcommand{\\exercise}[1]{\\section{}\\input{ex/#1}}\n\\newcommand{\\makecover}{\\begin{titlepage}Cover\\end{titlepage}}\n\\begin{document}\n\\subfile{g1/main}\n\\end{document}\n",
        );
        w(
            "g1/main.tex",
            "\\documentclass[../main.tex]{subfiles}\r\n\\begin{document}\r\n\\makecover\r\n\\begin{credits}\r\nWho.\r\n\\end{credits}\r\n\\input{list}\r\n\\end{document}\r\n",
        );
        w("g1/list.tex", "\\part*{Intro}\n\\exercise{a}\n\n\\part*{Ejercicios}\n\\exercise{b}\n\\exercise{c}\n");
        for e in ["a", "b", "c"] {
            w(&format!("g1/ex/{e}.tex"), "Text.\n");
        }
        let ix = ProjectIndex::build(d.path(), "main.tex", &["include".to_string(), "subfile".to_string()]);
        let p = detectar(d.path(), &ix);
        let got: Vec<(&str, u32, u32, bool)> = p.iter().map(|x| (x.clave.as_str(), x.desde, x.hasta, x.firma.is_some())).collect();
        // an environment around what the guide loads is a piece too, and both can be left out
        assert_eq!(got, [("block:makecover@g1/main", 3, 3, true), ("block:credits@g1/main", 4, 6, true)]);
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        // the cover left out, the guide with only b and c: the cover's line is commented, and so is the heading left over a only
        let c = copias_en_partes(d.path(), &ix, &p, &s(&["block:makecover@g1/main"]), Some(&s(&["g1/main", "b", "c"])), &[]);
        let por: Vec<(&str, &str)> = c.iter().map(|(parte, rel, _)| (parte.as_str(), rel.as_str())).collect();
        assert_eq!(por, [("g1/main", "g1/main.tex"), ("g1/main", "g1/list.tex")]);
        // line ends kept, every line in its place
        assert_eq!(c[0].2, "\\documentclass[../main.tex]{subfiles}\r\n\\begin{document}\r\n% lv: \\makecover\r\n\\begin{credits}\r\nWho.\r\n\\end{credits}\r\n\\input{list}\r\n\\end{document}\r\n");
        assert_eq!(c[1].2, "% lv: \\part*{Intro}\n\\exercise{a}\n\n\\part*{Ejercicios}\n\\exercise{b}\n\\exercise{c}\n");
        // only the cover: nothing of the list is left, so neither heading is
        let c = copias_en_partes(d.path(), &ix, &p, &s(&["block:credits@g1/main"]), Some(&s(&["g1/main"])), &[]);
        assert!(c[0].2.contains("\\makecover\r\n% lv: \\begin{credits}\r\n% lv: Who.\r\n% lv: \\end{credits}"), "{}", c[0].2);
        assert!(c[1].2.starts_with("% lv: \\part*{Intro}\n\\exercise{a}\n\n% lv: \\part*{Ejercicios}\n"), "{}", c[1].2);
        // everything compiled and nothing left out: no copies
        assert!(copias_en_partes(d.path(), &ix, &p, &[], Some(&s(&["g1/main", "a", "b", "c"])), &[]).is_empty());
        assert!(copias_en_partes(d.path(), &ix, &p, &[], None, &[]).is_empty());
        // only exercise b chosen: the guide comes for its setup, so its headings go too, even the one over b
        let c = copias_en_partes(d.path(), &ix, &p, &[], Some(&s(&["g1/main", "b"])), &s(&["g1/main"]));
        let lista = c.iter().find(|(_, rel, _)| rel == "g1/list.tex").map(|(_, _, t)| t.as_str());
        assert_eq!(lista, Some("% lv: \\part*{Intro}\n\\exercise{a}\n\n% lv: \\part*{Ejercicios}\n\\exercise{b}\n\\exercise{c}\n"));
        // one exercise chosen (the chapter I am in): its guide comes for its setup, without its pieces; the guide chosen keeps them
        assert_eq!(solo_marco(&ix, &s(&["b"]), &s(&["g1/main", "b"])), s(&["g1/main"]));
        assert!(solo_marco(&ix, &s(&["g1/main"]), &s(&["g1/main", "a", "b", "c"])).is_empty());
    }

    #[test]
    fn a_key_without_a_guide_leaves_that_piece_out_of_every_guide() {
        let o = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(omitida("block:makecover@g1/main", &o(&["block:makecover@g1/main"])));
        assert!(!omitida("block:makecover@g2/main", &o(&["block:makecover@g1/main"])));
        // the chapter I am in: every guide's cover, also under the numbered names saved before guides had their own
        assert!(omitida("block:makecover@g2/main", &o(&["block:makecover"])));
        assert!(omitida("block:makecover@g2/main", &o(&["block:makecover#3"])));
        assert!(!omitida("block:makecovers@g2/main", &o(&["block:makecover"])));
        assert!(!omitida("block:credits@g2/main", &o(&["block:makecover"])));
    }

    #[test]
    fn two_blocks_of_one_name_in_a_part_have_their_own_keys() {
        let d = tempfile::tempdir().unwrap();
        let w = |r: &str, t: &str| {
            let p = d.path().join(r);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        // a setup that starts a page prints nothing: leaving it out would lose the guide's number and its figures' folder
        w("main.tex", "\\documentclass{article}\n\\usepackage{subfiles}\n\\newcommand{\\exercise}[1]{\\section{}\\input{ex/#1}}\n\\newcommand{\\guidesetup}[1]{\\clearpage\\graphicspath{{figures/}}}\n\\begin{document}\n\\subfile{g1/main}\n\\end{document}\n");
        w("g1/main.tex", "\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\guidesetup{number = 1}\n\\begin{itemize}\n\\item A\n\\end{itemize}\n\\input{list}\n\\begin{itemize}\n\\item B\n\\end{itemize}\n\\end{document}\n");
        w("g1/list.tex", "\\exercise{a}\n");
        // an exercise that loads its plot holds no parts: its lists are its text, not pieces
        w("g1/ex/a.tex", "\\begin{itemize}\n\\item Q\n\\end{itemize}\n\\input{plot}\n\\begin{itemize}\n\\item R\n\\end{itemize}\n");
        w("g1/ex/plot.tex", "x\n");
        let ix = ProjectIndex::build(d.path(), "main.tex", &["include".to_string(), "subfile".to_string()]);
        let claves: Vec<String> = detectar(d.path(), &ix).into_iter().map(|x| x.clave).collect();
        // the interface keys its list by them, and leaving one out must not leave out the other
        assert_eq!(claves, ["block:itemize@g1/main", "block:itemize#2@g1/main"]);
        assert!(claves.iter().all(|c| Pieza::de_clave(c).is_some()));
    }

    #[test]
    fn el_driver_anula_cada_pieza_por_separado() {
        assert!(redefiniciones_del_driver(&[]).is_none());
        let l = redefiniciones_del_driver(&[Pieza::Toc, Pieza::Pdf("Imagenes/Tapa.pdf".into())]).unwrap();
        assert!(l.contains("\\RenewDocumentCommand\\tableofcontents{}{}"));
        assert!(l.contains("lvsinpdf@\\detokenize{Imagenes/Tapa.pdf}"));
        assert!(l.contains("\\NewCommandCopy\\lvIncludepdf\\includepdf"));
        assert!(!l.contains("printbibliography"));
    }
}
