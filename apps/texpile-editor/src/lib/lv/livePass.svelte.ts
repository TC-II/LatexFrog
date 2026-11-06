// Where Live's last full pass stands, for the dot on the Live button: compiling, done (and how long it took) or failed.
// The pane's own status line gives way first when the bar is narrow; the button is always in sight.
export type LivePassState = 'idle' | 'compiling' | 'done' | 'failed';

export const livePass = $state<{ state: LivePassState; ms: number | null }>({ state: 'idle', ms: null });
