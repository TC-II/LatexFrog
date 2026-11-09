# Watching a dev run from outside

A dev run of the app can be opened to a debugger on two local ports. With them, a tool outside the app (a script, or Claude Code) sees the console, the exceptions, the failed requests and the state of the page as the failure happens, without anyone copying errors by hand.

| Port | What | Flag |
| --- | --- | --- |
| 9222 | The window (renderer): console, network, page state | `--remote-debugging-port=9222` |
| 9229 | The main process: IPC, sidecar, autosync, `console.*` of `electron/src/` | `--inspect=127.0.0.1:9229` |

Both listen on `127.0.0.1` only (`--remote-debugging-address=127.0.0.1` for the first). Never open them on another address: anyone who reaches the port controls the app. They are for dev runs; a packaged app does not open them.

## Starting the app with the ports

Add the flags before the app path:

```
npx electron --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --inspect=127.0.0.1:9229 . [project folder]
```

The app ignores arguments that start with `-` when it looks for the folder to open, so the flags do not change which project opens.

The launcher `abrir-app-desarrollo.bat`, at the root of the repository, does exactly this. It builds the sidecar and the app, starts vite on port 5180, then runs electron with the flags. The ports can be changed with `set LF_DEBUG_RENDERER=<n>` and `set LF_DEBUG_MAIN=<n>` before running it. It needs `cargo` and corepack (for pnpm) to be found; it adds `%USERPROFILE%\.cargo\bin` to the PATH itself.

## Checking the ports

```
curl http://127.0.0.1:9222/json/list
curl http://127.0.0.1:9229/json/list
```

The first lists the window (`type: page`, `url` `http://127.0.0.1:5180/#/workspace`) and its workers; the second lists one `node` target, the main process. A connection error means the app is not running or was started without the flags.

In a dev run the window is served by vite over `http`, not from a `file://` page, so tools that only list `file://` Electron pages (REA's `list_electron_targets`) do not show it. Use the CDP endpoint directly, as the script below does.

## The observer

`scripts/dev-observe.mjs` attaches to both ports and writes one line per problem. It only listens: it evaluates no JavaScript and changes nothing. It needs Node 22 or later.

```
node scripts/dev-observe.mjs [logFile]
```

The log defaults to `latexfrog-dev/events.log` in the system temp folder. If the app is still starting, the script waits up to three minutes for the ports. Run it in a second terminal, or ask Claude Code to run it in the background, before reproducing the failure.

What it records, with the milliseconds since it started:

- `[renderer] EXCEPTION`: an uncaught exception, with its stack and `file:line`.
- `[renderer] console.error`, `console.warning`, `log.error`, `log.warning`.
- `[renderer] HTTP` for any response with status 400 or more, and `NET-FAIL` for a request that failed.
- `[renderer] CRASHED`: the renderer process died.
- `[main] console.*`: everything the main process prints.
- `closed`: the connection dropped, because the app was closed or restarted. Run the script again after a restart; it does not reconnect by itself.

Advice for reading the log:

- The renderer's startup warnings (Electron's content security policy warning, Svelte's `binding_property_non_reactive` and `state_proxy_equality_mismatch`) appear at once when the script attaches. They are not the failure you are chasing, but a Svelte warning can point at a state bug.
- A failure that leaves no trace (a wrong layout, a button that does nothing) will not show in the log. Say what you did and what you saw, and inspect the page's state at that moment.

## Working with Claude Code

1. Run `abrir-app-desarrollo.bat` and wait for the window.
2. Tell Claude Code the app is open. It checks both ports, starts the observer in the background and reads the log.
3. Use the app until it fails, and say so. Claude Code reads the log from that moment, and when the log is not enough it connects to port 9222 to read the page's state (stores, DOM, the project's open files).
4. Close the window when done. The launcher closes vite; the observer ends by itself.

Do not edit `apps/texpile-editor/src` while a measurement harness is running against the same app (see the live measurement harness note): vite reloads the window on every edit, and the observer's connection and the run's state go with it.

Never kill Electron by name to restart it: Claude desktop is Electron too. Close the app's own window, or stop the process by the PID that owns port 9222.
