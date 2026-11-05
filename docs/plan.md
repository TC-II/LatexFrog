# LatexFrog plan

Goal: one standalone, fast program for large LaTeX projects. Windows first, Linux soon after.

## Decided

- Texpile fork with history kept, merging upstream versions when wanted. Public at TC-II/LatexFrog.
- The engine moves here and shrinks to what the features use.
- English only. New name and icon.
- Project files migrate: `latexviewer.json` to `latexfrog.json`, `.lv/` to `.latexfrog/`, automatically on open.
- Compile goes through the sidecar: PDF in viewer 1742 ms against 2716 ms through the terminal; Stop leaves no process in either, 0.4 s against 1.3 to 2.3 s.
- SyncTeX goes through the sidecar: 0.3 ms against 278 ms for the CLI, request only.

## Milestones

### M0. Single repository
- [x] Local repository with Texpile history, engine, fixtures.
- [x] Engine tests pass here.
- [x] Rebrand: name, icon, about, installer, app id. Credit Texpile and Juan Sbruzzi. Required before the first push.
- [x] Remove what no feature uses, starting with TeXpresso and the TeX Live doctor paths nothing calls.

### M1. Compile
- [x] One line in `startCompile` sends LatexFrog projects to the sidecar; all entry points follow.
- [x] Problems panel, Stop and busy state follow sidecar builds.
- [x] Full protocol, documented, with tests including cancel with no process left.

### M2. Project features
- [x] Project-wide Outline next to Files, from `Symbols.sections`, with jump to section.
- [x] Profiles, parts, variables, current file, live progress.
- [x] SyncTeX through the engine in the viewer and the editor.

### M3. Delivery and diagnostics
- [x] Figure cache: bake and clean with a preview.
- [x] Export parts with the printed number; delivery profile.
- [x] History, doctor, orphans, project lock.
- [x] Config editor with Detect, validation and diff; project migration.
- [x] Visual profile editor, active profile beside Compile, automatic compile from the profile.
- [x] Parts panel and Ctrl+Alt+C; SyncTeX to the exact word; Follow.
- [x] Project screen: detection reasons per section and the variables form.
- [x] Figures panel per figure, as a tab of the bottom dock.
- [x] Inverse SyncTeX with the neighbour search; a selection of lines refines each line.
- [x] Engine text in English; the keys kept in `history.jsonl` stay as they were.

### M4. Release
- [ ] Installer that bundles the sidecar (`extraResources`).
- [ ] Performance run on the primary book, the secondary book and `01-Overleaf`, against Tauri LatexFrog.
- [ ] Editor latency on the production build (108 ms per key in dev on the largest chapter).

### Later
- Measure LuaLaTeX on a copy of the book: compile time, figures, live preview. Do not migrate before.
- Manage the TeX installation from the app. Low priority.
- Linux.

## Measured

Book copy through `lv-sidecar`, part selection, 2026-11-04: first build 9.1 s, one-pass rebuild 2.0 s after a chapter edit, outline 50 ms for 199 sections. Compiling during the background figure listing waited about 4 s more; the listing now stops within 10 ms and runs again after the build: 2.1 to 2.6 s for three such rebuilds.

## Known issue accepted

Typing after a chip in a paragraph made only of chips rewrites that paragraph: line ends can become spaces, and once a typed word fused with the command before it. Prose showed no difference in 75 edits.
