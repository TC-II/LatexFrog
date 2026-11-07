import { describe, expect, it } from 'vitest';
import { daemonText } from '$lib/draft/heuristics/daemonText';

describe('daemonText', () => {
	it('drops the spaces that start a block', () => {
		expect(daemonText('    Indented words.')).toBe('Indented words.');
	});

	it('blanks the lines of vertical spacing before the text, keeping CRLF and the line count', () => {
		expect(daemonText('\\vspace{0.3cm}\r\nPara los siguientes.\r')).toBe('%\r\nPara los siguientes.\r');
		expect(daemonText('\\vspace*{1em} \\addvspace{2pt}\nText.')).toBe('%\nText.');
		expect(daemonText('\\vfill\n{\\footnotesize Fuentes.}')).toBe('%\n{\\footnotesize Fuentes.}');
		expect(daemonText('\\medskip\n\\vspace{1em}\nText.')).toBe('%\n%\nText.');
		expect(daemonText('\\newpage\r\nAdicionalmente.\r')).toBe('%\r\nAdicionalmente.\r');
		expect(daemonText('\\pagebreak[3]\nText.')).toBe('%\nText.');
	});

	it('leaves other lines alone', () => {
		expect(daemonText('\\textbf{Bold}\nText.')).toBe('\\textbf{Bold}\nText.');
		expect(daemonText('Text.\n\\vspace{1em}\nMore.')).toBe('Text.\n\\vspace{1em}\nMore.');
		expect(daemonText('\\vfillx\nText.')).toBe('\\vfillx\nText.');
		expect(daemonText('\\vspace{1em}')).toBe('\\vspace{1em}');
	});
});
