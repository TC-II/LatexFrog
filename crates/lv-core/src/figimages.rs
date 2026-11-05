//! Las figuras ya cocinadas de un archivo, en orden, para que el editor visual las muestre como imagen en lugar de su código.
//!
//! pgf nombra cada figura que externaliza `<prefijo><n>`: el prefijo es `<carpeta>/<sello>-<slug>-` (el slug del archivo, `\FigurasDe`
//! en el libro o el que pone la app) y `n` cuenta las figuras externalizadas con ese prefijo, desde 0, en el orden del documento. Con
//! `onlyInFigureEnv` sólo se externalizan las que están dentro de un entorno `figure`; las demás no cuentan. Este módulo repite esa
//! cuenta sobre el texto del archivo, incluidas las figuras de un archivo que se carga con `\input` dentro del `figure`.

use crate::graph::sin_comentario;
use regex::Regex;
use serde::Serialize;
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
}

fn re_figura() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\\(begin|end)\s*\{(figure\*?|tikzpicture)\}|\\input\s*\{([^{}\\%]+)\}").expect("patrón válido"))
}

/// Las posiciones (inicio, fin y línea desde 1) de cada `tikzpicture` de primer nivel del texto, sin mirar los comentarios.
fn tikzpictures(texto: &str) -> Vec<(usize, usize, u32)> {
    let mut v = Vec::new();
    let (mut abierto, mut prof) = (None::<(usize, u32)>, 0);
    let mut base = 0;
    for (n, l) in texto.split_inclusive('\n').enumerate() {
        for c in re_figura().captures_iter(sin_comentario(l)) {
            let m = c.get(0).expect("coincidencia");
            if c.get(2).map(|e| e.as_str()) != Some("tikzpicture") {
                continue;
            }
            if &c[1] == "begin" {
                if prof == 0 {
                    abierto = Some((base + m.start(), n as u32 + 1));
                }
                prof += 1;
            } else if prof > 0 {
                prof -= 1;
                if prof == 0 {
                    if let Some((ini, linea)) = abierto.take() {
                        v.push((ini, base + m.end(), linea));
                    }
                }
            }
        }
        base += l.len();
    }
    v
}

/// El archivo que carga `\input{x}`: con `.tex` si no tiene extensión, relativo a la raíz y sin salir de ella.
fn archivo_de_input(nombre: &str) -> Option<String> {
    let n = nombre.trim().trim_matches('"').replace('\\', "/");
    if n.is_empty() || n.starts_with("..") || n.starts_with('/') || n.contains(':') {
        return None;
    }
    Some(if n.rsplit('/').next().is_some_and(|f| f.contains('.')) { n } else { format!("{n}.tex") })
}

/// Las figuras externalizadas de `texto` (el archivo `rel`) con el prefijo `<dir>/<sello>-<slug>-`, en orden.
pub fn figuras_del_archivo(root: &Path, rel: &str, texto: &str, dir: &str, sello: &str, slug: &str, solo_en_figure: bool) -> Vec<FiguraEnArchivo> {
    let mut out = Vec::new();
    let mut dentro = 0u32; // profundidad de `figure`
    let mut tikz = 0u32; // profundidad de `tikzpicture`, para tomar el entorno entero y no contar uno anidado
    let mut abierto: Option<(usize, u32)> = None;
    let mut base = 0;
    let mut n = 0u32;
    let mut agregar = |out: &mut Vec<FiguraEnArchivo>, snippet: String, archivo: String, linea: u32| {
        let nombre = format!("{sello}-{slug}-{n}");
        let pdf = format!("{}/{nombre}.pdf", dir.trim_end_matches('/'));
        let existe = root.join(&pdf).is_file();
        out.push(FiguraEnArchivo { snippet, nombre, pdf: existe.then_some(pdf), archivo, linea });
        n += 1;
    };
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
                        if dentro > 0 || !solo_en_figure {
                            agregar(&mut out, texto[ini..base + m.end()].to_string(), rel.to_string(), linea);
                        }
                    }
                }
                (Some("begin"), Some(_)) => dentro += 1,
                (Some("end"), Some(_)) => dentro = dentro.saturating_sub(1),
                _ => {
                    // `\input{x}` dentro de un `figure`: cada `tikzpicture` de x es una figura más de este archivo.
                    if tikz > 0 || (dentro == 0 && solo_en_figure) {
                        continue;
                    }
                    let Some(otro) = c.get(3).and_then(|x| archivo_de_input(x.as_str())) else { continue };
                    let Ok(t) = std::fs::read_to_string(root.join(&otro)) else { continue };
                    for (_, _, linea) in tikzpictures(&t) {
                        agregar(&mut out, m.as_str().to_string(), otro.clone(), linea);
                    }
                }
            }
        }
        base += l.len();
    }
    out
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
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", true);
        assert_eq!(v.iter().map(|f| (f.nombre.as_str(), f.archivo.as_str(), f.linea)).collect::<Vec<_>>(), [("ABC123-cap-0", "cap.tex", 4), ("ABC123-cap-1", "Secciones/fig_a.tex", 2)]);
        assert!(v[0].snippet.starts_with("\\begin{tikzpicture}\n\\begin{tikzpicture}") && v[0].snippet.ends_with("\\end{tikzpicture}\n\\end{tikzpicture}"), "{:?}", v[0].snippet);
        assert_eq!(v[1].snippet, "\\input{Secciones/fig_a}");
        assert_eq!((v[0].pdf.as_deref(), v[1].pdf.as_deref()), (None, Some("cache/ABC123-cap-1.pdf")));
        // Sin `onlyInFigureEnv` la suelta también cuenta, y es la primera.
        let v = figuras_del_archivo(d.path(), "cap.tex", texto, "cache", "ABC123", "cap", false);
        assert_eq!(v[0].linea, 2);
        assert_eq!(v.len(), 3);
    }
}
