// A block as the daemon must read it to set what the page set. The page read the block in vertical mode, at a
// line start; the daemon reads it after its own prefixes (\hspace*{\parindent}, a paragraph's parameters), already
// inside a paragraph, where two things the page kept out of it change the paragraph and the reproduction never
// matches:
// - spaces and tabs that start the block, which TeX's reader drops at a line start and the daemon would set;
// - lines of vertical spacing or page breaks before the text (\vspace{..}, \vfill, \medskip, \newpage, ...). On
//   the page they come before the paragraph, outside its band; in a paragraph \vspace becomes space after its first
//   line and \vfill or \newpage ends it. Such a line becomes a lone %, so line numbers stay as they are.
const VSPACE = String.raw`\\(?:vspace\*?|addvspace)[ \t]*\{[^{}\n]*\}|\\(?:vfill|vfil|smallskip|medskip|bigskip|filbreak|goodbreak|newpage|clearpage|cleardoublepage)(?![A-Za-z])|\\pagebreak(?:\[[0-4]\])?(?![A-Za-z])`;
const VERTICAL_ONLY = new RegExp(String.raw`^[ \t]*(?:(?:${VSPACE})[ \t]*)+(\r?)$`);

export function daemonText(s: string): string {
	const lines = s.replace(/^[ \t]+/, '').split('\n');
	for (let i = 0; i < lines.length - 1; i++) {
		const m = VERTICAL_ONLY.exec(lines[i]);
		if (!m) break;
		lines[i] = '%' + m[1];
	}
	return lines.join('\n');
}
