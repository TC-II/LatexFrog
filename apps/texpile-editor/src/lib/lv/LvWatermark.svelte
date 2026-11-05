<script lang="ts">
	// A profile's watermark: a text with fields, where it goes on the page, its color, strength, size and angle, and whether this
	// profile's PDF carries it. The app draws it from the driver, under the page's content; the document is not touched. Switched off,
	// the settings stay in the profile for the next time.
	import { m } from '$lib/paraglide/messages';
	import { WATERMARK_POSITIONS, watermarkDefaults, watermarkPreviewText, type WatermarkJson, type WatermarkPosition } from './lvProfiles';

	let { value, profile, onChange }: { value: WatermarkJson | undefined; profile: string; onChange: (next: WatermarkJson) => void } = $props();

	const INPUT = 'rounded border border-surface-300-700 bg-transparent px-1 py-0.5';
	const w = $derived<WatermarkJson>(value ?? { on: false, text: m.lv_watermark_default_text() });
	const shown = $derived(watermarkDefaults(w));
	const on = $derived(!!value && value.on !== false);

	const POSITION_LABEL: Record<WatermarkPosition, () => string> = {
		center: () => m.lv_watermark_pos_center(),
		top: () => m.lv_watermark_pos_top(),
		bottom: () => m.lv_watermark_pos_bottom(),
		'top-left': () => m.lv_watermark_pos_top_left(),
		'top-right': () => m.lv_watermark_pos_top_right(),
		'bottom-left': () => m.lv_watermark_pos_bottom_left(),
		'bottom-right': () => m.lv_watermark_pos_bottom_right()
	};

	/** what equals the engine's default is not written; `on` is written only when it is off */
	function set(patch: Partial<WatermarkJson>) {
		const next: WatermarkJson = { ...w, ...patch };
		if (next.on !== false) delete next.on;
		for (const k of ['size', 'angle'] as const) if (next[k] === undefined || Number.isNaN(next[k])) delete next[k];
		if (!next.bold) delete next.bold;
		if (next.position === 'center') delete next.position;
		onChange(next);
	}

	const number = (text: string) => (text.trim() === '' ? undefined : Number(text));

	// the preview: an A4 page 96 px wide, so a point is 96/595 of a pixel; the margins are the engine's, 1 cm and 1.5 cm
	const PT = 96 / 595;
	const place = $derived.by(() => {
		const p = shown.position;
		const y = p.startsWith('top') ? `top: ${28 * PT}px` : p.startsWith('bottom') ? `bottom: ${28 * PT}px` : 'top: 50%';
		const x = p.endsWith('left') ? `left: ${43 * PT}px` : p.endsWith('right') ? `right: ${43 * PT}px` : 'left: 50%';
		const tx = p.endsWith('left') || p.endsWith('right') ? '0' : '-50%';
		const ty = p === 'center' ? '-50%' : '0';
		return `${y}; ${x}; transform: translate(${tx}, ${ty}) rotate(${-shown.angle}deg)`;
	});
	const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<div class="flex flex-col gap-1 rounded border border-surface-300-700 p-2" data-testid="lv-watermark">
	<div class="text-xs opacity-70">{m.lv_watermark_title()}</div>
	<label class="flex items-center gap-2">
		<input type="checkbox" checked={on} data-testid="lv-watermark-on" onchange={(e) => set({ on: e.currentTarget.checked })} />
		{m.lv_watermark_on()}
	</label>
	<div class="flex gap-2 {on ? '' : 'opacity-50'}">
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<input class="{INPUT} w-full" value={w.text} aria-label={m.lv_watermark_text()} placeholder={m.lv_watermark_text()} data-testid="lv-watermark-text" oninput={(e) => set({ text: e.currentTarget.value })} />
			<p class="text-xs opacity-60">{'{date}'} {m.lv_watermark_help_date()}, {'{page}'} {m.lv_watermark_help_page()}, {'{profile}'} {m.lv_watermark_help_profile()}</p>
			<label class="flex items-center justify-between gap-2">
				{m.lv_watermark_position()}
				<select class={INPUT} value={shown.position} data-testid="lv-watermark-position" onchange={(e) => set({ position: e.currentTarget.value as WatermarkPosition, size: undefined, angle: undefined })}>
					{#each WATERMARK_POSITIONS as p (p)}
						<option value={p}>{POSITION_LABEL[p]()}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-center justify-between gap-2">
				{m.lv_watermark_color()}
				<span class="flex items-center gap-2">
					<input type="color" class="h-5 w-8 cursor-pointer bg-transparent" value={shown.color} onchange={(e) => set({ color: e.currentTarget.value })} />
					<label class="flex items-center gap-1 text-xs"><input type="checkbox" checked={shown.bold} onchange={(e) => set({ bold: e.currentTarget.checked })} />{m.lv_watermark_bold()}</label>
				</span>
			</label>
			<label class="flex items-center justify-between gap-2">
				{m.lv_watermark_opacity()}
				<input type="range" min="5" max="100" step="5" value={shown.opacity} class="w-28" onchange={(e) => set({ opacity: Number(e.currentTarget.value) })} />
			</label>
			<div class="flex items-center justify-between gap-2">
				<label class="flex items-center gap-1">
					{m.lv_watermark_size()}
					<input class="{INPUT} w-14" type="number" min="1" max="400" value={w.size ?? ''} placeholder={String(shown.size)} onchange={(e) => set({ size: number(e.currentTarget.value) })} />
				</label>
				<label class="flex items-center gap-1">
					{m.lv_watermark_angle()}
					<input class="{INPUT} w-14" type="number" min="-360" max="360" value={w.angle ?? ''} placeholder={String(shown.angle)} onchange={(e) => set({ angle: number(e.currentTarget.value) })} />
				</label>
			</div>
		</div>
		<!-- the page as it will come out, at A4 -->
		<div class="relative h-[136px] w-24 shrink-0 overflow-hidden rounded-sm border border-surface-300-700 bg-white" role="img" aria-label={m.lv_watermark_preview()} data-testid="lv-watermark-preview">
			{#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
				<div class="absolute h-px bg-surface-300" style="left: 16px; right: 16px; top: {24 + i * 12}px"></div>
			{/each}
			{#if on}
				<span
					class="absolute whitespace-nowrap {shown.bold ? 'font-bold' : ''}"
					style="{place}; transform-origin: {shown.position === 'center' ? 'center' : 'left top'}; font-family: serif; font-size: {shown.size * PT}px; line-height: 1; color: color-mix(in srgb, {shown.color} {shown.opacity}%, white)"
					>{watermarkPreviewText(shown.text, profile, today)}</span
				>
			{/if}
		</div>
	</div>
</div>
