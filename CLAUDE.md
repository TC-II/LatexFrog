# LatexFrog

LaTeX editor for large projects: a fork of Texpile (Electron + Svelte, AGPL-3.0) with a Rust compile engine that ships inside the app. This repository is the whole product; `docs/plan.md` is the plan and current state.

## Layout

- `apps/texpile-editor/`, `electron/`: the app, from Texpile. Our additions live in `lib/lv/` and `electron/src/lv/`.
- `crates/lv-core`: the engine. `crates/lv-sidecar`: the process the app talks to, JSON lines (MIT, Juan Sbruzzi; see `crates/LICENSE-MIT`).
- `fixtures/`: small synthetic test projects only.

## Rules

- Everything is in English: UI, code, comments, docs, commits. User-facing text goes through paraglide.
- Measure before optimizing. A claim of "faster" needs before and after numbers on the same machine.
- Generated and saved files keep their EOL and BOM, byte for byte.
- Never write LaTeX or code containing backslashes through a shell. Use the editor tools or a script file.
- Do not name files `aux`, `con`, `nul`, `prn` or `com1`: Windows reserves them.
- Delivered output (export and delivery profiles) is never built with draft images.
- Compile only through `crates/lv-sidecar`; do not add a second build path.
- Keep changes inside Texpile's files small and few. It costs conflicts when merging upstream, but it is a cost to weigh, not a ban.

## Public repository

- Never commit personal documents, books, PDFs, or paths from this machine. Books are tested by local path, never copied in.
- The `pre-push` hook runs `scripts/check-public.mjs`. Do not bypass it.
- Never use Texpile's name or logo for this product. Say it derives from Texpile, as `TRADEMARK.md` requires.
- Pushes need an explicit request from Javier.

## Untrusted code

- Before running `pnpm install`, tests, build scripts or any code from a clone, PR, fork or LaTeX project that is not ours, read it first and report anything odd before running it. Check `package.json` scripts (`preinstall`, `install`, `postinstall`, `prepare`), `.npmrc`, `pnpm` settings, git hooks, CI files, shell and `.mjs` scripts, and LaTeX `\write18` or shell-escape use.
- Do not add packages to `pnpm.onlyBuiltDependencies` (currently electron, esbuild, node-pty) without asking Javier.
- Never build a shell command by joining outside text (branch names, URLs, file names). Pass arguments as a list.
- Open untrusted projects and PRs in a separate folder, never inside this repository. A review by Claude is not a guarantee; say what was and was not checked.

## Upstream

`upstream` is texpile/texpile. Merge only when asked, on a test branch, with tests passing before it reaches `main`.

## Commands

- `cargo test -p lv-core`, `cargo build --release -p lv-sidecar`. On this machine cargo needs `$env:USERPROFILE\.cargo\bin` on the PATH. Tests with real TeX (`--features tex`) run from PowerShell.
- `npx --yes pnpm@10.14.0 install --frozen-lockfile --config.engine-strict=false`, then `node node_modules/electron/install.js`, `pnpm electron:build`.
- Never kill Electron by name: Claude desktop is Electron too.

## Test documents

Primary: the book at `..\01-Overleaf\Funciones-de-Aproximaci-n-Libro-TC-`. Secondary: `..\01-Overleaf\Introducci-n-al-an-lisis-de-Circuitos-Lineales-Libro-E3-` and everything else in `..\01-Overleaf`. Work on copies outside this repository.
