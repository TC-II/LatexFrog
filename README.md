<p align="center"><img alt="LatexFrog" src="branding/Logo-icon.svg" width="140" /></p>

<h1 align="center">LatexFrog</h1>

<p align="center"><b>LaTeX, built for big books.</b><br />A fast desktop editor for large projects, with a Rust compile engine inside.</p>

<p align="center">
  <a href="https://tc-ii.github.io/LatexFrog/"><b>Home page</b></a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="docs/plan.md">Plan</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-1f7a4d" /></a>
  <img alt="Windows today, Linux soon" src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20Linux%20soon-7ed957?labelColor=10301f" />
  <img alt="Engine in Rust" src="https://img.shields.io/badge/engine-Rust-1f7a4d" />
</p>

---

A fast desktop LaTeX editor for large projects: books with many chapters, heavy TikZ figures and partial builds. Windows first, Linux soon after.

| | |
| --- | --- |
| **Profiles and partial builds** | Build the whole book, the chapter you are in, or any set of parts, with the numbering of the full PDF. |
| **Figure cache** | Heavy TikZ figures compile once; only the ones that changed rebuild. |
| **Instant SyncTeX** | 0.3 ms per lookup through the engine, against 278 ms for the CLI, measured on the same machine. |
| **Visual and source editor** | LaTeX, Typst and Markdown, with equations and figures shown as they print. |
| **Exports that match print** | Parts as their own PDFs with the book's page and equation numbers. |
| **Diagnostics** | A project doctor, orphan files, a project lock, build history and a problems panel. |

LatexFrog adds a Rust compile engine to a visual and source editor: compile profiles and partial builds, a figure cache, instant SyncTeX, exports with the printed numbering, and project diagnostics. See [docs/plan.md](docs/plan.md) for the current state.

## Build from source

```bash
npx --yes pnpm@10.14.0 install --config.engine-strict=false
pnpm app:build
pnpm exec electron-builder --dir
```

You need Node, Rust (`cargo build --release -p lv-sidecar`) and a TeX distribution such as MiKTeX or TeX Live.

## Credits and license

- LatexFrog is derived from [Texpile](https://github.com/texpile/texpile) and is not published or endorsed by the Texpile project. "Texpile" and its logo are trademarks of that project; see [TRADEMARK.md](TRADEMARK.md).
- The compile engine in `crates/` is by Juan Sbruzzi, under the MIT License ([crates/LICENSE-MIT](crates/LICENSE-MIT)).
- Third-party notices are in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

LatexFrog as a whole is licensed under the [AGPL-3.0](LICENSE).
