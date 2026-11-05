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
| `view` | | `ProjectView` |
| `refresh` | | `ProjectView`, re-indexed from disk |
| `set-root` | `file` | `ProjectView`; session only, persist through `config-write` |
| `set-state` | any of `profile`, `selection` (part names), `variables` (name to value), `autoCompile`, `idleMs`, `outsideSave`, `draftImages` | `State` |
| `file-info` | `file` | `FileInfo`; which part a file belongs to and if it affects the active profile |
| `compile` | optional `profile`, `root`, `parts` | `BuildAck`; `root` and `parts` are applied as `set-root` and `selection` first |
| `cancel` | | `{cancelled: bool}` |
| `status` | | `{building: bool, lockedBy: number or null}` |
| `problems` | `profile` | `Problem[]` |
| `symbols` *async* | | `Symbols`; `sections` is the project-wide outline |
| `synctex-forward` | `file`, `line`, optional `profile` | `SyncForward` or `null`; `profile`, the PDF on screen, is used first when it holds the file |
| `synctex-inverse` | `profile`, `page`, `x`, `y` | `SyncInverse` or `null` |
| `pdf-for` | `file` | PDF path or `null`, the newest PDF that contains the file |
| `figures-status` *async* | | `FiguresStatus`: every figure in the code with where it is (`codigo`, `linea`, `dondeLinea`, `caption`) and its `estado`; `revisado` says the last check is of the code as it is now |
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
| `config-read` | | text of `latexfrog.json` or `null` |
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

## Types

The Rust structs in `crates/lv-core/src` are the reference; fields are camelCase unless a struct says otherwise. The ones the UI needs first:

- `BuildAck`: `{kind:"started",id}` or `{kind:"queued"}`.
- `ProjectView` (`session.rs`): `name`, `root`, `candidates`, `rootFile`, `configSaved`, `configError`, `config`, `state`, `parts`, `indexMs`, `lockedBy`.
- `Migration`: `{config: bool, folder: bool, conflicts: string[]}`.
- `Section` in `Symbols.sections` (`symbols.rs`): `level` (0 part to 6 subparagraph), `title`, `file`, `line`, `label`.
- `SyncForward`: `perfil`, `pdf`, `page`, `rects`, `line_used`. `SyncInverse`: `file`, `line`, `inside`.

## Project files

`latexfrog.json` is the configuration; `.latexfrog/` holds state, builds, drivers, history and the lock. `open` migrates `latexviewer.json` and `.lv/` once. If the new one already exists, it wins, the old one stays untouched and is named in `migration.conflicts`. No migration happens while another instance holds the lock.
