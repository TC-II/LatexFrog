//! User macros, read from their definitions, for what the include graph and the outline cannot see by name.
//!
//! - **Loaders**: macros that end in `\input`, `\include` or `\subfile` with a path built from their arguments, possibly
//!   through other macros. `\Ejercicio{slug}` calls `\ej@compilar{n}{slug}`, which does `\input{ejercicios/#2}`: the
//!   loader is `Ejercicio`, argument 0, path `ejercicios/{}`.
//! - **Headings**: macros that typeset one of their arguments as a heading: they wrap a sectioning command
//!   (`\section{#1}`) or set it large or bold (`\LARGE\textbf{#2}`). Their calls go to the outline.
//!
//! Like the rest of the index this is not TeX: it reads definitions as written and gives up on anything it cannot
//! follow (a path built with `\csname`, an argument that is expanded first). What it misses is a file that does not show.

use crate::graph::sin_comentario;
use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

/// How a loader brings its file in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadKind {
    Input,
    Include,
    Subfile,
}

/// A path a loader builds: `path` with `{}` in place of the call's mandatory argument number `arg`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathTemplate {
    pub kind: LoadKind,
    pub arg: usize,
    pub path: String,
}

/// A heading macro: its mandatory argument number `arg` is the title, at outline `level` (2 is `\section`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Heading {
    pub arg: usize,
    pub level: u8,
    /// The title is drawn by hand (`\LARGE\textbf{#2}`), not by a sectioning command: it has no level of its own, and the
    /// outline puts it above the document's real sections.
    pub drawn: bool,
}

#[derive(Debug, Clone)]
struct Definition {
    /// One entry per parameter `#1`, `#2`...: whether it is optional (`[...]` at the call).
    optional: Vec<bool>,
    body: String,
}

/// The definitions read from a set of files. The last one of a name wins, as `\renewcommand` would.
#[derive(Debug, Clone, Default)]
pub struct Macros {
    defs: HashMap<String, Definition>,
}

const SECTIONING: [&str; 7] = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
/// Longest definition body read: past this it is a package, not a project macro.
const MAX_BODY: usize = 20_000;
/// How deep a chain of macros is followed.
const MAX_DEPTH: usize = 8;

fn letter(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'@'
}

fn skip_blanks(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// The balanced `{...}` group at `b[i]`: its contents and the byte after it.
fn group(t: &str, i: usize) -> Option<(&str, usize)> {
    let b = t.as_bytes();
    if b.get(i) != Some(&b'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut j = i;
    while j < b.len() && j - i < MAX_BODY {
        match b[j] {
            b'\\' => j += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&t[i + 1..j], j + 1));
                }
            }
            _ => {}
        }
        j += 1;
    }
    None
}

/// The `[...]` group at `b[i]`: its contents and the byte after it.
fn bracket(t: &str, i: usize) -> Option<(&str, usize)> {
    let b = t.as_bytes();
    if b.get(i) != Some(&b'[') {
        return None;
    }
    let mut depth = 0i32;
    for j in i + 1..b.len().min(i + 400) {
        match b[j] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b']' if depth <= 0 => return Some((&t[i + 1..j], j + 1)),
            _ => {}
        }
    }
    None
}

/// A control sequence name (letters and `@`) at `b[i]`, which must be `\`.
fn control_name(t: &str, i: usize) -> Option<(&str, usize)> {
    let b = t.as_bytes();
    if b.get(i) != Some(&b'\\') {
        return None;
    }
    let mut j = i + 1;
    while j < b.len() && letter(b[j]) {
        j += 1;
    }
    (j > i + 1).then(|| (&t[i + 1..j], j))
}

/// The defined name in `{\Name}` or `\Name` at `i`.
fn defined_name(t: &str, i: usize) -> Option<(String, usize)> {
    let i = skip_blanks(t.as_bytes(), i);
    if let Some((inner, next)) = group(t, i) {
        let inner = inner.trim();
        let (n, end) = control_name(inner, 0)?;
        return (end == inner.len()).then(|| (n.to_string(), next));
    }
    control_name(t, i).map(|(n, next)| (n.to_string(), next))
}

/// Parameter kinds of an xparse argument spec (`m o O{x} s`): `true` for the optional ones.
fn xparse_params(spec: &str) -> Vec<bool> {
    let b = spec.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'm' | b'r' | b'R' | b'v' | b'b' => out.push(false),
            b'o' | b'd' | b's' | b't' | b'O' | b'D' | b'e' | b'E' | b'g' | b'G' => out.push(true),
            b'{' => {
                // the default of `O{...}`, not a parameter
                if let Some((_, next)) = group(spec, i) {
                    i = next;
                    continue;
                }
            }
            _ => {}
        }
        i += 1;
    }
    out
}

impl Macros {
    /// Reads the definitions in `text` (a whole `.tex` file). Later files override earlier ones.
    pub fn read(&mut self, text: &str) {
        // `\newcommand`, `\def`, and xparse's `\NewDocumentCommand` (capital C)
        if !text.contains("command") && !text.contains("Command") && !text.contains("def") {
            return;
        }
        let clean: String = text.lines().map(sin_comentario).collect::<Vec<_>>().join("\n");
        let t = clean.as_str();
        let b = t.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] != b'\\' {
                i += 1;
                continue;
            }
            let Some((cmd, after)) = control_name(t, i) else {
                i += 2;
                continue;
            };
            i = after;
            let parsed = match cmd {
                "newcommand" | "renewcommand" | "providecommand" => Self::latex_def(t, after),
                "def" | "gdef" => Self::tex_def(t, after),
                "NewDocumentCommand" | "RenewDocumentCommand" | "DeclareDocumentCommand" | "ProvideDocumentCommand" => Self::xparse_def(t, after),
                _ => None,
            };
            if let Some((name, def, next)) = parsed {
                self.defs.insert(name, def);
                i = next;
            }
        }
    }

    /// `\newcommand{\X}[n][default]{body}`, with or without the star.
    fn latex_def(t: &str, i: usize) -> Option<(String, Definition, usize)> {
        let b = t.as_bytes();
        let mut k = skip_blanks(b, i);
        if b.get(k) == Some(&b'*') {
            k += 1;
        }
        let (name, mut k) = defined_name(t, k)?;
        let mut count = 0usize;
        let mut has_default = false;
        k = skip_blanks(b, k);
        if let Some((n, next)) = bracket(t, k) {
            count = n.trim().parse().ok()?;
            k = skip_blanks(b, next);
            if let Some((_, next)) = bracket(t, k) {
                has_default = true;
                k = skip_blanks(b, next);
            }
        }
        let (body, next) = group(t, k)?;
        let optional = (0..count).map(|p| p == 0 && has_default).collect();
        Some((name, Definition { optional, body: body.to_string() }, next))
    }

    /// `\def\X#1#2{body}`: every parameter is mandatory.
    fn tex_def(t: &str, i: usize) -> Option<(String, Definition, usize)> {
        let b = t.as_bytes();
        let k = skip_blanks(b, i);
        let (name, mut k) = control_name(t, k)?;
        let name = name.to_string();
        let start = k;
        while k < b.len() && b[k] != b'{' && k - start < 40 {
            k += 1;
        }
        let params = t[start..k].matches('#').count();
        let (body, next) = group(t, k)?;
        Some((name, Definition { optional: vec![false; params], body: body.to_string() }, next))
    }

    /// `\NewDocumentCommand{\X}{m o}{body}`.
    fn xparse_def(t: &str, i: usize) -> Option<(String, Definition, usize)> {
        let b = t.as_bytes();
        let (name, k) = defined_name(t, i)?;
        let (spec, k) = group(t, skip_blanks(b, k))?;
        let (body, next) = group(t, skip_blanks(b, k))?;
        Some((name, Definition { optional: xparse_params(spec), body: body.to_string() }, next))
    }

    /// The mandatory argument number at the call for parameter `#p` (1-based), if it is mandatory.
    fn mandatory_index(def: &Definition, p: usize) -> Option<usize> {
        if p == 0 || p > def.optional.len() || def.optional[p - 1] {
            return None;
        }
        Some(def.optional[..p - 1].iter().filter(|o| !**o).count())
    }

    /// `name` only sets things (every command its definition calls is in `setters`, and it calls at least one):
    /// `\configurarFooter{...}` is `\pgfkeys{...}`, `\soloEjercicio` two `\def`. A call to it prints nothing.
    pub fn only_sets(&self, name: &str, setters: &[&str]) -> bool {
        let Some(d) = self.defs.get(name) else { return false };
        let cs = calls(&d.body);
        !cs.is_empty() && cs.iter().all(|(c, _)| setters.contains(c) || c.ends_with("true") || c.ends_with("false"))
    }

    /// Whether `name`, a project macro, prints something of its own: its definition, or a project macro it calls (a few levels
    /// down), opens a `titlepage` or a picture, sets a heading or puts in a graphic. `\makecover` does (`titlepage`),
    /// `\makesolutions` does (`\section*`); `\guidesetup` starts a page, stores keys and resets counters, and prints nothing.
    pub fn prints(&self, name: &str) -> bool {
        self.prints_at(name, 0)
    }

    fn prints_at(&self, name: &str, depth: usize) -> bool {
        let Some(d) = self.defs.get(name) else { return false };
        calls(&d.body).iter().any(|(c, args)| match *c {
            "begin" => args.first().is_some_and(|e| matches!(e.as_str(), "titlepage" | "tikzpicture" | "circuitikz" | "figure" | "table" | "multicols" | "center")),
            // a page break is not content: `\guidesetup` starts a page and then only stores keys (the guide's number, its figures'
            // folder), and leaving it out would break everything after it
            "maketitle" | "part" | "chapter" | "section" | "subsection" | "includegraphics" | "includepdf"
            | "tableofcontents" | "listoffigures" | "listoftables" => true,
            otro => depth < 3 && otro != name && self.prints_at(otro, depth + 1),
        })
    }

    /// How many parameters `name` takes, when none of them is optional: the driver can then wrap the macro with the same signature.
    /// What a macro with no parameters stands for when it is plain text (`\newcommand\exercisename{Ejercicio}`).
    pub fn plain_text(&self, name: &str) -> Option<String> {
        let d = self.defs.get(name)?;
        let t = d.body.trim();
        (d.optional.is_empty() && !t.is_empty() && !t.contains(['\\', '#', '{', '}', '%'])).then(|| t.to_string())
    }

    /// The argument specification that takes a call's arguments and does nothing with them (`+o+m` for `[2][]`): a call to
    /// leave out is swallowed whole.
    pub fn arg_spec(&self, name: &str) -> Option<String> {
        let d = self.defs.get(name)?;
        Some(d.optional.iter().map(|o| if *o { "+o" } else { "+m" }).collect())
    }

    pub fn mandatory_arity(&self, name: &str) -> Option<usize> {
        let d = self.defs.get(name)?;
        (!d.optional.iter().any(|o| *o)).then_some(d.optional.len())
    }

    /// Every loader, by name, with the paths it builds.
    pub fn loaders(&self) -> BTreeMap<String, Vec<PathTemplate>> {
        let kind = |c: &str| match c {
            "input" => Some(LoadKind::Input),
            "include" => Some(LoadKind::Include),
            "subfile" => Some(LoadKind::Subfile),
            _ => None,
        };
        let mut memo = HashMap::new();
        let mut out = BTreeMap::new();
        for name in self.defs.keys() {
            let t: Vec<PathTemplate> = self
                .templates(name, &|c| matches!(c, "input" | "include" | "subfile"), 0, &mut memo)
                .into_iter()
                .filter_map(|(base, arg, path)| Some(PathTemplate { kind: kind(&base)?, arg, path }))
                .collect();
            if !t.is_empty() {
                out.insert(name.clone(), t);
            }
        }
        out
    }

    /// Macros that set a label built from an argument (`\exercise{slug}` does `\label{ex:#1}`), by name: the call's mandatory
    /// argument number and the label with `{}` in its place. A call to one defines that label, as a `\label` would.
    pub fn label_makers(&self) -> BTreeMap<String, (usize, String)> {
        let mut memo = HashMap::new();
        let mut out = BTreeMap::new();
        for name in self.defs.keys() {
            if let Some((_, arg, label)) = self.templates(name, &|c| c == "label", 0, &mut memo).into_iter().next() {
                out.insert(name.clone(), (arg, label));
            }
        }
        out
    }

    /// The text a macro passes to one of the `base` commands, built from one of its mandatory arguments and followed through
    /// other macros: (that command, the call's argument number, the text with `{}` for the argument).
    fn templates(&self, name: &str, base: &dyn Fn(&str) -> bool, depth: usize, memo: &mut HashMap<String, Vec<(String, usize, String)>>) -> Vec<(String, usize, String)> {
        if let Some(t) = memo.get(name) {
            return t.clone();
        }
        let Some(def) = self.defs.get(name) else { return Vec::new() };
        // A cycle or a deep chain resolves to nothing rather than recursing forever.
        memo.insert(name.to_string(), Vec::new());
        let mut out: Vec<(String, usize, String)> = Vec::new();
        for (callee, args) in calls(&def.body) {
            let found: Vec<(String, usize, String)> = if base(callee) {
                args.first()
                    .and_then(|a| one_parameter(a))
                    .and_then(|(p, path)| Some((callee.to_string(), Self::mandatory_index(def, p)?, path)))
                    .into_iter()
                    .collect()
            } else if callee != name && depth < MAX_DEPTH && self.defs.contains_key(callee) {
                self.templates(callee, base, depth + 1, memo)
                    .into_iter()
                    .filter_map(|(c, arg, inner)| {
                        let (p, outer) = one_parameter(args.get(arg)?)?;
                        Some((c, Self::mandatory_index(def, p)?, inner.replace("{}", &outer)))
                    })
                    .collect()
            } else {
                Vec::new()
            };
            for t in found {
                if !out.iter().any(|o| o.1 == t.1 && o.2 == t.2) {
                    out.push(t);
                }
            }
        }
        memo.insert(name.to_string(), out.clone());
        out
    }

    /// The sectioning level a macro opens without taking the title from its arguments (`\section{}`, `\section*{Ejercicio}`),
    /// directly or through the macros it calls: the shallowest one.
    fn opens_section(&self, name: &str, depth: usize, seen: &mut Vec<String>) -> Option<u8> {
        if depth > MAX_DEPTH || seen.iter().any(|s| s == name) {
            return None;
        }
        seen.push(name.to_string());
        let def = self.defs.get(name)?;
        calls(&def.body)
            .into_iter()
            .filter_map(|(callee, args)| match SECTIONING.iter().position(|s| *s == callee) {
                Some(level) => (!args.first().is_some_and(|a| a.contains('#'))).then_some(level as u8),
                None if callee != name && self.defs.contains_key(callee) => self.opens_section(callee, depth + 1, seen),
                None => None,
            })
            .min()
    }

    /// Every heading macro, by name.
    pub fn headings(&self) -> BTreeMap<String, Heading> {
        static BIG: OnceLock<Regex> = OnceLock::new();
        // `\LARGE\textbf{#2}`, `{\bfseries #1}`, `\textbf{\Large #1}`: the parameter shortly after a large or bold switch.
        let big = BIG.get_or_init(|| Regex::new(r"\\(?:LARGE|Large|huge|Huge|textbf|bfseries)\b[^#]{0,16}#([1-9])").expect("valid pattern"));
        let mut out = BTreeMap::new();
        for (name, def) in &self.defs {
            // a macro that wraps a sectioning command takes its level
            let wrapped = calls(&def.body).into_iter().find_map(|(callee, args)| {
                let level = SECTIONING.iter().position(|s| *s == callee)? as u8;
                let (p, rest) = one_parameter(args.first()?)?;
                (rest == "{}").then_some((p, level, false))
            });
            let found = wrapped.or_else(|| {
                // only a macro that draws a heading by hand, not one that only sets text bold inline
                let large = ["\\LARGE", "\\Large", "\\huge", "\\Huge"].iter().any(|s| def.body.contains(s));
                let p = big.captures(&def.body)?.get(1)?.as_str().parse().ok()?;
                large.then_some((p, 2, true))
            });
            if let Some((p, level, drawn)) = found {
                if let Some(arg) = Self::mandatory_index(def, p) {
                    out.insert(name.clone(), Heading { arg, level, drawn });
                }
            }
        }
        // A loader that opens a section whose title it does not take from an argument (`\exercise{slug}`: `\section{}` and
        // `\input{exercises/#1}`) heads what it loads: its call is a heading at that level, named by the file it loads.
        for (name, ts) in self.loaders() {
            if out.contains_key(&name) {
                continue;
            }
            if let Some(level) = self.opens_section(&name, 0, &mut Vec::new()) {
                out.insert(name, Heading { arg: ts[0].arg, level, drawn: false });
            }
        }
        out
    }
}

/// `prefix/#2.tex` → (2, `prefix/{}.tex`) when the text holds exactly one parameter and nothing else to expand.
fn one_parameter(arg: &str) -> Option<(usize, String)> {
    let a = arg.trim().trim_matches('"').trim();
    if a.contains('\\') || a.matches('#').count() != 1 {
        return None;
    }
    let at = a.find('#')?;
    let p = a[at + 1..].chars().next()?.to_digit(10)? as usize;
    Some((p, format!("{}{{}}{}", &a[..at], &a[at + 2..])))
}

/// The commands called in a definition body with their brace arguments (`[...]`, `*` and `\expandafter` between them are
/// skipped). Arguments are not consumed: a call inside an argument is listed too.
fn calls(body: &str) -> Vec<(&str, Vec<String>)> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        let Some((name, after)) = control_name(body, i) else {
            i += 2;
            continue;
        };
        i = after;
        let mut args = Vec::new();
        let mut k = after;
        loop {
            k = skip_blanks(b, k);
            if b.get(k) == Some(&b'*') {
                k += 1;
                continue;
            }
            if body[k..].starts_with("\\expandafter") {
                k += "\\expandafter".len();
                continue;
            }
            if let Some((_, next)) = bracket(body, k) {
                k = next;
                continue;
            }
            match group(body, k) {
                Some((a, next)) if args.len() < 9 => {
                    args.push(a.to_string());
                    k = next;
                }
                _ => break,
            }
        }
        out.push((name, args));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn macros(text: &str) -> Macros {
        let mut m = Macros::default();
        m.read(text);
        m
    }

    #[test]
    fn a_chain_of_macros_builds_the_path_from_the_outer_argument() {
        let m = macros(concat!(
            "\\makeatletter\n",
            "\\newcommand{\\Ejercicio}[1]{\\stepcounter{e}\\ifx\\a\\b\n  \\expandafter\\ej@compilar\\expandafter{\\ej@num}{#1}%\n\\fi}\n",
            "\\newcommand{\\ej@compilar}[2]{\\clearpage\\input{ejercicios/#2}\\IfFileExists{sol/#2.tex}{\\ej@sol{#2}}{}}\n",
            "\\newcommand{\\ej@sol}[1]{\\input{sol/#1}}\n",
            "\\makeatother\n",
        ));
        let l = m.loaders();
        let t: Vec<_> = l["Ejercicio"].iter().map(|t| (t.kind, t.arg, t.path.as_str())).collect();
        assert_eq!(t, [(LoadKind::Input, 0, "ejercicios/{}"), (LoadKind::Input, 0, "sol/{}")]);
        assert_eq!(l["ej@compilar"][0].arg, 1);
    }

    #[test]
    fn optional_parameters_shift_the_mandatory_ones() {
        let m = macros("\\newcommand{\\A}[2][x]{\\include{cap/#2}}\n\\def\\B#1#2{\\input{#1/#2}}\n\\NewDocumentCommand{\\C}{o m}{\\subfile{#2}}\n");
        let l = m.loaders();
        assert_eq!(l["A"], [PathTemplate { kind: LoadKind::Include, arg: 0, path: "cap/{}".into() }]);
        assert!(!l.contains_key("B"), "two parameters in one path are not followed");
        assert_eq!(l["C"], [PathTemplate { kind: LoadKind::Subfile, arg: 0, path: "{}".into() }]);
    }

    #[test]
    fn recursion_and_expanded_paths_give_nothing() {
        let m = macros("\\newcommand{\\A}[1]{\\A{#1}}\n\\newcommand{\\B}[1]{\\input{\\dir/#1}}\n");
        assert!(m.loaders().is_empty());
    }

    #[test]
    fn headings_come_from_sectioning_wrappers_and_hand_drawn_titles() {
        let m = macros(concat!(
            "\\newcommand{\\metaEjercicio}[3][]{\\gdef\\t{#2}\\begin{center}\\large X\\\\\n\\LARGE\\textbf{#2}\\\\\\end{center}}\n",
            "\\newcommand{\\Tema}[1]{\\section{#1}}\n",
            "\\newcommand{\\resaltar}[1]{\\textbf{#1}}\n",
        ));
        let h = m.headings();
        assert_eq!(h["metaEjercicio"], Heading { arg: 0, level: 2, drawn: true });
        assert_eq!(h["Tema"], Heading { arg: 0, level: 2, drawn: false });
        assert!(!h.contains_key("resaltar"), "inline bold is not a heading");
    }

    #[test]
    fn a_loader_that_opens_a_section_is_a_heading_named_by_its_file_and_sets_a_label() {
        let m = macros(concat!(
            "\\makeatletter\n",
            "\\NewDocumentCommand\\exercise{m}{\\ex@break\\section{}\\ex@label{#1}\\input{exercises/#1}}\n",
            "\\newcommand\\ex@break{\\clearpage}\n",
            "\\newcommand\\ex@label[1]{\\label{ex:#1}}\n",
            "\\newcommand\\worked[1]{\\par\\input{examples/#1}}\n",
            "\\makeatother\n",
        ));
        let h = m.headings();
        assert_eq!(h["exercise"], Heading { arg: 0, level: 2, drawn: false });
        assert!(!h.contains_key("worked"), "a loader that opens no section is not a heading");
        assert_eq!(m.label_makers()["exercise"], (0, "ex:{}".to_string()));
    }

    #[test]
    fn a_file_with_only_xparse_definitions_is_read() {
        let m = macros("\\NewDocumentCommand\\exercise{m}{\\input{exercises/#1}}\n");
        assert_eq!(m.loaders()["exercise"], [PathTemplate { kind: LoadKind::Input, arg: 0, path: "exercises/{}".into() }]);
    }
}
