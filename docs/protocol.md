# Sidecar protocol (version 2)

`lv-sidecar` is one long-lived process per window. It speaks JSON, one object per line: requests on stdin, everything else on stdout. All paths are relative to the project root and use `/`. Closing stdin cancels running work and exits, so nothing keeps compiling if the app dies.

## Messages

First line after start:

    {"type":"hello","protocol":2,"version":"0.1.0"}

Request (`id` is any JSON value, echoed back):

    {"id":1,"cmd":"compile","profile":"fast"}

Response:

    {"type":"response","id":1,"ok":true,"data":{...}}
    {"type":"response","id":1,"ok":false,"error":"message"}

Event, at any time:

    {"type":"event","event":{"type":"started",...}}

Responses to commands marked *async* below may arrive after later responses: match by `id`. All others are answered in order. `cancel` is never blocked by an async command.

## Commands

Every command except `open` needs an open project.

| Command | Fields | Data |
|---|---|---|
| `open` | `root`: absolute folder | `{project: ProjectView, migration: Migration}` |
| `close` | | `null`; releases the project and its lock |
| `view` | | `ProjectView`. Each of `config.profiles` carries `compiles`: the parts it compiles now, by name and in document order (the list its driver takes), or `null` when it cannot say; the interface dims the other parts from it |
| `refresh` | | `ProjectView`, re-indexed from disk |
| `set-root` | `file` | `ProjectView`; session only, persist through `config-write` |
| `set-state` | any of `profile`, `selection` (part names), `autoCompile`, `idleMs`, `outsideSave`, `draftImages` | `State` |
| `file-info` | `file` | `FileInfo`; which part a file belongs to and if it affects the active profile |
| `compile` | optional `profile`, `root`, `parts` | `BuildAck`; `root` and `parts` are applied as `set-root` and `selection` first |
| `cancel` | | `{cancelled: bool}` |
| `status` | | `{building: bool, lockedBy: number or null}` |
| `problems` | `profile` | `Problem[]` |
| `symbols` *async* | | `Symbols`; `sections` is the project-wide outline |
| `synctex-forward` | `file`, `line`, optional `profile`, or `pdf` (relative to the root) | `SyncForward` or `null`; `profile`, the PDF on screen, is used first when it holds the file. With `pdf`, over that PDF's SyncTeX only: Live's `_draft/draft.pdf` (TeX Live's `synctex` program misses files with accents in their names on Windows) |
| `synctex-files` | `profile`, or `pdf` (relative to the root) | the project files that profile's PDF read (from its SyncTeX), or `null` before its first build; a file a TeX conditional skips is missing. With `pdf`, the same for another PDF of the project with its SyncTeX beside it: Live's `_draft/draft.pdf` |
| `synctex-inverse` | `profile`, `page`, `x`, `y` | `SyncInverse` or `null`; only the project's own files count (a click on a TikZ picture goes to the line that draws it, not into the library) |
| `synctex-inverse-pdf` | `pdf` (relative to the root), `page`, `x`, `y` | the same over another PDF of the project with its SyncTeX beside it: Live's `_draft/draft.pdf` |
| `pdf-for` | `file` | PDF path or `null`, the newest PDF that contains the file |
| `driver-for-live` | `profile?` (default: the active one) | `{path, changed}`: `changed` when the driver or the preamble's copy is new (another profile, other parts, an edited preamble), and Live recompiles; the body's copy is rewritten without counting. `path` is `.latexfrog/drivers/lv-<profile>-live.tex`, the profile's driver (flags, parts, pieces, watermark; no figure externalization) with `\begin{document}` in the file itself, for Live's warm lualatex. Written again on each call |
| `figures-status` *async* | | `FiguresStatus`: every figure in the code with where it is (`codigo`, `linea`, `dondeLinea`, `caption`) and its `estado`; `revisado` says the last check is of the code as it is now; `imagenes` lists the `\includegraphics` outside TikZ (`imagen`, `codigo`, `linea`, `archivo`, `dondeLinea`, `caption`) |
| `figures-check` | | `BuildAck`; lists the figures without baking any. `bake-finished.remaining` is how many changed or were never compiled |
| `figures-bake` | | `BuildAck` |
| `figures-clean-preview` *async* | | `Cleanup`; deletes nothing |
| `figures-clean` *async* | | `Cleanup` |
| `export` | optional `parts`; absent means all | `BuildAck` |
| `fragment` | `text` | `BuildAck`; preview of a selection |
| `publish` | `profile` | `Published` |
| `output-dir` | `which`: `publish` or `export` | absolute folder |
| `history` | optional `limit` (default 100) | `HistoryEntry[]`, newest first |
| `typical-times` | | profile to typical duration |
| `doctor` *async* | | `Report` |
| `orphans` *async* | | `TexProcess[]` |
| `kill-orphans` *async* | `pids` | killed PIDs |
| `detect` *async* | optional `root` | `Proposal`; writes nothing |
| `config-read` | | text of `.latexfrog/latexfrog.json` or `null` |
| `config-validate` | `text` | `Validation` |
| `config-write` | `text` | `ProjectView` |
| `config-probe` *async* | `text`, optional `part` | `Probe`; tries a configuration without saving it |

The project lock has no command of its own: `ProjectView.lockedBy` and `status.lockedBy` hold the PID of the other instance. While it is set, `compile` and `figures-bake` fail.

## Events

`event.type`, with its fields. `id` is the job. Log text arrives in fragments, not lines.

| Type | Fields |
|---|---|
| `queued` | `profile` |
| `started` | `id`, `profile`, `cmdline`, `retry` |
| `log` | `id`, `text` |
| `pass` | `id`, `n`, `tool` (`pdflatex`, `biber`, ...) |
| `figure` | `id`, `n`, `name` |
| `finished` | `id`, `profile`, `ok`, `code`, `cancelled`, `ms`, `pdf`, `updated`, `passes`, `truncated_aux`, `repaired`, `errors`, `warnings`, `badboxes` |
| `error` | `message` |
| `bake-queued` | |
| `bake-listing` | `id`, `phase` |
| `bake-started` | `id`, `phase`, `total`, `listed`, `listing_ms` |
| `bake-progress` | `id`, `done`, `total`, `name`, `ok` |
| `bake-finished` | `id`, `ok`, `cancelled`, `ceded`, `cooked`, `failed`, `remaining`, `ms`, `error` |
| `export-queued` | |
| `export-started` | `id`, `total` |
| `export-progress` | `id`, `done`, `total`, `part`, `num`, `file`, `ok` |
| `export-finished` | `id`, `ok`, `cancelled`, `exported`, `failed`, `ms`, `dir`, `error` |

After `finished`, ask `problems` with its `profile`.

## Live preview processes

The live preview (Texpile's draft mode) keeps a warm LuaLaTeX with the preamble loaded and sends it one paragraph per keystroke; draft passes reconcile it on a pause. The app's draft code speaks that engine's own stdin protocol; the sidecar starts and owns the processes, so every TeX run still goes through it. These commands need no open project. The app uses one sidecar for them in the main process (`electron/src/lv/lvLive.ts`), apart from the windows' build sidecars.

| Command | Fields | Answer |
|---|---|---|
| `live-start` | `tool` (`lualatex`, `biber` or `bibtex`), `args`, `cwd`, `env` (only `PATH`, `BIBINPUTS`, `BSTINPUTS`, `TEXINPUTS`), `stdin` | `{proc}` |
| `live-write` | `proc`, `data`; `quiet: true` sends no answer on success | `null` |
| `live-close-stdin` | `proc` | |
| `live-kill` | `proc` | `{killed}` |
| `live-status` | | `{running}` |

Output and the end of a process come as `{"type":"live","event":...}`, not as session events: `{kind:"out",proc,stream:"out"|"err",data}` in chunks as they arrive (a UTF-8 sequence is never split), then `{kind:"exit",proc,code}`, with `code` null when killed. Closing the sidecar's stdin kills what it runs.

## Types

The Rust structs in `crates/lv-core/src` are the reference; fields are camelCase unless a struct says otherwise. The ones the UI needs first:

- `BuildAck`: `{kind:"started",id}` or `{kind:"queued"}`.
- `ProjectView` (`session.rs`): `name`, `root`, `candidates`, `rootFile`, `configSaved`, `configError`, `config`, `state`, `parts`, `indexMs`, `lockedBy`.
- `Migration`: `{config: bool, folder: bool, conflicts: string[]}`.
- `Section` in `Symbols.sections` (`symbols.rs`): `level` (0 part to 6 subparagraph), `title`, `file`, `line`, `label`.
- `SyncForward`: `perfil`, `pdf`, `page`, `rects`, `line_used`. `SyncInverse`: `file`, `line`, `inside`.

## Project files

`.latexfrog/latexfrog.json` is the configuration; the rest of `.latexfrog/` holds state, builds, drivers, history and the lock, and its `.gitignore` keeps only the configuration. `open` migrates `.lv/`, then a top-level `latexfrog.json` or `latexviewer.json`, once. If the new one already exists, it wins, the old one stays untouched and is named in `migration.conflicts`. No migration happens while another instance holds the lock.
