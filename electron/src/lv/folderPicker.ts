// The Open Folder picker starts where the last one ended: every entry point (File menu, start screen, new window) goes through here.
import { dialog, type BrowserWindow } from 'electron';
import { readSettings, writeSettings } from '../appSettings';

const KEY = 'lvLastPickedFolder';

/** the folder picker; null when cancelled. The chosen folder is remembered for the next time */
export async function pickFolder(win: BrowserWindow | undefined, title = 'Open Folder'): Promise<string | null> {
	const last = readSettings()[KEY];
	const options: Electron.OpenDialogOptions = {
		title,
		...(typeof last === 'string' && last ? { defaultPath: last } : {}),
		// createDirectory is macOS-only: without it NSOpenPanel has no New Folder button
		properties: ['openDirectory', 'createDirectory']
	};
	const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
	const picked = res.canceled ? undefined : res.filePaths[0];
	if (!picked) return null;
	writeSettings({ [KEY]: picked });
	return picked;
}
