// Passive observer for a dev run of the app. Attaches to the renderer (--remote-debugging-port) and to the main process
// (--inspect) over the Chrome DevTools Protocol and writes one line per problem to a log file. It only listens: it
// evaluates nothing and changes nothing. See docs/debugging-dev-app.md.
//
//   node scripts/dev-observe.mjs [logFile]
//   LF_DEBUG_RENDERER=9222 LF_DEBUG_MAIN=9229 set the ports (the defaults); needs Node 22+ for the global WebSocket.
import { appendFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rendererPort = process.env.LF_DEBUG_RENDERER ?? '9222';
const mainPort = process.env.LF_DEBUG_MAIN ?? '9229';
const LOG = process.argv[2] ?? path.join(os.tmpdir(), 'latexfrog-dev', 'events.log');
writeFileSync(LOG, '');
const t0 = Date.now();
const out = (src, kind, text) => {
	const line = `${String(Date.now() - t0).padStart(7)}ms [${src}] ${kind}: ${text}\n`;
	appendFileSync(LOG, line);
	process.stdout.write(line);
};

const show = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.type));

/** the renderer's console and network problems, or the main process's console, as they happen */
function attach(src, wsUrl, domains) {
	const ws = new WebSocket(wsUrl);
	let id = 0;
	const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
	ws.onopen = () => {
		out(src, 'attached', wsUrl);
		for (const d of domains) send(`${d}.enable`);
	};
	ws.onmessage = (ev) => {
		const m = JSON.parse(ev.data);
		const p = m.params;
		switch (m.method) {
			case 'Runtime.consoleAPICalled':
				// the main process has no other log, so all of its console is kept; the renderer's only when it is a problem
				if (src === 'main' || ['error', 'warning', 'assert'].includes(p.type)) out(src, `console.${p.type}`, p.args.map(show).join(' ').slice(0, 2000));
				break;
			case 'Runtime.exceptionThrown': {
				const d = p.exceptionDetails;
				out(src, 'EXCEPTION', `${d.text} ${d.exception?.description ?? ''} @ ${d.url}:${d.lineNumber}`.slice(0, 3000));
				break;
			}
			case 'Log.entryAdded':
				if (['error', 'warning'].includes(p.entry.level)) out(src, `log.${p.entry.level}`, `${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 1000));
				break;
			case 'Network.loadingFailed':
				if (!p.canceled) out(src, 'NET-FAIL', `${p.errorText} ${p.requestId}`);
				break;
			case 'Network.responseReceived':
				if (p.response.status >= 400) out(src, 'HTTP', `${p.response.status} ${p.response.url}`);
				break;
			case 'Inspector.targetCrashed':
				out(src, 'CRASHED', 'the renderer process died');
				break;
		}
	};
	ws.onclose = () => out(src, 'closed', 'connection closed: the app was closed or restarted');
	ws.onerror = () => out(src, 'ws-error', wsUrl);
}

async function targets(port) {
	try {
		return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	} catch {
		return null;
	}
}

// the app may still be starting: wait for both ports instead of failing
let page;
let node;
for (let i = 0; i < 180 && !(page && node); i++) {
	page ??= (await targets(rendererPort))?.find((t) => t.type === 'page');
	node ??= (await targets(mainPort))?.[0];
	if (!(page && node)) await new Promise((r) => setTimeout(r, 1000));
}
if (!(page && node)) {
	out('observer', 'gave-up', `nothing on ports ${rendererPort} and ${mainPort} after 3 minutes: is the app running with the debug flags?`);
	process.exit(1);
}
attach('renderer', page.webSocketDebuggerUrl, ['Runtime', 'Log', 'Network', 'Inspector']);
attach('main', node.webSocketDebuggerUrl, ['Runtime']);
