# Structure sense check

This check answers one question: does what LatexFrog shows a project to be match the PDF that the project builds?

"What LatexFrog shows" means three things:
- the Contents tree: its parts, headings and pieces;
- the figures;
- the configuration.

It also checks that a profile or an Export holding a selection of parts builds exactly those parts, with their own numbering. Those builds must not carry stray chapters in the contents or the lists, and they must not drop pages.

## Method

The check runs in three stages. The first two are deterministic and cost no tokens. Only a short digest reaches a model.

1. `tests/structure/structure.mjs <out> <project>[=root.tex] ...`, with `LV_SIDECAR` set
   - It copies each project to `<out>/work` and never works in place. With `FRESH=1` it also drops the project's own `.latexfrog`, so LatexFrog meets the project as a new one.
   - It asks the sidecar for the trees, writes profiles for these cases, and builds each of them:
     - the full document;
     - one part;
     - two parts that are not neighbours;
     - the Export of one part.
   - It writes `trees.json`, the PDFs and `run.json`.
   - `skel.py` (PyMuPDF) turns each PDF into a small JSON skeleton: page count, page labels, bookmarks, and the text lines of each page.
2. `tests/structure/compare.mjs <out>` matches the tree against the skeletons and writes `compare.json` and `digest.md`. It reports these checks:
   - `tree-not-in-pdf`: headings of the tree, at its top two levels, that are not found in the full PDF.
     - Headings are matched in document order, so repeated titles do not fool the match.
     - Contents pages are skipped.
     - Headings behind a switch that is off (`cond`) are left out, since they are not in the PDF by design.
   - `pdf-not-in-tree`: bookmarks the tree does not know. Titles that LaTeX writes itself, such as the lists, the bibliography and the index, are ignored.
   - For each selection case:
     - headings of the selected parts that are lost;
     - headings that are renumbered;
     - headings that belong to other parts (foreign), counted only for titles that are unique in the document;
     - pages beyond what the selected parts take in the full PDF.
3. A small model (Haiku) reads only `digest.md`. It sorts each item into one of three kinds:
   - an app bug;
   - the author's LaTeX;
   - acceptable, or a case where fixing it would mean overfitting.

   It never sees PDFs or sources. A person checks the app-bug items in the sources before anything is changed.

A finding is fixed only when the fix is general: a rule about LaTeX, not about one project. Projects whose oddity comes from their own macros are left as they are.

## Findings fixed (2026-11)

- **Partial builds listed excluded chapters.** In the contents, the list of figures and the list of tables of a partial build (`\includeonly`), excluded chapters still appeared.
  - Cause: LaTeX still reads the aux files of the excluded parts, and their `\@writefile` lines fill the lists.
  - Fix: the driver now reads those aux files with `\@writefile` disabled. Labels and counters still come through, so cross-references keep working.
- **The tree showed headings from files that are read only behind a switch that is off.** Examples are `\ifdefined\X ... \fi` with `\X` undefined, and `\iffalse`.
  - Such headings now carry `cond`.
  - The outline dims them and its tooltip names the switch.
- **A heading command used as an argument was read as a heading.** This covers uses such as `\titlespacing\section{...}` and `\let\oldsection\section`.
- **Arguments of `\color`, `\textcolor`, `\label` and similar leaked into heading titles.** For example, `{\color{X}Preface}` was read as "XPreface".

## Results after the fixes (22 corpus projects plus the two books)

**Clean.** Nine projects have nothing off. This includes both books: every heading is found, the numbering is kept in the one-part, two-part and Export builds, and no other part's headings appear.

**Phd template, partial builds.** The excluded chapters no longer show up in the contents.

**Haiku's triage, checked by hand.** Haiku flagged some items as app bugs. Checked against the sources, they are not:
- **openintro:** it builds chapter titles from its own `\chaptertitle` and `\chaptersection` macros. Its full build "fails" only because `main.tex` loads a package inside a group, and it still writes its PDF.
- **vimtex multifile:** this is a test fixture. All its chapters sit in one part, so a build of "one part" keeps everything.
- **tex-thesis:** its Introduction and Conclusion come from the template's own macros.
- **phd template:** it has a title with math, and an optional short title.
- **latexindent:** its documentation (0 headings found) and its test cases are fixture files, with sections in the preamble.

**Engine inference.** Two projects failed with the configuration LatexFrog infers for a new project. Both causes were general:
- **AltaCV:** fontspec is loaded only inside `\iftutex`, and the document supports pdfLaTeX. Such a guarded load, or one in the `\else` of `\ifpdftex`, no longer asks for XeLaTeX. AltaCV now builds.
- **ElegantBook in Chinese:** fontspec sits behind `\ifpdftex`, but the class calls `\xeCJKsetup`. xeCJK's commands now ask for XeLaTeX. The project still fails on this machine because the Windows font SimHei is not installed.

The harness used to force XeLaTeX on its own whenever it saw fontspec. That rule is gone, so the check now covers the app's inference too.

**Not the app.**
- latex-book needs `sourceserifpro.sty`, which this TeX installation does not have.
- l3kernel's documentation needs its `.dtx` bootstrap.
- The OpenLogic course reads `../../sty`, outside the folder taken as the project.
- latexindent's test cases put sections in the preamble on purpose.

## Rerunning

```bash
LV_SIDECAR=target/release/lv-sidecar.exe FRESH=1 node apps/texpile-editor/tests/structure/structure.mjs <out> <project> ...
```

```bash
node apps/texpile-editor/tests/structure/compare.mjs <out>
```

Run it from PowerShell. Under Git Bash, the TeX environment differs: xdvipdfmx did not find the phd template's EPS figures, and every XeLaTeX case failed for that reason, not because of LatexFrog.

Then give `<out>/digest.md` to a small model with the triage prompt above.
