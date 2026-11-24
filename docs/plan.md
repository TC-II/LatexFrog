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
- [x] Pieces inside a part (a guide's `\makecover`, its `credits` environment), around what the part loads, are left out the same way: commented in a copy of the part's file. The kernel's file substitution knows a file by its name alone and the root and every guide are `main.tex`, so the driver declares a part's copies only while that part is read (`\lvEntra`/`\lvSale` around its loader). Read under its original name, a subfile still finds its own folder. A heading left with nothing compiled under it (`\part*{Ejercicios}` with every exercise out) is commented too. SyncTeX maps a copy back to its file; lines are commented, never removed. Checked on Guias-TC2: G1's cover alone is its 2 cover pages. Only a part that holds parts (a guide) has pieces: an exercise that `input`s its plots is all content. A page break does not make a macro print, so a setup that starts a page (`guidesetup`) is never a piece. A key without a guide (`block:makecover`) leaves that piece out of every guide, as the profile of the chapter I am in needs; two blocks of one name in a guide are `itemize` and `itemize#2`. A solutions book that loads its guide's exercise list holds the same exercises (`Part.also`): choosing it alone compiles them. A guide in the build only because an exercise in it was chosen (ticked, exported, or the chapter I am in) comes for its setup and prints none of its own pieces (`solo_marco`).
- [x] One list of what the document is made of (`composicion.rs`, `Symbols.composition`): headings with their part, parts without a heading, and pieces, in document order. Contents shows it and dims what the active profile leaves out, the same blocks the profile editor chooses from; a heading inside a piece's block (the bibliography's title) goes with the piece.
- [x] A profile may choose no parts (the title page alone). Switching profiles shows that profile's last PDF from its build folder; a build that is up to date still replaces another profile's PDF on screen. Saving a copy shows no toast.
- [x] Figures: an exercise's or chapter's figures open in their own file, not on the main file's loading line; the arrow keys open closed branches and stay in the tree. A sun beside Visual turns only the visual editor's page white, like the PDF.
- [x] The configured figure cache folder, not the literal `figuras-cache`, is what search, the outline, root detection and project detection skip.
- [x] circuitikz figures are externalized (circuitikz's `\let\circuitikz\tikzpicture` predates `\tikzexternalize`), and a figure's own job disables the shipout background hooks (a title page's `\AddToShipoutPictureBG*` landed on the figure).

- [x] Live preview through the sidecar: Texpile's draft mode (warm LuaLaTeX, one paragraph per keystroke) starts its processes with `live-*` requests, so there is still one build path. Its runs get the search paths the project's `latexmkrc` sets, as a build gets them through latexmk (a class in `style/`). Live, On save, When idle and Manual are the second group of the Compile menu, under Project Configuration. The profile picker beside Compile is a menu that shows each profile's color as a rounded square.

- [x] Live going back and forth between chapters and profiles (2026-11-10; timings under Measured).
  - A kept result belongs to a document, not to a profile: the key is the Live driver's text and the engine (`electron/src/lv/draftSnapshot.ts`). A profile that follows the open file rewrites one driver for each chapter, and with the driver's path as the key it kept one result: chapter A, B, A compiled three times.
  - A kept result is dropped when a file its pass read changes, not when any file of the project does: an edit in chapter B leaves chapter A's result good. The `.tex` files read come from the pass's SyncTeX, by path, and from its own list by name where SyncTeX knows no such file (the book's root and its first chapter have one name, and by name alone an edit in that chapter dropped every chapter); every file that is not `.tex` counts for all. It is not kept when a source or the driver changed while the pass ran, nor when the pass landed no pages.
  - A compile that has to run starts from that document's own last aux, contents and bibliography when it was kept before (`primeFromKept`), and then with a cold pass: the parked warm engine read the other document's references. One pass where it took three.
  - biber's "already ran for this" is a file beside the `.bbl` (`draft.bcfhash`: the `.bcf` and the stat of the `.bib` files it names), not one hash per project in memory: it ran again on every chapter switch, and an edited `.bib` did not reach Live. With biber, one pass after a changed `.bbl`, not two; biblatex's own rerun request adds the other when it asks.
  - A compile that starts within the beat after the last one cancels that one's pending rewarm (`draftWarmCompile.ts`). It fired during the new compile's warm pass, rewrote the pass's files under it, and `draft.aux` came out with a gap of NUL bytes: every pass after it stopped with 101 "Text line contains an invalid character" and no pages, and that result was kept.
  - Engine: the pieces a profile leaves out are redefined right after `\begin{document}` in the Live driver, not in its preamble: the book's four profiles named two preambles, now one, so a switch keeps the warm lualatex. The view says which parts each profile compiles (`compiles`), and Contents dims from that list.
  - Engine: both drivers come from one list of lines, each tagged with its role (`build::driver_lineas`). The profile's driver is every line in order. Live's (`build::render_driver_live`) places each line by its role and no longer cuts lines out of the profile's text by matching prefixes, so a line added to one driver reaches the other. `SALIDA_DE_PGF` was already in both. The pgf picture names in the log (`<use …>`, `IMAGENES_DE_PGF_EN_EL_LOG`) and `\let\lvIncludeonly\includeonly` are the only Live-only lines: only Live numbers pictures from the log. Both drivers came out byte for byte the same as before in 20 cases (three projects, six profiles each, plus two full specs). One change on purpose: when the root file itself has blocks left out (a title page), the profile's build read the root's copy with them commented, and Live read the root as written and printed them. Live now reads the same copy. Its lines are commented, never removed, so the body's copy keeps the root's line numbers and `.origen` still names the root.
  - A pass killed by a newer one leaves `draft.aux` or a part's `.aux` cut mid-line; the next pass drops that line first (`electron/src/lv/draftAux.ts`) instead of stopping on it.
  - The window tells the engine about the open file and asks for Live's driver one request at a time, the last one for the newest state (`lib/lv/latest.ts`), and only once a tab switch rests (150 ms).
- [x] Live kept a page frame and a title page's band off the page after typing inside a line (2026-11-24). A patched page draws from the records, which `page-extract.lua` takes in `shipout/before`, before the kernel adds the shipout background and foreground (eso-pic's `\AddToShipoutPictureBG/FG`). An exact patch is adopted with no pass behind it, so nothing cleared the patch and the PDF raster never came back. The extractor now compares the ink on the page in `shipout/before` with the box LuaTeX ships (`pre_shipout_filter`: glyphs, rules, PDF literals) and marks a page that gained some `"lay":1`; an adopted patch on such a page keeps the quiet pass. The page still loses that material while a patch is on it, until the pass lands. Cost of the counts: 56–65 ms over 151 pages with no layers (both counts on every page), against 372 ms for a first version that walked the nodes through userdata (`tests/unit/electron/draft/shipoutLayers.test.ts`).

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

Live preview, 2026-11-06, Linux, TeX Live, `tests/live/sidecar-bench.mjs`. `fixtures/libro-include`: paragraph typeset 2.7 ms median (3.5 ms max) through the sidecar and 2.7 ms (3.0 ms) spawning directly as before; daemon warm-up 260 ms both; draft pass 1.1 s cold, 318 ms warm, both ways. `tests/live/fixtures/bookdoc`: 3.0 ms per paragraph, 220 ms warm pass. Still to measure on the book: its preamble's warm-up, a full draft pass, and how LuaLaTeX's pages differ from pdflatex's.

Live between chapters, 2026-11-10, Windows 11, TeX Live 2026, copy of the book, profile that follows the open file, 7 s between steps (so the warm engine is parked, as in the app), before and after the changes of that date on the same machine:

| Step | Before | After |
|---|---|---|
| First compile of a chapter in a new `_draft` (18 pages) | 13.7 s, 3 passes | 10.0 s, 2 passes |
| An edit in the open chapter (a full pass, not an instant patch) | 1.2 to 1.7 s | 1.1 to 1.7 s |
| To a chapter for the first time (8 pages) | 8.5 s, 3 passes | 8.4 s, 3 passes |
| Back to a chapter not changed since | 0.14 s | 0.09 s |
| Back to a chapter after an edit in another one | 8.6 s, 3 passes | 0.09 s |
| An edit right after coming back | 2.9 s (biber ran again) | 1.7 s |
| Back to a chapter changed meanwhile, or after a shared file changed | 8.5 s, 3 passes | 3.3 to 3.8 s, 1 pass |

A cold pass is 3.1 to 3.6 s, of which the preamble is about 2.2 s; a warm pass is 0.95 s (8 pages) to 1.45 s (18); biber 1.1 s. Before these changes the same back and forth without pauses ended, on the third hop, in a `draft.aux` with NUL bytes and passes with 101 errors and no pages. The first visit to a chapter still takes three passes: biber's new `.bbl`, and then biblatex's own "Please rerun LaTeX". This harness drives the engine directly (no instant patches, no 150 ms settle); the app window is checked below.

The same steps in the app window, 2026-11-10 (dev launcher, copy of the book, driven over the debug port, 7 s between steps, twice): chapters back and forth, the four profiles, edits that reach the PDF, an edit with a chapter switch 0.6 s into its pass, a profile switch during a pass. No exception, console error or toast in any step; Contents dims what `compiles` leaves out, and after a switch during a pass it follows the PDF on screen until the new one lands (3.6 s). Two bugs found and fixed: in Live, Contents marked every heading "not in the PDF" (it read the profile build's SyncTeX, not Live's: `synctex-files` takes `pdf` now); and an externalized figure was drawn as another picture (figure 9.1 as `coal.png`), because pgf loads cache figures without graphicx's `<use FILE>` log line that Live numbers pictures by (the Live driver now writes it for pgf's pictures).

First visit to a chapter, 2026-11-10: a warm pass (1.0 s), biber (1.2 s) and two cold passes (3.2 and 3.3 s); 8.8 s. Between the second and the third pass nothing changes (both aux files, the bbl and every page, byte for byte), but the second rewrites the aux the first left, so no rule that only reads files can skip the third. The rerun check now compares with what the last pass started from, and counts the parts' aux and the bbl (it compared with the state before the whole compile, and missed a part's labels): the same three passes on the book, 8.6 s. What costs is that extra passes go cold.

A LuaLaTeX format of Live's preamble does not pay off (2026-11-10, book, `fmt-exp.mjs`): dumped in 2.4 s (11.5 MB), a pass from it is 2.45 s against 3.27 s cold, and it stops with a fatal "referenced object has wrong type" from the PDF backend, with different pages: the PDF objects and Lua state the preamble's packages set up are not in a LuaTeX format. Not adopted.

Tab switch in the engine (file-info, view, driver-for-live), book copy, 20 switches, median: 263 ms before, 164 ms after the index is kept while nothing it read or looked in changes (`ProjectIndex::vigente`). file-info 52 → 2.3 ms, driver-for-live 133 → 84 ms; view stays at 78 ms. Two index builds per switch before, none after.

The same back and forth (17 hops: two chapters, another profile, edits, a pass killed 1.5 s in) on copies of seven other projects of `01-Overleaf` (the second book, the E3 guides with nested parts, the E3 class exercises, and four single documents, one of them not a project yet): no TeX error and no page lost in any hop; back to an unchanged document in 10 to 40 ms.

## Known test failures

- `tests/unit/lib/workspace/suggestionsVisualFuzz.test.ts`, two cases, from Texpile. They fail on the base commit too (checked in a worktree of `e351ff35`): `tex` run 42 on `tests/live/fixtures/beamer/main.tex` (typing in a beamer frame loses the middle bullet); `md` run 12 fails once the repository's `docs/` has the files added since (the fuzz walks `docs/` for its corpus, so new docs move each run to another file). Bugs of the visual editor's suggestions, not fixed yet.
- `tests/unit/electron/git/safety/gitIndexSafety.test.ts` (2), `gitAwkwardCasesLive.test.ts` (1), `tests/unit/electron/draw/drawDaemonLualatex.test.ts` (1): they fail on the base commit too; the git ones spawn `rm` and `mkdir`, which a PowerShell PATH does not have.
- `cargo test -p lv-core --features tex` on Windows with TeX Live 2026: 7 of 19 test binaries failed on 2026-11-10; all pass since the same day. Fixed in the engine: pgf's figure runs got `TEXMF_OUTPUT_DIRECTORY` and wrote the figures to `.latexfrog/build/<profile>/figuras-cache/` (`SALIDA_DE_PGF` was left out on Windows; there it is `set NAME=&` for `cmd`); a TeX Live SyncTeX of a project in a folder with accents lost every file (TeX Live writes the folder in the ANSI code page under latexmk: each part of a path that is not UTF-8 is read as Latin-1); the doctor called perl missing on TeX Live for Windows, whose latexmk runs on its own Perl. Fixed in the tests: `tex` builds with `Builder` alone, so it creates the parts' folders as the session does (TeX Live does not create them; the rc's walk that would is left out on Windows, 0.3 s on the book); `figuras_datos` reads the figure's MediaBox from TeX Live's compressed object streams too; `exportar_tex` takes `LV_PDFTOTEXT` (TeX Live has no `pdftotext`; Git for Windows has one in `ucrt64/bin`). TeX Live's pdflatex still warns that it does not know `-max-print-line`; the log width comes from `max_print_line` in the environment, which the build sets.

## Known issue accepted

Typing after a chip in a paragraph made only of chips rewrites that paragraph: line ends can become spaces, and once a typed word fused with the command before it. Prose showed no difference in 75 edits.
