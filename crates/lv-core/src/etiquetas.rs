//! The name a part goes by in the app, from one rule, so Contents and the profiles call it the same.
//!
//! LaTeX has no property for "this included file is called X", so the name is read from what the file already says, in order:
//! 1. `\title{...}` in the part's file;
//! 2. a `title = ...` key, the way a class takes a guide's title (`\guidesetup{title = {...}}`);
//! 3. its first `\part`, `\chapter` or `\section` with a title, or its first call to one of the project's macros that set a
//!    title (`\metaEjercicio{Título}{...}`), by the argument that holds it;
//! 4. its path: the file's name, or its folder's when the file's name says nothing (`contents/G1/main` is `G1`).
//!
//! Only the part's own file is read, from its `\begin{document}` when it is a subfile (its preamble is the main document's):
//! what heads a part is written in it, not in what it includes.

use crate::graph::{sin_comentario, Part};
use std::path::Path;

/// File names that say nothing about what is in them: the folder names the part instead.
const GENERICOS: &[&str] = &["main", "index", "content", "contents", "body", "document", "chapter", "root", "master", "text"];

/// `titulos`: the project's macros that set a title, each with the index of the mandatory argument that holds it.
pub fn de_parte(root: &Path, p: &Part, titulos: &[(String, usize)]) -> String {
    let texto = p.file.as_ref().and_then(|f| std::fs::read(root.join(f)).ok()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    de_texto_con(&texto, titulos).unwrap_or_else(|| de_ruta(&p.name))
}

pub fn de_texto(texto: &str) -> Option<String> {
    de_texto_con(texto, &[])
}

/// The title a part's file gives itself (steps 1 to 3), as plain text.
pub fn de_texto_con(texto: &str, titulos: &[(String, usize)]) -> Option<String> {
    let limpio = texto.lines().map(sin_comentario).collect::<Vec<_>>().join("\n");
    let cuerpo = limpio.find("\\begin{document}").map_or(limpio.as_str(), |i| &limpio[i..]);
    let mut encabezados: Vec<(&str, usize)> = vec![("part", 0), ("chapter", 0), ("section", 0)];
    encabezados.extend(titulos.iter().map(|(n, i)| (n.as_str(), *i)));
    [arg_de_comando(cuerpo, &[("title", 0)]), clave_title(cuerpo), arg_de_comando(cuerpo, &encabezados)]
        .into_iter()
        .flatten()
        .map(|t| texto_plano(&t))
        .find(|t| !t.is_empty())
}

/// Step 4: the last piece of the path, or the folder before it when that piece is a generic name.
pub fn de_ruta(name: &str) -> String {
    let partes: Vec<&str> = name.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    let ultimo = partes.last().copied().unwrap_or(name);
    let ultimo = ultimo.strip_suffix(".tex").unwrap_or(ultimo);
    match partes.len() {
        n if n > 1 && GENERICOS.contains(&ultimo.to_lowercase().as_str()) => partes[n - 2].to_string(),
        _ => ultimo.to_string(),
    }
}

/// The braced group that starts at `i` (`s[i] == '{'`), without its braces, and where it ends.
fn grupo(s: &str, i: usize) -> Option<(String, usize)> {
    let mut prof = 0i32;
    let mut barra = false;
    for (j, c) in s[i..].char_indices() {
        if barra {
            barra = false;
            continue;
        }
        match c {
            '\\' => barra = true,
            '{' => prof += 1,
            '}' => {
                prof -= 1;
                if prof == 0 {
                    return Some((s[i + 1..i + j].to_string(), i + j + 1));
                }
            }
            _ => {}
        }
    }
    None
}

/// The given mandatory argument of the first call to one of `nombres` that has a non-empty one (`\section*[corto]{Largo}`
/// gives `Largo`; an empty `\section{}` is skipped). Optional arguments do not count.
fn arg_de_comando(s: &str, nombres: &[(&str, usize)]) -> Option<String> {
    let b = s.as_bytes();
    let mut i = 0;
    while let Some(k) = s[i..].find('\\') {
        let ini = i + k + 1;
        let fin = ini + s[ini..].bytes().take_while(u8::is_ascii_alphabetic).count();
        i = fin.max(ini + 1).min(s.len());
        let Some(&(_, n)) = nombres.iter().find(|(x, _)| *x == &s[ini..fin]) else { continue };
        let mut j = fin;
        if b.get(j) == Some(&b'*') {
            j += 1;
        }
        let mut visto = 0;
        loop {
            while b.get(j).is_some_and(u8::is_ascii_whitespace) {
                j += 1;
            }
            match b.get(j) {
                Some(b'[') => match s[j..].find(']') {
                    Some(c) => j += c + 1,
                    None => break,
                },
                Some(b'{') => {
                    let Some((arg, f)) = grupo(s, j) else { break };
                    if visto == n {
                        if !arg.trim().is_empty() {
                            return Some(arg);
                        }
                        break;
                    }
                    visto += 1;
                    j = f;
                }
                _ => break,
            }
        }
    }
    None
}

/// A `title = {...}` (or `title = text,`) key in a key-value argument. `cover-title` and `subtitle` are other keys.
fn clave_title(s: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?:^|[\s,\[{])title\s*=\s*").ok()?;
    for m in re.find_iter(s) {
        let j = m.end();
        let v = if s[j..].starts_with('{') {
            grupo(s, j).map(|(a, _)| a)
        } else {
            let fin = s[j..].find([',', '}', ']', '\n']).map_or(s.len(), |k| j + k);
            Some(s[j..fin].to_string())
        };
        if let Some(v) = v.filter(|v| !v.trim().is_empty()) {
            return Some(v);
        }
    }
    None
}

/// What a title reads as: line breaks and ties are spaces, a command's name goes and its argument stays, escaped characters are
/// themselves.
fn texto_plano(t: &str) -> String {
    let mut out = String::new();
    let mut cs = t.chars().peekable();
    while let Some(c) = cs.next() {
        match c {
            '\\' => match cs.peek().copied() {
                Some(x) if x.is_ascii_alphabetic() => {
                    while cs.peek().is_some_and(|x| x.is_ascii_alphabetic()) {
                        cs.next();
                    }
                    out.push(' ');
                }
                Some(x @ ('&' | '%' | '_' | '#' | '$' | '{' | '}')) => {
                    cs.next();
                    out.push(x);
                }
                Some(a @ ('\'' | '`' | '^' | '"' | '~')) => {
                    cs.next();
                    // `\'a` and `\'{a}`
                    let llave = cs.peek() == Some(&'{');
                    if llave {
                        cs.next();
                    }
                    if let Some(l) = cs.next() {
                        out.push(acento(a, l));
                    }
                    if llave && cs.peek() == Some(&'}') {
                        cs.next();
                    }
                }
                Some(_) => {
                    cs.next();
                    out.push(' ');
                }
                None => {}
            },
            '{' | '}' | '$' => {}
            '~' => out.push(' '),
            c => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `\'a` is `á`: the accented letters a Spanish, Portuguese, French or German title uses. Any other stays unaccented.
fn acento(a: char, l: char) -> char {
    let tabla: &[(char, &str, &str)] = &[
        ('\'', "aeiouyAEIOUY", "áéíóúýÁÉÍÓÚÝ"),
        ('`', "aeiouAEIOU", "àèìòùÀÈÌÒÙ"),
        ('^', "aeiouAEIOU", "âêîôûÂÊÎÔÛ"),
        ('"', "aeiouyAEIOU", "äëïöüÿÄËÏÖÜ"),
        ('~', "anoANO", "ãñõÃÑÕ"),
    ];
    tabla
        .iter()
        .find(|(x, _, _)| *x == a)
        .and_then(|(_, de, a)| de.chars().position(|c| c == l).and_then(|i| a.chars().nth(i)))
        .unwrap_or(l)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_guide_is_named_by_the_title_its_setup_command_gives_it() {
        let t = "\\documentclass[../../main.tex]{subfiles}\n\\begin{document}\n\\guidesetup{\n  number = 1,\n  title = {An\\'alisis de par\\'ametros},\n  cover-title = {An\\'alisis de \\\\ par\\'ametros},\n}\n\\makecover\n\\input{exercise-list}\n\\end{document}\n";
        assert_eq!(de_texto(t).as_deref(), Some("Análisis de parámetros"));
        assert_eq!(de_texto("\\section{Compensaci\\'{o}n y se\\~nal}").as_deref(), Some("Compensación y señal"));
        let t = "\\begin{document}\n\\guidesetup{number = 2, title = {Fuentes de alimentaci\u{f3}n \\\\ lineales}}\n";
        assert_eq!(de_texto(t).as_deref(), Some("Fuentes de alimentaci\u{f3}n lineales"));
    }

    #[test]
    fn title_then_key_then_first_heading() {
        assert_eq!(de_texto("\\title{El libro}\n\\chapter{Uno}").as_deref(), Some("El libro"));
        assert_eq!(de_texto("\\chapter[Corto]{Introducci\u{f3}n a \\emph{todo}}\n\\section{x}").as_deref(), Some("Introducci\u{f3}n a todo"));
        // an empty heading (an exercise's `\section{}`) names nothing; `\sectionmark` is another command
        assert_eq!(de_texto("\\sectionmark{no}\\section{}\n\\section*{Segundo}").as_deref(), Some("Segundo"));
        assert_eq!(de_texto("\\setup{subtitle = Otro, title = Simple, color = red}").as_deref(), Some("Simple"));
        // a commented title does not count, and the main document's preamble is not the subfile's
        assert_eq!(de_texto("% \\title{No}\nTexto"), None);
        assert_eq!(de_texto("\\title{Del preambulo}\n\\begin{document}\nTexto\n"), None);
    }

    #[test]
    fn a_project_macro_that_sets_a_title_names_the_part_by_its_argument() {
        let t = "\\metaEjercicio[azul]{Ejemplo: Compensaci\\'on}{Rev 1}\n\\section{}\n";
        assert_eq!(de_texto_con(t, &[("metaEjercicio".into(), 0)]).as_deref(), Some("Ejemplo: Compensaci\u{f3}n"));
        assert_eq!(de_texto_con(t, &[("metaEjercicio".into(), 1)]).as_deref(), Some("Rev 1"));
        assert_eq!(de_texto(t), None);
    }

    #[test]
    fn without_a_title_the_path_names_it_and_a_generic_file_name_gives_way_to_its_folder() {
        assert_eq!(de_ruta("contents/G1/main"), "G1");
        assert_eq!(de_ruta("capitulos/cap03-filtros"), "cap03-filtros");
        assert_eq!(de_ruta("Main.tex"), "Main");
        assert_eq!(de_ruta("./intro"), "intro");
    }
}
