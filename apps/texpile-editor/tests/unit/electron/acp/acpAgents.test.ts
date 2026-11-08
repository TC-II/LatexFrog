import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { nativeProgram } from '../../../../../../electron/src/shell/findProgram';
import { agentLaunch } from '../../../../../../electron/src/ai/acp/acpAgents';

const cx = {
	findProgram: (name: string) => (name === 'claude' || name === 'opencode' ? `/usr/bin/${name}` : null),
	adapterDir: '/app/agents',
	execPath: '/app/texpile'
};

it("runs a shipped adapter under Electron's own Node, pointed at the reader's own CLI", () => {
	expect(agentLaunch('claude', '', cx)).toEqual({
		ok: true,
		program: '/app/texpile',
		args: [path.join('/app/agents', 'claude-agent-acp.mjs')],
		env: { ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_EXECUTABLE: '/usr/bin/claude' }
	});
	expect(agentLaunch('opencode', '', cx)).toEqual({ ok: true, program: '/usr/bin/opencode', args: ['acp'], env: {} });
	expect(agentLaunch('codex', '', cx)).toEqual({ ok: false, reason: 'missing', program: 'codex' });
	expect(agentLaunch('custom', 'opencode acp --port 0', cx)).toEqual({
		ok: true,
		program: '/usr/bin/opencode',
		args: ['acp', '--port', '0'],
		env: {}
	});
	expect(agentLaunch('/bin/sh', '', cx)).toEqual({ ok: false, reason: 'unset' });
});

it('starts the adapter on the real .exe behind an npm .cmd launcher, which Node cannot spawn without a shell', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-shim-'));
	try {
		const exe = path.join(dir, 'node_modules', 'pkg', 'bin', 'claude.exe');
		fs.mkdirSync(path.dirname(exe), { recursive: true });
		fs.writeFileSync(exe, '');
		const cmd = path.join(dir, 'claude.cmd');
		fs.writeFileSync(cmd, '@ECHO off\r\nSETLOCAL\r\n"%dp0%\\node_modules\\pkg\\bin\\claude.exe"   %*\r\n');
		expect(nativeProgram(cmd, 'win32')).toBe(path.join(dir, 'node_modules', 'pkg', 'bin', 'claude.exe'));
		expect(nativeProgram(cmd, 'linux')).toBe(cmd);
		const bare = path.join(dir, 'codex.cmd');
		fs.writeFileSync(bare, '@ECHO off\r\nnode "%dp0%\\codex.js" %*\r\n');
		expect(nativeProgram(bare, 'win32')).toBe(bare);
		expect(nativeProgram('C:\\bin\\claude.exe', 'win32')).toBe('C:\\bin\\claude.exe');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
