//! Prints what Contents and the profiles show for a project: `cargo run -p lv-core --example composicion -- <folder>`.

use lv_core::config::read_config;
use lv_core::graph::ProjectIndex;
use lv_core::symbols::Symbols;
use std::path::Path;

fn main() {
    let carpeta = std::env::args().nth(1).expect("uso: composicion <carpeta>");
    let root = Path::new(&carpeta);
    let cfg = read_config(root).ok().flatten();
    let raiz = cfg.as_ref().map(|c| c.root.clone()).unwrap_or_else(|| "main.tex".into());
    let comandos = cfg.map(|c| c.parts.commands).unwrap_or_else(|| vec!["include".into()]);
    let ix = ProjectIndex::build(root, &raiz, &comandos);
    let s = Symbols::build(root, &ix);
    let piezas = lv_core::piezas::detectar(root, &ix);
    for p in &ix.parts {
        println!("part {} -> {}", p.name, serde_json::to_string(p).unwrap());
    }
    for it in lv_core::composicion::build(&ix, &s.sections, &piezas) {
        match it {
            lv_core::composicion::Item::Section { index, part, piece, opens } => {
                let x = &s.sections[index];
                println!("  {}sec L{} {:?} [{}:{}] part={part:?} piece={piece:?} opens={opens:?}", "  ".repeat(x.level as usize), x.level, x.title, x.file, x.line);
            }
            otro => println!("{}", serde_json::to_string(&otro).unwrap()),
        }
    }
}
