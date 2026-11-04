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
- [ ] Remove what no feature uses, starting with TeXpresso and the TeX Live doctor paths nothing calls.

### M1. Compile
- [ ] One line in `startCompile` sends LatexFrog projects to the sidecar; all entry points follow.
- [ ] Problems panel, Stop and busy state follow sidecar builds.
- [ ] Full protocol, documented, with tests including cancel with no process left.

### M2. Project features
- [ ] Project-wide Outline next to Files, from `Symbols.sections`, with jump to section.
- [ ] Profiles, parts, variables, current file, live progress.
- [ ] SyncTeX through the engine in the viewer and the editor.

### M3. Delivery and diagnostics
- [ ] Figure cache: bake and clean with a preview.
- [ ] Export parts with the printed number; delivery profile.
- [x] History, doctor, orphans, project lock.
- [x] Config editor with Detect, validation and diff; project migration.

### M4. Release
- [ ] Installer that bundles the sidecar (`extraResources`).
- [ ] Performance run on the primary book, the secondary book and `01-Overleaf`, against Tauri LatexFrog.
- [ ] Editor latency on the production build (108 ms per key in dev on the largest chapter).

### Later
- Measure LuaLaTeX on a copy of the book: compile time, figures, live preview. Do not migrate before.
- Manage the TeX installation from the app. Low priority.
- Linux.

## Known issue accepted

Typing after a chip in a paragraph made only of chips rewrites that paragraph: line ends can become spaces, and once a typed word fused with the command before it. Prose showed no difference in 75 edits.
