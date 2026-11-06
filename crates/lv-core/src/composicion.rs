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
    Section { index: usize, part: Option<String>, piece: Option<String> },
    /// A part with no heading of its own: it still has a place, and a profile still chooses it.
    Part { name: String, file: String, line: u32 },
    /// A piece of the frame: its profile key (`omit`), its name and where it is.
    Piece { key: String, name: String, file: String, line: u32 },
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
    let mut con_titulo = std::collections::HashSet::new();
    for (i, s) in sections.iter().enumerate() {
        let part = ix.part_of(&s.file).map(|p| ix.parts[p].name.clone());
        if let Some(p) = &part {
            con_titulo.insert(p.clone());
        }
        let piece = piezas.iter().find(|p| p.archivo == s.file && (p.desde..=p.hasta).contains(&s.line)).map(|p| p.clave.clone());
        push(key(&s.file, s.line), Item::Section { index: i, part, piece }, &mut v);
    }
    for p in &ix.parts {
        if !con_titulo.contains(&p.name) {
            push(key(&p.source, p.line), Item::Part { name: p.name.clone(), file: p.file.clone().unwrap_or_else(|| p.source.clone()), line: p.line }, &mut v);
        }
    }
    for p in piezas {
        push(key(&p.archivo, p.desde.min(p.linea)), Item::Piece { key: p.clave.clone(), name: p.nombre.clone(), file: p.archivo.clone(), line: p.linea }, &mut v);
    }
    // stable: headings keep the outline's order among themselves when two have the same place
    v.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    v.into_iter().map(|(_, _, it)| it).collect()
}
