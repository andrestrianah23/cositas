// Values used in computed inline styles. Static colors live in styles.css.
export const ACC = 'oklch(0.68 0.11 160)';
export const ACC_TEXT = 'oklch(0.56 0.1 160)';
export const INK = '#2a2622';
export const MUTED = '#7a726a';
export const FAINT = '#a39a91';
export const SOFT = '#f3efea';
export const LABEL = '#5b544d';
export const LINE = '#e6e0d9';
export const DOT = '#d6cec5';

/** Task palette. Index 0 is the app's green accent; tasks store the index. */
const HUES = [160, 250, 32, 70, 350, 200, 290, 110];
export const COLORS = HUES.map((h) => `oklch(0.68 0.14 ${h})`);
export const colorOf = (i: number | null) => COLORS[i ?? 0] ?? COLORS[0];

export const REPEAT_LABEL = { none: '', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const;

/** Day-number circle: filled when selected, accent text for today. */
export const circle = (ds: string, sel: string, today: string) => ({
  background: ds === sel ? ACC : 'transparent',
  color: ds === sel ? '#fff' : ds === today ? ACC_TEXT : INK,
});
