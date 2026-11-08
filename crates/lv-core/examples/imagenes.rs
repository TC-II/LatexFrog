//! Prints each image the code inserts and where the engine finds it: `cargo run -p lv-core --example imagenes -- <folder> [file...]`, and the folders the editor
//! looks in for each file given.
use lv_core::config::read_config;
use lv_core::graph::{EdgeKind, ProjectIndex};
use std::path::Path;

fn main() {
    let carpeta = std::env::args().nth(1).expect("uso: imagenes <carpeta>");
    let root = Path::new(&carpeta);
    let cfg = read_config(root).ok().flatten();
    let raiz = cfg.as_ref().map(|c| c.root.clone()).unwrap_or_else(|| "main.tex".into());
    let comandos = cfg.map(|c| c.parts.commands).unwrap_or_else(|| vec!["include".into()]);
    let ix = ProjectIndex::build(root, &raiz, &comandos);
    for (rel, edges) in &ix.files {
        for e in edges.iter().filter(|e| e.kind == EdgeKind::Graphics) {
            println!("{rel}:{} {} -> {:?}", e.line, e.raw, e.target);
        }
    }
    for f in std::env::args().skip(2) {
        println!("image dirs of {f}: {:?}", ix.image_dirs(&f));
    }
}
