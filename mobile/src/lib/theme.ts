/*
 * The app's colours, in one place, light and dark. `color` is ONE shared object that screens read when they draw, so switching the theme
 * (Settings > Display) changes its values and the app redraws from the top (the root layout keys its screens on the theme, see app/_layout.tsx).
 * Anything that reads `color.x` while it draws follows the theme; a value copied into a constant at load time would not, so such tables are
 * written as functions. Colours a screen needs that are not in here (a white label on a blue button, a dim scrim) are the same in both themes.
 */
export type Palette = {
  brand: string; ink: string; soft: string; line: string; lineStrong: string; bg: string; card: string; danger: string; ok: string; warn: string;
  /** a pale blue wash behind a quiet button, its border, and the pressed row */ tint: string; tintLine: string; press: string;
  /** a grey wash behind a chip or disabled area */ wash: string;
  /** soft backgrounds for a problem, a warning and good news, and the border of a problem / a warning */ dangerBg: string; warnBg: string; okBg: string; dangerLine: string; warnLine: string;
};

export const LIGHT: Palette = {
  brand: '#0b57ff', ink: '#0f172a', soft: '#475569', line: '#e2e8f0', lineStrong: '#cbd5e1', bg: '#f8fafc', card: '#ffffff', danger: '#b91c1c', ok: '#047857', warn: '#92400e',
  tint: '#eaf1ff', tintLine: '#b9ceff', press: '#dbe7ff', wash: '#f1f5f9', dangerBg: '#fef2f2', warnBg: '#fffbeb', okBg: '#ecfdf5', dangerLine: '#fecaca', warnLine: '#fde68a'
};

export const DARK: Palette = {
  brand: '#4f8bff', ink: '#e6edf7', soft: '#a3b3c9', line: '#26344a', lineStrong: '#34466a', bg: '#0b1220', card: '#111c2e', danger: '#ff8a80', ok: '#3ddc97', warn: '#f5b26a',
  tint: '#16264a', tintLine: '#2b4a8f', press: '#1b2f5c', wash: '#16213a', dangerBg: '#3a1b1f', warnBg: '#3a2a14', okBg: '#10321f', dangerLine: '#6b2a2f', warnLine: '#6b4a1c'
};

export type ThemeName = 'light' | 'dark';

/** The one shared colour object: starts light, and `applyPalette` swaps its values in place. */
export const color: Palette = { ...LIGHT };

export const applyPalette = (name: ThemeName): void => { Object.assign(color, name === 'dark' ? DARK : LIGHT); };
