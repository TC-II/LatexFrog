# Test campaign on public LaTeX projects (2026-11-08)

Written for the agent that will fix what it found. Every finding says how it was observed, how to reproduce it, what it probably is, and how sure that is. Nothing here was fixed except item 0.

Repo state tested: `main` at `97ca391e` plus the uncommitted `apps/texpile-editor/src/lib/lv/lvEngine.svelte.ts`. Sidecar built from the same tree (release). MiKTeX 25.4 on Windows 11, Node 24, Rust 1.92.

## Summary

| What | Result |
|---|---|
| Rust `cargo test -p lv-core` | 215 + 13 + 24 + others, all pass |
| Rust `--features tex` (real TeX) | all pass except `figuras_tex::las_figuras_se_nombran_por_archivo_y_la_raiz_queda_limpia` (stale expectation, item 9) |
| vitest unit (`tests/unit`) | 5841 pass, **5 fail** in 3 files (item 8) |
| Live regression oracle `matrix.mjs` | 69/80 at ceiling, 0 WRONG; the 11 below ceiling are listed in item 11 |
| Corpus | 50 project folders from 27 public repos; 5 skipped for shell escape; 45 compiled |
| Profiles compiled | 45 projects x (inferred profiles + 5 to 8 synthesized ones): 268 builds in the sweep |
| Fully building projects (every profile) | 15 |
| Some profiles fail | 4 |
| No profile builds | 26 (almost all: missing package/font on this machine, an error in the document itself, or the project's own latexmkrc that was removed for safety; see "Why projects fail") |
| App bugs confirmed | 6 new (items 1 to 6), 1 fixed earlier (item 0) |

The full per-project table is at the end. Raw JSON per project is not in the repo (it holds machine paths); regenerate it with the commands in "How to rerun".

## Method

1. **Corpus.** `inventory.mjs` walks cloned repos, finds every folder holding a `\documentclass` + `\begin{document}` file, tags it (class, packages, bibliography, index, glossary, beamer, multi-file, unicode engine, shell-escape), and picks a diverse subset per repo. Heterogeneity: article/book/report/memoir/scrbook/beamer/standalone/l3doc/ltnews classes, biblatex/natbib/bibtex, makeidx/imakeidx, glossaries, TikZ/pgfplots, listings, tcolorbox, CJK (ctex/xeCJK), fontspec/polyglossia, subfiles, resumes (AltaCV, Awesome-CV), documentation of packages (biblatex, siunitx, l3kernel, latexindent, pgfplots), a 26k-line thesis, a 417-page book (openintro), 1000-page OpenLogic (compiled separately in an earlier run).
2. **Safe copies.** Each project is copied without `.git` and **without any `latexmkrc`**, because the app reads the project's latexmkrc (it is Perl and runs as code). Projects that use `minted`, `pythontex`, `gnuplottex`, `asymptote`, `\write18` or `\input{|...}` were not compiled. Nothing was compiled with `-shell-escape` (no `externalize` profile was tried on foreign code).
3. **Battery per project** (`battery.mjs`, talks to `lv-sidecar` over JSON lines): open and root detection; `detect`; config round trip; outline/files/labels/bib consistency checked against the sources; images resolved against the disk (with `\graphicspath`); then profiles. Profiles: the inferred ones plus synthesized `x-draft` (draftImages), `x-clean` (cleanBefore), `x-wm` (watermark), `x-omit` (omit toc/bibliography/index when present), `x-out` (output dir + pattern), and for projects with parts `x-list` (parts list) and `x-per` (per-part output). Each profile compiled; the first two successful ones get a SyncTeX round-trip over 25 prose lines (forward, then inverse at the forward rect); then no-op rebuild, rebuild after a comment edit, cancel mid-build (plus orphan check), `fragment`, `publish`, `export`, `history`, `typical-times`, `doctor`, and engine switch to xelatex and lualatex.
4. **Failure triage.** A failed profile is re-run alone and sequentially (`confirm.mjs`) to remove failures caused by the 3 parallel workers; then plain `pdflatex`/`xelatex`/`lualatex` (two passes, no shell escape, installer disabled) is run on the same root (`baseline3.mjs`) to tell "the document fails anyway" from "only the app fails".
5. **Live.** `live2.mjs`: `driver-for-live`, cold and warm draft compile with the real draft engine, page count against the full build, TeX errors and missing files in `_draft/draft.log`, `synctex-inverse-pdf` on a grid over the draft PDF. Then `project-matrix.mjs` (6 prose edits on the two files with most prose) for the projects whose draft compiled.

## Confirmed app bugs

### 0. (fixed earlier, commit `85983aa9`) pdflatex dies with a stack overflow when the profile's preamble is in a `.fmt`
ElegantNote: TikZ `circular drop shadow` as the label of a nested `itemize`. The app now retries once without the format. Listed here because the same family of problem (something a format cannot carry) may show up again; the retry is keyed on a `gave return code N` other than 0 and 1.

### 1. "omit bibliography" comments out unrelated code and breaks the build
`crates/lv-core/src/piezas.rs`. Profile `omit: ["bibliography"]`.
- Project `04-biblatex-doc_latex_biblatex_examples` (root `03-localization-keys.tex`), profile `x-omit`: the copy under `.latexfrog/piezas/x-omit/` comments (`% lv: `) lines 97 to 107 of the original, which begin at `\pretocmd{\printbibliography}{\greektext}{}{}}{}`, the last line of an `\ifdefstring{...}{%` group. The group is left open, TeX stops with `File ended while scanning use of \@secondoftwo`. The other profiles of the same project build.
- Project `43-phd-thesis-template`, profile `x-omit` (omit `toc`+`bibliography`): the block commented runs from `\cleardoublepage` through `\end{spacing}` and `\begin{appendices}`: `\begin{spacing}` is opened before and never closed (`\begin{spacing} ended by \end{appendices}`).
- Cause (high confidence): the piece's extent is found by mentions of `\printbibliography`/`\bibliography` without checking that the mention is a real call at brace/environment depth 0 of that file, and the commented range crosses unbalanced braces and `\begin`/`\end` pairs.
- Fix direction: only consider a mention as the piece when it is not inside a macro argument (brace depth 0) and not before `\begin{document}` unless the file is a class/preamble that really prints it; limit the commented range to the lines of the call and its immediately attached options; after commenting, verify that braces and `\begin`/`\end` still balance and otherwise refuse to omit and say so (a warning event) instead of building a broken copy.
- Repro: `omit` set to `["bibliography"]` in `.latexfrog/latexfrog.json` of those two projects; compile that profile.

### 2. Outline line numbers drift in long files
`crates/lv-core/src/symbols.rs` (scanner) or the preprocessing it uses. `symbols` -> `sections[].line` is wrong by an amount that grows through the file.
- `30-vimtex-test_example_startup_timing/thesis.tex` (26771 lines, LF, 439 sections): reported line minus real line is 0 until the first repeated chapter block, then **grows by 1 at every repeat** (offset 1 at line 1184, 2 at 4109, 3 at 7034, ... 8 at 21659; the `Conclusions`/`Outlook` entries in between are off by the other sign, so the drift is local to some construct, not uniform).
- `12-latexindent.pl-documentation/sec-appendices.tex` (CRLF, 1181 lines, 53 sections): offset 0 up to line 3, then **6 lines early** at the `Mac` subsubsection (reported 156, real 162), then -4, 6, 2, 6, -3, 6 ... along the file. The file is full of `cmhlistings` (verbatim-like) environments.
- Cause (medium): newlines consumed when masking verbatim/listing bodies or comment-like constructs, so later positions lose lines. Compare the line count of the masked text with the original per file; a unit test with a verbatim/`lstlisting` block and a `\verb` containing an end-of-line should show it.
- Impact: outline click-to-line lands on the wrong line; probably also `file-info`, SyncTeX-forward targets and `figures-status` lines for those files (not checked).
- Repro: `node tests/corpus/drift.mjs <project copy> <file>` prints where the offset changes.

### 3. Watermark with `{date}` breaks documents whose class has no `\today`
`x-wm` profile on `32-vimtex-test_test_get_main` (`\documentclass{minimal}`): `lv-x-wm-resto.tex:4: Undefined control sequence. \lv@marca ->wm \today`. Low severity (the `minimal` class). Fix direction: expand the date from the app side (the date is known when the driver is written) or define `\today` if undefined.

### 4. Live (draft engine) stops on a missing file that the real build survives
`12-latexindent.pl-documentation` (root `latexindent.tex`): `\lstinputlisting{../defaultSettings.yaml}` points outside the project. The full build (latexmk, nonstopmode) reports `Package Listings Error: File ... not found` and still writes a PDF. The draft compile ends with `! Emergency stop. <read *>` and no pages, so Live shows nothing. Same document: `Package microtype Error: The kerning feature only works with pdftex 1.40 or newer. Switching it off.` appears under LuaTeX (a recoverable error, but it is an error line in the draft log).
- Fix direction: run the draft engine in a mode that never waits for the terminal after an error (`-interaction=nonstopmode`, or `\batchmode` equivalent in the daemon wrapper) so a missing file degrades the page instead of ending the run. Check how `compileJob.ts` / `draftService.ts` start TeX.

### 5. Live: more pdfTeX-only primitives reach the draft engine unguarded
Same family as the `\pdfglyphtounicode` fix (commit `3730b032`). `43-phd-thesis-template` preamble line 280: `\pdfcompresslevel=9` -> `Undefined control sequence`, then `Missing \begin{document}` (the draft still produced 38 pages vs 39 in the full build, so it recovered). Candidates to add to `PDF_SHIM` in `electron/src/draft/compileJob.ts`: `\pdfcompresslevel`, `\pdfobjcompresslevel`, `\pdfminorversion`, `\pdfdecimaldigits`, `\pdfimageresolution`, `\pdfpkresolution`, `\pdfpagewidth/height` (check which LuaTeX lacks). Define counts/dimens only when absent, like the existing ones. Unit test: extend `tests/unit/electron/draft/compileJob.test.ts`.

### 6. Live shows TeX errors the full build does not have
Not stopping, but the draft log has them and the page differs:
- `49-tufte-latex`: `Argument of \MakeTextLowercase has an extra }` at `\caption{...}` of a margin figure (tufte-latex sidenote machinery under LuaTeX).
- `10-latex3-l3kernel_doc` (class `ltnews`): `\ctanpkg #1->\href` undefined, i.e. `hyperref` is not loaded in the draft run while the full build has it. Check whether the draft driver drops `hyperref` or loads it differently.
- Page counts, full vs Live: ThinkPython2 244 vs 232, `22-resume` 1 vs 2, `10-latex3-l3kernel_doc` 5 vs 6, `43-phd-thesis-template` 39 vs 38; the other 14 equal.

## Test-suite failures (not found by the corpus)

### 7. Live matrix oracle: scenarios below the ceiling
`tests/live/matrix.mjs`: 69/80 at ceiling, no WRONG. Below ceiling (all fall back to RECOMPILE where the ceiling is EXACT): `basic:transient-unbalanced-math`, `basic:insert-paragraph`, `basic:edit-then-insert` (also `RECORDS-DRIFT/p1/dy12/rows25v26`, `verify:ok`), `basic:insert-before-heading` (reason `footnote`), `basic:insert-after-equation` (`interline-below`), `framed:frame-prose`, `framed:frame-after-display`, `tut:tut-insert-before-section` (`float-anchor`), and the three `cjk:*` scenarios with `no-pages` (the CJK draft produced no pages on this machine; check whether a CJK font is missing here or the draft fails: compare with `xelatex` on `tests/live/fixtures/cjk`).
Harness note: `matrix.mjs` waits for `http://localhost:8099/ping` even when `LIVE_BRIDGE_PORT` is set, so it cannot run beside another instance.

### 8. vitest: 5 failures in 3 files
- `tests/unit/lib/workspace/nativeMenuLabels.test.ts` x3 (`de`, `zh-Hans`, `zh-Hant`): message `draft_loading_other` has no translation (`expected [ 'draft_loading_other' ] to deeply equal []`). It was added to `apps/texpile-editor/messages/en.json` in the last commits; add it to the other locales (CLAUDE.md: all user-facing text goes through paraglide).
- `tests/unit/lib/workspace/compileLaneRace.test.ts` "a .tex main still compiles with LaTeX - the fresh resolve changes nothing there": `expect(record.ran).toHaveLength(1)` got 0, at line 96. Not investigated.
- `tests/unit/lib/workspace/suggestionsVisualFuzz.test.ts` "tex: draws old and new words exactly as rejecting them reads": the failure list shows `...First slide bullet item text.bullet item text.\nLast slide...` against `...First slide bullet item text.\nMiddle slide bullet item text.\nLast slide...`. Not investigated; it may be a pre-existing Texpile test.
(The 5 were not checked against a clean checkout, so some may predate this repo state.)

### 9. Rust `--features tex`: stale expectation
`crates/lv-core/tests/figuras_tex.rs:119`: expects `latexfrog.json` in the root listing, but the config lives in `.latexfrog/latexfrog.json` since the folder migration. The listing the test got is `[".latexfrog","Secciones","cap-a.tex","estilo.tex","figuras-cache","main.tex"]`. Fix the test, not the code.

## Other observations

- **Flaky first build (one case):** `01-AltaCV` `completo` failed once with `!pdfTeX error: Font Lato-Regular-T1-TLF--base at 600 not found` while 3 builds ran in parallel (MiKTeX generating the font on demand); the same profile built fine alone, twice. Probably MiKTeX font generation under contention. It also left `lv-completo-pre.fallo`, i.e. the format was marked failed for that preamble after a failure that was not the format's fault.
- **Unresponsive sidecar (one case, not reproduced):** `05-ElegantBook` `x-out`: the `compile` request got no answer in 120 s and a following `history` request also timed out. Alone, the same profile fails normally in 2 s (missing font/package). Could be a MiKTeX prompt waiting on stdin or lock contention while three builds ran; worth giving TeX `--disable-installer`/no stdin and answering other requests while a build starts.
- **`compile` on a `perPart` profile is an export:** the request is answered but the events are `export-*`, never `finished` (`session.rs:750`). Fine by design, but `docs/protocol.md` does not say it. A client that waits for `finished` hangs.
- **`ProjectView.config.profiles` is not the file's shape:** `view` returns `[{id, label, ..., publica}]`; `config-write`/`config-validate` want `{id: {...}}`. Feeding the view's config back gives `invalid type: sequence, expected a map`. The UI must convert; either document it or add a `config-read` that works before the first save (it returns `null` when nothing is saved).
- **Root choice:** with several `\documentclass` files in the folder (`49-tufte-latex`: `sample-book.tex`, `sample-handout.tex`) the app picked `sample-handout.tex`, the smaller one; with two languages variants (`elegantnote-cn.tex`, `elegantnote-en.tex`) it picked none and needed a hint. Not a bug, but the heuristic could prefer the document that includes the most files.
- **Engine inference:** `44-tex-thesis`, `03-biblatex-doc` and `45-tex-thesis-slides` need XeTeX or LuaTeX (`fontspec`), the app infers `pdflatex` and fails with `The fontspec package requires either XeTeX or LuaTeX`; with `xelatex` they build (checked with plain xelatex). `tex-thesis` fixes the engine in a `.latexmkrc` that the corpus copy removed, so for that one the app would be right with the original files; for projects without a latexmkrc, inferring from `\usepackage{fontspec}`/`xeCJK`/`ctex`/`% !TEX program` would help.
- **SyncTeX:** 25 prose lines per project, forward then inverse: 25/25 on tufte, 13/15 on phd, and `10-latex3-l3kernel_doc`: 20 of 25 round trips came back as the same line (`l3news09.tex:1106`) for different input lines (a macro-generated page; probably just SyncTeX's own ambiguity). The draft PDF's `synctex-inverse-pdf` answered on every sampled point of the 18 draft-compiled projects except ThinkPython2 (15/18) and phd (12/18); none returned a file that does not exist.
- **No-op and edit rebuilds are correct** when nothing else touched the profile (checked again alone: second and third compile `updated:false`, 0.4 s). The sweep's `noop-rebuild` flags were caused by the battery rewriting the config in between.
- **Cancel:** a build cancelled after 0.7 s ends with `finished{cancelled:true}`, `status.building` false and no surviving TeX processes of the project, on all 19 projects that reached that step.
- **Live edits (`project-matrix`, 6 edits each):** `04-biblatex` 6/6 EXACT, `27-texlab` 6/6, `16-mtheme` 4 EXACT + 2 RECOMPILE, `48-ThinkPython2` 4+2, `49-tufte` 3+3, `10-latex3_ltnews` 0/6 (all RECOMPILE), `12-latexindent` 0/6 (Live does not compile, item 4). No WRONG anywhere. Several tufte edits ended `no-line-boxes=No SyncTeX match. Compile with -synctex=1 first.` and `verify:stale`: the draft PDF seems to have no usable SyncTeX for that project; not investigated.

## Why projects fail (so they are not mistaken for app bugs)

26 projects had no profile that built. By cause, from the log and the plain-TeX baseline:
- **Missing on this machine (MiKTeX 25.4, installer disabled):** `kaobook.cls`/`kaohandt.cls` (the examples need the repo root's classes), `xoutput.sty`, `mymath.sty`, `scrpage2.sty`, `pdfmanagement-init.sty` (newer LaTeX kernel than MiKTeX's), `sourceserifpro.sty`, `fixtounicode.sty`, `adforn.sty`, `package.sty`, Chinese fonts (`simkai.ttf`), `../../sty/open-logic.sty` (a path outside the copied folder).
- **The document itself fails with plain TeX too** (same first error): `07-LaTeX-Workshop` (undefined control sequences), `11` and `13` latexindent test cases (`cleveref must be loaded after amsmath`, `pdfpages cannot find file`), `15` (`\begin{itemize} ended by \end{document}`), `17-openintro-statistics` (12 errors, still 417 pages), `21` (pgfplots table columns), `40` (`File '*' not found`), `02-Awesome-CV` (`Missing \begin{document}` from the class under pdflatex; it wants xelatex plus fonts), `24-tectonic-xenia` (no pages).
- **Bibliography broken in the project:** `29-vimtex-test_example_book_multifile` (`\bibliography{book.bib,test}` with no `test.bib` and no `\bibliographystyle`): plain TeX exits 0 because it never runs bibtex, latexmk does and reports failure with a valid 23-page PDF. The app reports `ok:false` with a PDF present, which is right.
- **latexmkrc removed on purpose:** `08-latex3-l3kernel` (the project's index is made by a rule in its latexmkrc/Makefile; without it latexmk's default makeindex fails on the `.idx`: 3611 errors in `.ind`). Not testable without running the project's Perl.

## Not covered

`externalize` and anything with `-shell-escape`; projects using minted/pythontex/gnuplottex/asymptote/write18 (5 skipped: `18-pgfplots-doc`, `25-tectonic-bundles`, `28-vimtex-syntax`, `39-LaTeX-examples-Programmierparadigmen`, `41-LaTeX-examples-CNN_Intro`); the projects' own latexmkrc/Makefile; the Electron UI itself (nothing was driven through the window, only the sidecar and the draft engine); paths with spaces or non-ASCII characters (the corpus lives in an ASCII path); watching for file changes and auto-compile; `figures-bake`/`figures-clean` on foreign code; OpenLogic (1007 pages) through the full battery (it compiled in the earlier run: 236 s cold, 84 s warm in draft).

## How to rerun

The scripts are in `apps/texpile-editor/tests/corpus/`. They need `LV_SIDECAR` (path to `lv-sidecar`), a TeX distribution on `PATH`, and for `live2.mjs` also `LV_REPO` (the repo root). Run them from PowerShell, not Git Bash: under Git Bash's MSYS environment bibtex could not find the `.bib` and every project with a bibliography failed (a harness artifact, not an app bug).

```
node tests/corpus/inventory.mjs <scratch dir>        # clone repos into <scratch>/corpus2 first; writes work2/ and manifest.json
node tests/corpus/battery.mjs <work dir> <out.json> [rootFile]
node tests/corpus/confirm.mjs <work dir> <battery.json> <out.json>
node tests/corpus/baseline3.mjs <scratch dir>        # needs baseline2.json style input; see the script header
node tests/corpus/live2.mjs <work dir> <battery.json> <out.json>
node tests/live/project-matrix.mjs <work dir> <driver> <files...>
node tests/corpus/drift.mjs <work dir> <file>        # outline offset check
node tests/corpus/report.mjs <scratch dir>           # aggregates res2/*.json into a table
```

`battery.mjs` classifies each finding as BUG (the app misbehaves), ENV (missing package/font), PROJECT (the document fails), INFO. Its BUG list over-reports: use `confirm.mjs` and a plain-TeX baseline before believing one (the sweep's `compile-vs-baseline` BUGs were mostly documents that make a PDF with errors, and `noop-rebuild` was caused by the battery's own config writes).

## Corpus

| project folder | source repo | what it exercises |
|---|---|---|
| 01-AltaCV | liantze/AltaCV | resume class, biblatex, many fonts |
| 02-Awesome-CV-examples | posquit0/Awesome-CV | resume class, fontawesome (xelatex) |
| 03-biblatex-doc_latex_biblatex | plk/biblatex | package manual, fontspec, xeCJK, makeidx |
| 04-biblatex-doc_latex_biblatex_examples | plk/biblatex | 52 small biblatex documents |
| 05-ElegantBook, 06-ElegantPaper, 34-ElegantNote | ElegantLaTeX | CJK-capable classes |
| 07-LaTeX-Workshop-... | James-Yu/LaTeX-Workshop | extension test fixture |
| 08, 09, 10-latex3-... | latex3/latex3 | l3doc, xpackages, ltnews |
| 11 to 15-latexindent.pl-... | cmhughes/latexindent.pl | hundreds of test documents, manual |
| 16-mtheme-demo | matze/mtheme | beamer theme, pgfplots |
| 17-openintro-statistics | openintrostat | 417-page book, 22 parts, index |
| 19, 20, 21-pgfplots-... | pgf-tikz/pgfplots | pgfplots tests, figures |
| 22-resume | sb2nov/resume | one-page resume |
| 23-siunitx | josephwright/siunitx | l3doc package manual |
| 24, 26-tectonic-... | tectonic-typesetting/tectonic | aastex, fuzz seed |
| 27-texlab | latex-lsp/texlab | minimal article |
| 29 to 33-vimtex-... | lervag/vimtex | multi-file book, a 26k-line thesis, subfiles, glossaries |
| 35, 36, 37-kaobook-... | fmarotta/kaobook | class with margins, glossaries, polyglossia |
| 38-latex-book | pmichaillat/latex-book | book template |
| 40-LaTeX-examples-... | MartinThoma/LaTeX-examples | beamer, German |
| 42-OpenLogic-courses_enderton | OpenLogicProject/OpenLogic | memoir, project-level class |
| 43-phd-thesis-template | kks32/phd-thesis-template | 9 parts, natbib, figures |
| 44, 45-tex-thesis(-slides) | Amet13/tex-thesis | fontspec thesis and beamer |
| 46, 47-thesis-latex-template-... | fmilthaler/thesis-latex-template | standalone TikZ figures |
| 48-ThinkPython2-book | chengdake/ThinkPython2 | 17k-line book |
| 49, 50-tufte-latex(-graphics) | Tufte-LaTeX/tufte-latex | tufte classes, margin figures |

Not compiled (shell escape or similar): 18-pgfplots-doc, 25-tectonic-bundles, 28-vimtex-syntax, 39-LaTeX-examples-Programmierparadigmen, 41-LaTeX-examples-CNN_Intro.

Per-project result table (profiles ok/total after confirmation, pages of the first good build, Live cold compile, Live edit outcomes, findings by severity) is produced by `report.mjs`; the summary above gives the counts.
