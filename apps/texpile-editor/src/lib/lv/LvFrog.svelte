<script lang="ts">
	// The mark on every option LatexFrog adds to Texpile: a small grey frog beside its label.
	let { size = 12 }: { size?: number } = $props();
</script>

<svg class="shrink-0 text-surface-500" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-testid="lv-frog">
	<circle cx="7.5" cy="6.5" r="4" />
	<circle cx="16.5" cy="6.5" r="4" />
	<path d="M12 7c-5.5 0-10 3.800-10 8.500 0 3 2.500 4.500 5 4.500h10c2.500 0 5-1.500 5-4.500C22 10.800 17.500 7 12 7z" />
	<circle cx="7.500" cy="6.500" r="1.500" fill="var(--color-surface-50, #fff)" />
	<circle cx="16.500" cy="6.500" r="1.500" fill="var(--color-surface-50, #fff)" />
</svg>
