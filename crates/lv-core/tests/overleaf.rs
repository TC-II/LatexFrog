//! The projects in `fixtures/overleaf/` are laid out the way Overleaf's templates and common practice lay them out. Each one's
//! `expected.json` says what opening it must find: the folder the app opens, the main file, the parts, every heading in order, the
//! figures mode and, where there are TikZ figures, their captions. Nothing is written into the fixtures.

use lv_core::detectar::detectar;
use lv_core::figimages::{figuras_del_archivo, imagenes_del_proyecto};
use lv_core::graph::ProjectIndex;
use lv_core::symbols::Symbols;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("fixtures").join("overleaf")
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// What one fixture got wrong, empty when it matches its `expected.json`.
fn check(dir: &Path) -> Vec<String> {
    let exp: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
    let root = match exp["folder"].as_str() {
        Some(f) if f != "." => dir.join(f),
        _ => dir.to_path_buf(),
    };
    let mut bad = Vec::new();
    let p = match detectar(&root, None, None, &BTreeMap::new()) {
        Ok(p) => p,
        Err(e) => return vec![format!("detect: {e}")],
    };
    if exp["main"].as_str() != Some(p.raiz.as_str()) {
        bad.push(format!("main {:?}, expected {}", p.raiz, exp["main"]));
    }
    if exp["parts"].as_u64() != Some(p.partes.len() as u64) {
        bad.push(format!("parts {:?}, expected {}", p.partes, exp["parts"]));
    }
    if let Some(m) = exp["figures"].as_str() {
        if p.figuras.modo != m {
            bad.push(format!("figures {:?}, expected {m}", p.figuras.modo));
        }
    }
    let ix = ProjectIndex::build(&root, &p.raiz, &p.parts_commands);
    let sym = Symbols::build(&root, &ix);
    let got: Vec<String> = sym.sections.iter().map(|s| s.title.clone()).collect();
    if got != strings(&exp["headings"]) {
        bad.push(format!("headings {got:?}, expected {:?}", strings(&exp["headings"])));
    }
    if exp.get("imageCaptions").is_some() {
        // the `\includegraphics` images, by file
        let captions: Vec<String> = imagenes_del_proyecto(&root, &ix).into_iter().map(|i| i.caption.unwrap_or_default()).collect();
        if captions != strings(&exp["imageCaptions"]) {
            bad.push(format!("image captions {captions:?}, expected {:?}", strings(&exp["imageCaptions"])));
        }
    }
    if exp.get("figureCaptions").is_some() {
        // the main file first, then the others in the order their headings come
        let mut files = vec![p.raiz.clone()];
        for s in &sym.sections {
            if !files.contains(&s.file) {
                files.push(s.file.clone());
            }
        }
        let mut captions = Vec::new();
        for f in &files {
            let text = std::fs::read_to_string(root.join(f)).unwrap();
            captions.extend(figuras_del_archivo(&root, f, &text, "figures-cache", "000000", "x", false, &BTreeMap::new()).into_iter().map(|g| g.caption.unwrap_or_default()));
        }
        if captions != strings(&exp["figureCaptions"]) {
            bad.push(format!("captions {captions:?}, expected {:?}", strings(&exp["figureCaptions"])));
        }
    }
    bad
}

#[test]
fn every_overleaf_style_fixture_reads_as_expected() {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(fixtures()).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.join("expected.json").is_file()).collect();
    dirs.sort();
    assert!(dirs.len() >= 10, "fixtures/overleaf has {} projects", dirs.len());
    let failures: Vec<String> = dirs
        .iter()
        .filter_map(|d| {
            let bad = check(d);
            (!bad.is_empty()).then(|| format!("{}: {}", d.file_name().unwrap().to_string_lossy(), bad.join("; ")))
        })
        .collect();
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
