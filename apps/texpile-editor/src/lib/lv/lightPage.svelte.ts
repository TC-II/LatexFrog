// The editor's page in light colors, white like the PDF, under any theme: only the page (visual and source), not the tabs, the
// toolbars or the rest of the window. A class on <html> that app.css reads; on by default, remembered per machine.
const KEY = 'lf:light-page';

function read(): boolean {
	try {
		// on by default: only a page someone turned dark stays dark
		return localStorage.getItem(KEY) !== '0';
	} catch {
		return true;
	}
}

class LightPage {
	on = $state(read());

	constructor() {
		this.apply();
	}

	toggle() {
		this.on = !this.on;
		try {
			localStorage.setItem(KEY, this.on ? '1' : '0');
		} catch {
			/* not remembered, still applied */
		}
		this.apply();
	}

	private apply() {
		if (typeof document !== 'undefined') document.documentElement.classList.toggle('lf-light-page', this.on);
	}
}

export const lightPage = new LightPage();
