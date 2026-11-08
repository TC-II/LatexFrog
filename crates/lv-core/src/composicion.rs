//! What the document is made of, in document order, from one rule: the headings of the outline, each one in its part (or in
//! the frame), and the pieces the body prints outside the parts (`piezas`). Contents shows this list and a profile chooses
//! from it, so what one shows the other can leave out.
use crate::graph::ProjectIndex;
use crate::piezas::PiezaInfo;
use crate::symbols::Section;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Item {
    /// `sections[index]` of the same `Symbols`, the part it belongs to (`None` in the frame), and the piece whose block holds it
    /// (the bibliography's own heading): a profile that omits the piece leaves the heading out too.
    /// `opens`: the file of the part a heading heads at its call (`\exercise{slug}` sets the heading and loads `exercises/slug`):
    /// going to the heading opens that file, where the exercise is written, not the list that calls it.
    Section {
        index: usize,
        part: Option<String>,
        piece: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        opens: Option<String>,
    },
    /// A part with no heading of its own: it still has a place, and a profile still chooses it.
    Part { name: String, label: String, file: String, line: u32 },
    /// A piece: its profile key (`omit`), its name, where it is, and the part whose file prints it (`None` in the frame).
    Piece { key: String, name: String, file: String, line: u32, part: Option<String> },
}

pub fn build(ix: &ProjectIndex, sections: &[Section], piezas: &[PiezaInfo]) -> Vec<Item> {
    let mut v: Vec<(Vec<u32>, usize, Item)> = Vec::new();
    let mut seq = 0usize;
    let mut push = |k: Vec<u32>, it: Item, v: &mut Vec<(Vec<u32>, usize, Item)>| {
        v.push((k, seq, it));
        seq += 1;
    };
    let key = |file: &str, line: u32| {
        let mut k = ix.position(file);
        k.push(line);
        k
    };
    // A part is headed by its first heading when that one is above every other heading in the parts (a chapter file opens
    // with its `\chapter`, and only sections follow, in it or in any other part). A part that opens with a heading like the
    // ones inside parts (one guide's first exercise, or its first `\part` of two) has no title of its own and keeps its own
    // entry, so the parts still show as the document's top level.
    //
    // A heading on the very line that calls a part heads that part: `\exercise{slug}` sets the exercise's `\section` and loads
    // its file, so the heading at that line is the exercise's, not its guide's, and the exercise needs no entry of its own.
    let en_la_llamada = |s: &Section| ix.parts.iter().find(|p| p.source == s.file && p.line == s.line).map(|p| p.name.clone());
    let parte_de = |s: &Section| en_la_llamada(s).or_else(|| ix.part_of(&s.file).map(|p| ix.parts[p].name.clone()));
    let mut con_titulo: std::collections::HashSet<String> = sections.iter().filter_map(en_la_llamada).collect();
    // the rule above among the top level parts; a part inside a group (an exercise inside a guide) is headed only at its call
    let mut niveles: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();
    for s in sections {
        if let Some(p) = parte_de(s).filter(|p| ix.parts.iter().any(|q| &q.name == p && q.group.is_none())) {
            niveles.entry(p).or_default().push(s.level);
        }
    }
    let dentro = niveles.values().flat_map(|ls| ls[1..].iter().copied()).min().unwrap_or(u8::MAX);
    con_titulo.extend(niveles.into_iter().filter(|(_, ls)| ls[0] < dentro).map(|(p, _)| p));
    for (i, s) in sections.iter().enumerate() {
        let part = parte_de(s);
        let piece = piezas.iter().find(|p| p.archivo == s.file && (p.desde..=p.hasta).contains(&s.line)).map(|p| p.clave.clone());
        let opens = ix.parts.iter().find(|p| p.source == s.file && p.line == s.line).and_then(|p| p.file.clone());
        push(key(&s.file, s.line), Item::Section { index: i, part, piece, opens }, &mut v);
    }
    for p in &ix.parts {
        if !con_titulo.contains(&p.name) {
            push(key(&p.source, p.line), Item::Part { name: p.name.clone(), label: p.label.clone(), file: p.file.clone().unwrap_or_else(|| p.source.clone()), line: p.line }, &mut v);
        }
    }
    for p in piezas {
        push(key(&p.archivo, p.desde.min(p.linea)), Item::Piece { key: p.clave.clone(), name: p.nombre.clone(), file: p.archivo.clone(), line: p.linea, part: p.parte.clone() }, &mut v);
    }
    // stable: headings keep the outline's order among themselves when two have the same place
    v.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    v.into_iter().map(|(_, _, it)| it).collect()
}
