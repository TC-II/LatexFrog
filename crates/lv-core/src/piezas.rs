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
}

impl Pieza {
    pub fn clave(&self) -> String {
        match self {
            Pieza::Toc => "toc".into(),
            Pieza::Bibliography => "bibliography".into(),
            Pieza::Index => "index".into(),
            Pieza::Pdf(a) => format!("pdf:{a}"),
            Pieza::Bloque(n) => format!("block:{n}"),
        }
    }

    pub fn de_clave(c: &str) -> Option<Pieza> {
        match c {
            "toc" => Some(Pieza::Toc),
            "bibliography" => Some(Pieza::Bibliography),
            "index" => Some(Pieza::Index),
            _ if c.starts_with("block:") => c
                .strip_prefix("block:")
                .filter(|n| !n.is_empty() && n.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '#' | '*' | '@')))
                .map(|n| Pieza::Bloque(n.into())),
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
    /// Dónde está respecto de las partes: antes de la primera (`antes`), después de la última (`despues`) o entre ellas.
    pub lugar: String,
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
    for p in piezas.iter().filter(|p| omitir.contains(&p.clave)) {
        por_archivo.entry(p.archivo.as_str()).or_default().push(p);
    }
    let mut out = Vec::new();
    for (rel, ps) in por_archivo {
        let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
        let eol = if texto.contains("\r\n") { "\r\n" } else { "\n" };
        let lineas: Vec<&str> = texto.split(eol).collect();
        let sale: Vec<String> = lineas
            .iter()
            .enumerate()
            .map(|(n, l)| {
                let num = n as u32 + 1;
                let dentro = ps.iter().any(|p| num >= p.desde && num <= p.hasta);
                if dentro && !es_borde(l) { format!("% lv: {l}") } else { (*l).to_string() }
            })
            .collect();
        out.push((rel.to_string(), sale.join(eol)));
    }
    out
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
        for (n, l) in todas.iter().enumerate() {
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
                if !out.iter().any(|x| x.clave == p.clave()) {
                    out.push(PiezaInfo { clave: p.clave(), nombre, archivo: rel.clone(), linea, desde, hasta, lugar: lugar.into() });
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
fn bloques(root: &Path, ix: &ProjectIndex, out: &mut Vec<PiezaInfo>) {
    let mut m = crate::macros::Macros::default();
    for rel in ix.files.keys() {
        if let Ok(t) = std::fs::read_to_string(root.join(rel)) {
            m.read(&t);
        }
    }
    let cargadores = m.loaders();
    let preambulo = crate::formato::archivos_del_preambulo(ix);
    let de_partes: std::collections::BTreeSet<&str> =
        ix.parts.iter().flat_map(|p| p.file.iter().chain(p.others.iter())).map(String::as_str).collect();
    // the frame: the root and the files that call the parts (`libro_cuerpo.tex`); a content file outside any part is not one
    let marco: std::collections::BTreeSet<&str> = ix.parts.iter().map(|p| p.source.as_str()).collect();
    let mut archivos: Vec<&String> = ix
        .files
        .keys()
        .filter(|f| *f == &ix.root_file || (marco.contains(f.as_str()) && !preambulo.contains(f.as_str()) && !de_partes.contains(f.as_str())))
        .collect();
    archivos.sort_by_key(|f| (*f != &ix.root_file, (*f).clone()));
    let mut vistos: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for rel in archivos {
        let Ok(texto) = std::fs::read_to_string(root.join(rel)) else { continue };
        let lineas: Vec<&str> = texto.lines().collect();
        // lines that load files or parts: not blocks
        let cargan: std::collections::BTreeSet<u32> =
            ix.files.get(rel).into_iter().flatten().filter(|e| e.kind.estructural()).map(|e| e.line).collect();
        let lineas_de_partes: Vec<u32> = ix.parts.iter().filter(|p| &p.source == rel).map(|p| p.line).collect();
        // the root's preamble is not the body
        let mut n = if rel == &ix.root_file {
            match lineas.iter().position(|l| sin_comentario(l).contains("\\begin{document}")) {
                Some(i) => i + 1,
                None => continue,
            }
        } else {
            0
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
                !NO_PIEZA.contains(&c) && !c.ends_with("true") && !c.ends_with("false") && !m.only_sets(c, SOLO_AJUSTAN) && !cargadores.contains_key(c)
            });
            if let (Some(c), true, false, false) = (nombre, imprime, carga, cruza) {
                let k = vistos.entry(c.clone()).or_insert(0);
                *k += 1;
                let id = if *k == 1 { c.clone() } else { format!("{c}#{k}") };
                let lugar = match (lineas_de_partes.first(), lineas_de_partes.last()) {
                    (Some(&a), _) if linea < a => "antes",
                    (_, Some(&z)) if linea > z => "despues",
                    (Some(_), _) => "entre",
                    _ => "",
                };
                out.push(PiezaInfo { clave: Pieza::Bloque(id).clave(), nombre: c, archivo: rel.clone(), linea, desde: linea, hasta: fin as u32 + 1, lugar: lugar.into() });
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
pub fn lineas_del_driver(omitir: &[Pieza]) -> Vec<String> {
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
            Pieza::Bloque(_) => {}
            Pieza::Pdf(a) => cuerpo.push(format!("\\expandafter\\def\\csname lvsinpdf@\\detokenize{{{a}}}\\endcsname{{}}")),
        }
    }
    let mut l = Vec::new();
    if omitir.iter().any(|p| matches!(p, Pieza::Pdf(_))) {
        // Un `\includepdf` cuyo archivo está en la lista no inserta nada; los demás siguen como siempre.
        cuerpo.push(
            "\\ifdefined\\includepdf\\NewCommandCopy\\lvIncludepdf\\includepdf\\RenewDocumentCommand\\includepdf{O{}m}{\\ifcsname lvsinpdf@\\detokenize{#2}\\endcsname\\else\\lvIncludepdf[#1]{#2}\\fi}\\fi"
                .into(),
        );
    }
    if !cuerpo.is_empty() {
        l.push("% --- piezas que el perfil saca ---".into());
        l.push(format!("\\AddToHook{{begindocument/before}}{{{}}}", cuerpo.join("")));
    }
    l
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
    fn el_driver_anula_cada_pieza_por_separado() {
        assert!(lineas_del_driver(&[]).is_empty());
        let l = lineas_del_driver(&[Pieza::Toc, Pieza::Pdf("Imagenes/Tapa.pdf".into())]).join("\n");
        assert!(l.contains("\\RenewDocumentCommand\\tableofcontents{}{}"));
        assert!(l.contains("lvsinpdf@\\detokenize{Imagenes/Tapa.pdf}"));
        assert!(l.contains("\\NewCommandCopy\\lvIncludepdf\\includepdf"));
        assert!(!l.contains("printbibliography"));
    }
}
