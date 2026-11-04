<p align="center"><img alt="LatexFrog" src="branding/Logo-icon.svg" width="140" /></p>

# LatexFrog

A fast desktop LaTeX editor for large projects: books with many chapters, heavy TikZ figures and partial builds. Windows first, Linux soon after.

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
