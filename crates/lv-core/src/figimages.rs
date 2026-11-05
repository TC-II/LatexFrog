//! Las figuras ya cocinadas de un archivo, en orden, para que el editor visual las muestre como imagen en lugar de su código.
//!
//! pgf nombra cada figura que externaliza `<prefijo><n>`: el prefijo es `<carpeta>/<sello>-<slug>-` (el slug del archivo, `\FigurasDe`
//! en el libro o el que pone la app) y `n` cuenta las figuras externalizadas con ese prefijo, desde 0, en el orden del documento. Con
//! `onlyInFigureEnv` sólo se externalizan las que están dentro de un entorno `figure`; las demás no cuentan. Este módulo repite esa
//! cuenta sobre el texto del archivo, incluidas las figuras de un archivo que se carga con `\input` dentro del `figure`.

use crate::graph::sin_comentario;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::OnceLock;

/// Una figura externalizada del archivo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FiguraEnArchivo {
    /// El texto del archivo que la trae: el entorno `tikzpicture` entero o el `\input{...}`. El editor visual lo busca en sus bloques.
    pub snippet: String,
    /// El nombre de pgf, sin carpeta (`C28EE5-butter-2`).
    pub nombre: String,
    /// Su PDF, relativo a la raíz, si ya está cocinada.
    pub pdf: Option<String>,
    /// Dónde está su código: el archivo mismo o el que carga con `\input`, y la línea del `\begin{tikzpicture}`.
    pub archivo: String,
    pub linea: u32,
    /// The line of the analysed file that brings it: the `tikzpicture` itself or the `\input`. The Figures tree places it by this line.
    pub donde_linea: u32,
    /// The `\caption` of the `figure` it is in, as readable text.
    pub caption: Option<String>,
    /// The `tikzpicture` itself, in `archivo`: what the visual editor of that file finds (`snippet` is what the analysed file shows).
    #[serde(skip)]
    pub propio: String,
}

/// The readable `\caption{...}` of a `figure` environment's text, skipping an optional `[short]` argument.
fn caption_de(figura: &str) -> Option<String> {
    let at = figura.find("\\caption")? + "\\caption".len();
    let rest = figura[at..].trim_start();
    let mut i = at + (figura[at..].len() - rest.len());
    if rest.starts_with('[') {
        let mut depth = 0;
        for (k, c) in rest.char_indices() {
            match c {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        i += k + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    let (texto, _) = crate::symbols::grupo(figura, i)?;
    let t = crate::symbols::titulo_legible(&texto.replace('\n', " "));
    (!t.is_empty()).then_some(t)
}

fn re_figura() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\\(begin|end)\s*\{(figure\*?|tikzpicture)\}|\\input\s*\{([^{}\\%]+)\}").expect("patrón válido"))
}

/// El archivo que carga `\input{x}`: con `.tex` si no tiene extensión, relativo a la raíz y sin salir de ella.
fn archivo_de_input(nombre: &str) -> Option<String> {
    let n = nombre.trim().trim_matches('"').replace('\\', "/");
    if n.is_empty() || n.starts_with("..") || n.starts_with('/') || n.contains(':') {
        return None;
    }
    Some(if n.rsplit('/').next().is_some_and(|f| f.contains('.')) { n } else { format!("{n}.tex") })
}

/// What every file scanned in one pass shares: pgf's running count for each prefix, and which files set a prefix of their own.
struct Cuenta<'a> {
    root: &'a Path,
    dir: &'a str,
    sello: &'a str,
    solo_en_figure: bool,
    propios: &'a BTreeMap<String, String>,
    n: HashMap<String, u32>,
    out: Vec<FiguraEnArchivo>,
}

impl Cuenta<'_> {
    fn agregar(&mut self, slug: &str, snippet: String, propio: String, archivo: String, linea: u32, donde_linea: u32) {
        let n = self.n.entry(slug.to_string()).or_default();
        let nombre = format!("{}-{slug}-{n}", self.sello);
        *n += 1;
        let pdf = format!("{}/{nombre}.pdf", self.dir.trim_end_matches('/'));
        let existe = self.root.join(&pdf).is_file();
        self.out.push(FiguraEnArchivo { snippet, nombre, pdf: existe.then_some(pdf), archivo, linea, donde_linea, caption: None, propio });
    }

    /// The figures of `texto` (the file `rel`, named with `slug`) in order. `traido`: the line and text of the analysed file's `\input`
    /// that brought `rel` in, so its figures are placed there; `dentro_inicial`: the `figure`s already open around that `\input`.
    fn recorrer(&mut self, rel: &str, texto: &str, slug: &str, traido: Option<(u32, &str)>, dentro_inicial: u32, prof: u32) {
        let mut dentro = dentro_inicial; // profundidad de `figure`
        let mut tikz = 0u32; // profundidad de `tikzpicture`, para tomar el entorno entero y no contar uno anidado
        let mut abierto: Option<(usize, u32)> = None;
        let mut base = 0;
        // where the open `figure` starts and the first figure added inside it: its caption goes to all of them when it closes
        let mut figura_abierta: Option<(usize, usize)> = None;
        for (num, l) in texto.split_inclusive('\n').enumerate() {
            let codigo = sin_comentario(l);
            for c in re_figura().captures_iter(codigo) {
                let m = c.get(0).expect("coincidencia");
                match (c.get(1).map(|x| x.as_str()), c.get(2).map(|x| x.as_str())) {
                    (Some("begin"), Some("tikzpicture")) => {
                        if tikz == 0 {
                            abierto = Some((base + m.start(), num as u32 + 1));
                        }
                        tikz += 1;
                    }
                    (Some("end"), Some("tikzpicture")) if tikz > 0 => {
                        tikz -= 1;
                        if tikz > 0 {
                            continue;
                        }
                        if let Some((ini, linea)) = abierto.take() {
                            if dentro > 0 || !self.solo_en_figure {
                                let propio = texto[ini..base + m.end()].to_string();
                                let (snippet, donde) = match traido {
                                    Some((l, t)) => (t.to_string(), l),
                                    None => (propio.clone(), linea),
                                };
                                self.agregar(slug, snippet, propio, rel.to_string(), linea, donde);
                            }
                        }
                    }
                    (Some("begin"), Some(_)) => {
                        if dentro == dentro_inicial {
                            figura_abierta = Some((base + m.start(), self.out.len()));
                        }
                        dentro += 1;
                    }
                    (Some("end"), Some(_)) => {
                        if dentro > dentro_inicial {
                            dentro -= 1;
                            if dentro == dentro_inicial {
                                if let Some((ini, primera)) = figura_abierta.take() {
                                    let caption = caption_de(&texto[ini..base + m.end()]);
                                    for f in &mut self.out[primera..] {
                                        f.caption = caption.clone();
                                    }
                                }
                            }
                        }
                    }
                    _ => {
                        // `\input{x}`: TeX reads x right here, so its figures come next in pgf's count. With `\FigurasDe` they carry this
                        // file's prefix; a file with a prefix of its own (every file in `app` mode) counts with its own.
                        if tikz > 0 || prof >= 8 {
                            continue;
                        }
                        let Some(otro) = c.get(3).and_then(|x| archivo_de_input(x.as_str())) else { continue };
                        let Ok(t) = std::fs::read_to_string(self.root.join(&otro)) else { continue };
                        let suyo = self.propios.get(&otro).cloned().unwrap_or_else(|| slug.to_string());
                        let traer = traido.unwrap_or((num as u32 + 1, m.as_str()));
                        self.recorrer(&otro, &t, &suyo, Some(traer), dentro, prof + 1);
                    }
                }
            }
            base += l.len();
        }
    }
}

/// Las figuras externalizadas de `texto` (el archivo `rel`) con el prefijo `<dir>/<sello>-<slug>-`, en orden, y las de los archivos que
/// trae con `\input`. `propios`: the files with a prefix of their own (file → slug); an inputted file not in it shares `slug`.
#[allow(clippy::too_many_arguments)]
pub fn figuras_del_archivo(
    root: &Path,
    rel: &str,
    texto: &str,
    dir: &str,
    sello: &str,
    slug: &str,
    solo_en_figure: bool,
    propios: &BTreeMap<String, String>,
) -> Vec<FiguraEnArchivo> {
    let mut c = Cuenta { root, dir, sello, solo_en_figure, propios, n: HashMap::new(), out: Vec::new() };
    c.recorrer(rel, texto, slug, None, 0, 0);
    c.out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuenta_como_pgf_las_figuras_dentro_de_figure_y_las_de_un_input() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("Secciones")).unwrap();
        std::fs::write(d.path().join("Secciones/fig_a.tex"), "% figura\n\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}\n").unwrap();
        std::fs::create_dir_all(d.path().join("cache")).unwrap();
        std::fs::write(d.path().join("cache/ABC123-cap-1.pdf"), "%PDF").unwrap();
        let texto = "\\FigurasDe{cap}\nTexto \\begin{tikzpicture}\\node{x};\\end{tikzpicture} suelto.\n\\begin{figure}[H]\n\\begin{tikzpicture}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\end{tikzpicture}\n\\end{figure}\n% \\begin{figure}\\begin{tikzpicture}\\end{tikzpicture}\\end{figure}\n\\begin{figure}\n\\input{Secciones/fig_a}\n\\end{figure}\n";
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", true, &BTreeMap::new());
        assert_eq!(v.iter().map(|f| (f.nombre.as_str(), f.archivo.as_str(), f.linea)).collect::<Vec<_>>(), [("ABC123-cap-0", "cap.tex", 4), ("ABC123-cap-1", "Secciones/fig_a.tex", 2)]);
        assert!(v[0].snippet.starts_with("\\begin{tikzpicture}\n\\begin{tikzpicture}") && v[0].snippet.ends_with("\\end{tikzpicture}\n\\end{tikzpicture}"), "{:?}", v[0].snippet);
        assert_eq!(v[1].snippet, "\\input{Secciones/fig_a}");
        assert_eq!((v[0].donde_linea, v[1].donde_linea), (4, 10));
        let caps = figuras_del_archivo(d.path(), "c.tex", "\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\caption[corto]{Un \\emph{filtro} pasabajos}\n\\end{figure}\n", "cache", "ABC123", "c", true, &BTreeMap::new());
        assert_eq!(caps[0].caption.as_deref(), Some("Un filtro pasabajos"));
        assert_eq!((v[0].pdf.as_deref(), v[1].pdf.as_deref()), (None, Some("cache/ABC123-cap-1.pdf")));
        // Sin `onlyInFigureEnv` la suelta también cuenta, y es la primera.
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", false, &BTreeMap::new());
        assert_eq!(v[0].linea, 2);
        assert_eq!(v.len(), 3);
    }

    /// The book's way: `\input{fig_x}` outside any `figure`, and the `figure` inside fig_x. pgf's count goes on through it, so the
    /// figure after it is one more; without following the `\input` every later figure of the chapter would take its neighbour's name.
    #[test]
    fn an_input_outside_a_figure_brings_its_figures_into_the_count() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("Secciones")).unwrap();
        std::fs::write(d.path().join("Secciones/fig_x.tex"), "% a figure\n\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\caption{From x}\n\\end{figure}\n").unwrap();
        let texto = "\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\caption{First}\n\\end{figure}\n\\input{Secciones/fig_x}\n\\begin{figure}\n\\begin{tikzpicture}\\end{tikzpicture}\n\\caption{Last}\n\\end{figure}\n";
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", true, &BTreeMap::new());
        let got: Vec<_> = v.iter().map(|f| (f.nombre.as_str(), f.archivo.as_str(), f.linea, f.donde_linea, f.caption.as_deref().unwrap_or(""))).collect();
        assert_eq!(got, [("ABC123-cap-0", "cap.tex", 2, 2, "First"), ("ABC123-cap-1", "Secciones/fig_x.tex", 3, 5, "From x"), ("ABC123-cap-2", "cap.tex", 7, 7, "Last")]);
        assert_eq!(v[1].snippet, "\\input{Secciones/fig_x}");
        assert_eq!(v[1].propio, "\\begin{tikzpicture}\\end{tikzpicture}");

        // in `app` mode the inputted file names its figures itself, with its own count; the chapter's count skips them
        let propios = BTreeMap::from([("Secciones/fig_x.tex".to_string(), "fig-x".to_string())]);
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", true, &propios);
        assert_eq!(v.iter().map(|f| f.nombre.as_str()).collect::<Vec<_>>(), ["ABC123-cap-0", "ABC123-fig-x-0", "ABC123-cap-1"]);
    }
}
