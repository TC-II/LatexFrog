# LatexFrog plan

Goal: one standalone, fast program for large LaTeX projects. Windows first, Linux soon after.

## Decided

- Texpile fork with history kept, merging upstream versions when wanted. Public at TC-II/LatexFrog.
- The engine moves here and shrinks to what the features use.
- English only. New name and icon.
- Project files migrate on open: `.lv/` to `.latexfrog/`, and `latexviewer.json` or a top-level `latexfrog.json` to `.latexfrog/latexfrog.json`. The project keeps one folder.
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
- [x] Profiles, parts, current file, live progress.
- [x] SyncTeX through the engine in the viewer and the editor.

### M3. Delivery and diagnostics
- [x] Figure cache: bake and clean with a preview.
- [x] Export parts with the printed number; delivery profile.
- [x] History, doctor, orphans, project lock.
- [x] Config editor with Detect, validation and diff; project migration.
- [x] Visual profile editor, active profile beside Compile, automatic compile from the profile.
- [x] SyncTeX to the exact word; Follow. The Parts panel and Ctrl+Alt+C were removed: a profile's parts do that job.
- [x] Project screen: detection reasons per section.
- [x] Figures panel per figure, as a tab of the bottom dock.
- [x] Inverse SyncTeX with the neighbour search; a selection of lines refines each line.
- [x] Engine text in English; the keys kept in `history.jsonl` stay as they were.
- [x] When to compile (On save, When idle, Manual) is a button beside Compile, per project; profiles no longer carry it.
- [x] Saving parts is a profile output: one PDF, or one per part from a name pattern. The Delivery menu is gone. A saved PDF is named after the profile and announced with Reveal.
- [x] A new project starts with Default (everything) and Current (the open file's part). Config: Run Now saves and compiles the profile.
- [x] A profile that leaves parts out defines the partial flags.
- [x] Profiles no longer override the document's own macros (the variables are gone): a document compiles as written. A profile can stamp a watermark instead, drawn from the driver under every page: text with `{date}`, `{page}` and `{profile}`, position, color, strength, size, angle, bold, on or off.
- [x] Figures and Parts are tabs of the sidebar's Project outline. Baked figures show as their picture in the visual editor, with a button to their code.
- [x] The PDF keeps fitting its pane's width; Follow shows its state and starts on; inverse SyncTeX centres the line and finds the word in the visual editor too.
- [x] Figures tab as a tree of the document's headings. Check figures compares the code with the cache without compiling; Compile changed compiles only what changed. Colors show only after a check of the current code.
- [x] Any LaTeX folder opens as a LatexFrog project: the configuration screen comes first, and a repository with the document in a subfolder opens that subfolder.
- [x] `fixtures/overleaf`: ten projects laid out as Overleaf lays them out, checked by `tests/overleaf.rs`. Audited against the 61 projects of `01-Overleaf`: every main file and heading found; the five that fail to compile fail the same way with plain latexmk (or have no document).
- [x] The configuration lives in `.latexfrog/latexfrog.json`; `.latexfrog/.gitignore` keeps only it. A folder that is not a project yet cannot skip the configuration screen: it saves one or opens another folder.
- [x] The Figures tree mixes `\includegraphics` images in line order and keeps its open branches after a check; arrow keys move between figures; the visual editor keeps baked figures as pictures.
- [x] A project opened for the first time shows the file of its first heading in the visual editor. A figure that no raw block holds no longer leaves the later figures as code; a jump keeps its figure in sight while the figures above turn into pictures.
- [x] Topbar: Compile first, when-to-compile as an icon, the active profile in a fixed width. Follow is an icon that toggles. A document without headings shows its body in Outline and Figures.
- [x] User macros read from their definitions (`macros.rs`): a macro that ends in `\input`/`\include`/`\subfile` with a path built from its arguments, through other macros, brings its files into the graph (in the body, as a part edge, so the preamble format ignores them); a macro that draws an argument as a heading (`\LARGE\textbf{#2}`) or wraps a sectioning command goes to the outline. Fixture `fixtures/overleaf/macro-loaders`.
- [x] A loader call in the body that only `\input`s (`\Ejercicio{slug}`) is a part named by its argument, so profiles can choose it like an `\include` part. `\includeonly` cannot reach it: with a selection, the driver wraps the macro (`\NewCommandCopy` at `begindocument/before`) and a call not chosen loads nothing. Only for loaders with mandatory parameters. A call left out still runs, in a discarded box with `input` off, so its counters step and numbers match the full PDF.
- [x] Pieces include the blocks the body prints outside the parts, in the root and in the files that call the parts: a top-level call named after the innermost command of its leading chain (`\soloEnPDFCompleto{\caratulaTributo{...}}` is `caratulaTributo`) or an environment (`titlepage`). Commands that print nothing, switches and macros that only set keys are left out. A profile omits one by commenting its lines in a copy, so a project needs no `\CompilacionReducida`, `cap_actual.tex` or `libro_fast.tex`.
- [x] One list of what the document is made of (`composicion.rs`, `Symbols.composition`): headings with their part, parts without a heading, and pieces, in document order. Contents shows it and dims what the active profile leaves out, the same blocks the profile editor chooses from; a heading inside a piece's block (the bibliography's title) goes with the piece.
- [x] A profile may choose no parts (the title page alone). Switching profiles shows that profile's last PDF from its build folder; a build that is up to date still replaces another profile's PDF on screen. Saving a copy shows no toast.
- [x] Figures: an exercise's or chapter's figures open in their own file, not on the main file's loading line; the arrow keys open closed branches and stay in the tree. A sun beside Visual turns only the visual editor's page white, like the PDF.
- [x] The configured figure cache folder, not the literal `figuras-cache`, is what search, the outline, root detection and project detection skip.
- [x] circuitikz figures are externalized (circuitikz's `\let\circuitikz\tikzpicture` predates `\tikzexternalize`), and a figure's own job disables the shipout background hooks (a title page's `\AddToShipoutPictureBG*` landed on the figure).

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

Macro loaders, 2026-11-05, release, copies: E3 exercise collection graph 1.3 ms → 11–15 ms (8 → 59 `.tex` read, two walks), outline 0 → 61 entries (27 exercise titles). Book: the definitions pass adds 4–7 ms to a 14–23 ms graph build; no second walk, outline unchanged.

## Known issue accepted

Typing after a chip in a paragraph made only of chips rewrites that paragraph: line ends can become spaces, and once a typed word fused with the command before it. Prose showed no difference in 75 edits.
