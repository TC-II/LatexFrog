//! Moves a project from the old names (`latexviewer.json`, `.lv/`) to the new ones when it opens, and the configuration from the top
//! of the project into `.latexfrog/latexfrog.json`, where it lives now: LatexFrog keeps one entry in a project.
//!
//! Each step is one rename, so a failure leaves the old name intact and the next open tries again. An existing new name always wins:
//! the old one stays where it is and is reported. Nothing is merged, because a merge could lose either side.

use crate::candado::{self, Veredicto};
use crate::error::{Error, Result};
use serde::Serialize;
use std::fs;
use std::path::Path;

const OLD_CONFIG: &str = concat!("latex", "viewer.json");
/// The configuration at the top of the project, where it lived before it moved into `.latexfrog/`.
const TOP_CONFIG: &str = "latexfrog.json";
const NEW_CONFIG: &str = crate::config::CONFIG_REL;
const OLD_DIR: &str = concat!(".", "lv");
const NEW_DIR: &str = ".latexfrog";
/// The Tauri app that wrote the old lock.
const OLD_APP: &str = "lv-app.exe";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    /// A configuration file was moved into `.latexfrog/`.
    pub config: bool,
    /// The old folder was renamed.
    pub folder: bool,
    /// Old names left in place because the new one already exists.
    pub conflicts: Vec<String>,
}

pub fn migrate(root: &Path) -> Result<Migration> {
    migrate_with(root, &crate::procs::imagen_de_proceso)
}

/// `image_of` names the executable of a live PID.
pub fn migrate_with(root: &Path, image_of: &dyn Fn(u32) -> Option<String>) -> Result<Migration> {
    let mut m = Migration::default();
    let old_dir = root.join(OLD_DIR);
    // Before anything moves: the other instance is writing inside the folder, and its config must not vanish under it.
    if let Ok(lock) = fs::read(old_dir.join("lock")) {
        for app in [OLD_APP.to_string(), candado::nombre_de_la_app()] {
            if let Veredicto::Ocupado(pid) = candado::evaluar(&lock, std::process::id(), &app, image_of) {
                return Err(Error::Other(format!("another instance (PID {pid}) has this project open; close it to migrate the project")));
            }
        }
    }
    let renamed = |old: &Path, new: &Path| fs::rename(old, new).map_err(|e| Error::Other(format!("could not rename {}: {e}", old.display())));

    // The folder first: the configuration moves into it.
    let new_dir = root.join(NEW_DIR);
    if old_dir.is_dir() {
        if new_dir.exists() {
            m.conflicts.push(format!("{OLD_DIR}/"));
        } else {
            renamed(&old_dir, &new_dir)?;
            m.folder = true;
        }
    }
    // Another LatexFrog with the project open reads the configuration where it is: it stays until that one closes.
    let otro_abierto = fs::read(new_dir.join("lock"))
        .is_ok_and(|lock| matches!(candado::evaluar(&lock, std::process::id(), &candado::nombre_de_la_app(), image_of), Veredicto::Ocupado(_)));
    let new_cfg = root.join(NEW_CONFIG);
    for old in [TOP_CONFIG, OLD_CONFIG] {
        let old_cfg = root.join(old);
        if !old_cfg.is_file() || otro_abierto {
            continue;
        }
        if new_cfg.exists() {
            m.conflicts.push(old.to_string());
        } else {
            fs::create_dir_all(&new_dir).map_err(|e| Error::Other(format!("could not create {}: {e}", new_dir.display())))?;
            renamed(&old_cfg, &new_cfg)?;
            m.config = true;
        }
    }
    if m.folder || m.config {
        crate::config::ensure_gitignore(root)?;
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nobody(_: u32) -> Option<String> {
        None
    }

    fn old(r: &Path, rel: &str) -> std::path::PathBuf {
        r.join(OLD_DIR).join(rel)
    }

    #[test]
    fn moves_both_keeping_bytes_and_is_idempotent() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join(OLD_CONFIG), b"\xEF\xBB\xBF{}\r\n").unwrap();
        fs::create_dir_all(old(r, "build/fast")).unwrap();
        fs::write(old(r, "build/fast/a.aux"), "x").unwrap();
        let m = migrate_with(r, &nobody).unwrap();
        assert!(m.config && m.folder && m.conflicts.is_empty());
        assert_eq!(fs::read(r.join(".latexfrog/latexfrog.json")).unwrap(), b"\xEF\xBB\xBF{}\r\n");
        assert_eq!(fs::read_to_string(r.join(".latexfrog/build/fast/a.aux")).unwrap(), "x");
        assert!(!r.join(OLD_CONFIG).exists() && !r.join(OLD_DIR).exists());
        assert_eq!(migrate_with(r, &nobody).unwrap(), Migration::default());
    }

    #[test]
    fn the_new_names_win_and_the_old_ones_stay() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join(OLD_CONFIG), "old").unwrap();
        fs::create_dir_all(r.join(".latexfrog")).unwrap();
        fs::write(r.join(NEW_CONFIG), "new").unwrap();
        fs::create_dir_all(r.join(OLD_DIR)).unwrap();
        fs::write(old(r, "state.json"), "old").unwrap();
        let m = migrate_with(r, &nobody).unwrap();
        assert!(!m.config && !m.folder);
        assert_eq!(m.conflicts, vec![format!("{OLD_DIR}/"), OLD_CONFIG.to_string()]);
        assert_eq!(fs::read_to_string(r.join(NEW_CONFIG)).unwrap(), "new");
        assert_eq!(fs::read_to_string(old(r, "state.json")).unwrap(), "old");
    }

    #[test]
    fn a_live_old_instance_stops_it_and_nothing_moves() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join(OLD_CONFIG), "old").unwrap();
        fs::create_dir_all(r.join(OLD_DIR)).unwrap();
        fs::write(old(r, "lock"), r#"{"pid":4242,"app":"lv-app.exe","token":1,"desde_ms":0}"#).unwrap();
        let e = migrate_with(r, &|_| Some(OLD_APP.to_string())).unwrap_err().to_string();
        assert!(e.contains("4242"), "{e}");
        assert!(r.join(OLD_CONFIG).exists() && old(r, "lock").exists());
        // A PID reused by another program does not stop it.
        assert!(migrate_with(r, &|_| Some("notepad.exe".to_string())).unwrap().config);
    }

    #[test]
    fn the_configuration_at_the_top_moves_into_latexfrogs_folder_byte_for_byte() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join(TOP_CONFIG), b"\xEF\xBB\xBF{ \"root\": \"main.tex\" }\r\n").unwrap();
        fs::write(r.join(".gitignore"), b"*.aux\n").unwrap();
        let m = migrate_with(r, &nobody).unwrap();
        assert!(m.config && !m.folder && m.conflicts.is_empty());
        assert!(!r.join(TOP_CONFIG).exists());
        assert_eq!(fs::read(r.join(NEW_CONFIG)).unwrap(), b"\xEF\xBB\xBF{ \"root\": \"main.tex\" }\r\n");
        assert!(r.join(".latexfrog/.gitignore").is_file());
        assert_eq!(fs::read(r.join(".gitignore")).unwrap(), b"*.aux\n", "the project's own .gitignore is not touched");
        assert_eq!(migrate_with(r, &nobody).unwrap(), Migration::default());
    }
}
