import { it, expect } from 'vitest';
import { texErrors } from '../../../../../../electron/src/draft/draftService';

it('counts the TeX errors of a log and names the first with its input line', () => {
	const log = [
		'(./sections/rta_en_frecuencia.tex',
		'! Missing number, treated as zero.',
		'<to be read again> ',
		'                   X',
		'l.363     \\end',
		'              {longtblr}',
		'! Missing = inserted for \\ifnum.',
		'l.363     \\end',
		'! Missing number, treated as zero.',
		'(That makes 100 errors; please try again.)',
		'!  ==> Fatal error occurred, no output PDF file produced!'
	].join('\r\n');
	expect(texErrors(log)).toEqual({ count: 3, first: 'Missing number, treated as zero. (l.363)' });
});

it('finds none in a clean log, so the caller keeps its own message', () => {
	expect(texErrors('This is LuaHBTeX\nOutput written on draft.pdf (3 pages).\n')).toBeNull();
	expect(texErrors('')).toBeNull();
});
