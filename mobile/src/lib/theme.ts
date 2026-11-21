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
  /** the dark main button (light in the dark theme) and its label, and the deep navy of the summary card and its two text colours */ action: string; onAction: string; navy: string; onNavy: string; onNavySoft: string;
  /** soft backgrounds for a problem, a warning and good news, and the border of a problem / a warning */ dangerBg: string; warnBg: string; okBg: string; dangerLine: string; warnLine: string;
};

export const LIGHT: Palette = {
  brand: '#0054fa', ink: '#182033', soft: '#6b7385', line: '#e6e9ee', lineStrong: '#cdd3dc', bg: '#f8f9f7', card: '#ffffff', danger: '#b4443c', ok: '#2f7d5b', warn: '#9a5b13',
  tint: '#eef3fe', tintLine: '#c9d8fa', press: '#e8eefc', wash: '#f2f4f6', dangerBg: '#fbf0ef', warnBg: '#fdf5e7', okBg: '#ebf5ef', dangerLine: '#f0cdca', warnLine: '#f2ddb0',
  action: '#0054fa', onAction: '#ffffff', navy: '#00369f', onNavy: '#ffffff', onNavySoft: '#b4c9fe'
};

export const DARK: Palette = {
  brand: '#6c93f0', ink: '#e9edf5', soft: '#a0a9bc', line: '#252d45', lineStrong: '#34405f', bg: '#0c1020', card: '#141a2e', danger: '#f09a93', ok: '#6fcb9f', warn: '#e8b36b',
  tint: '#1a2547', tintLine: '#2f4688', press: '#202d57', wash: '#1a2138', dangerBg: '#35191c', warnBg: '#33260f', okBg: '#12301f', dangerLine: '#6b2a2f', warnLine: '#6b4a1c',
  action: '#6c93f0', onAction: '#0b1020', navy: '#16307f', onNavy: '#ffffff', onNavySoft: '#aab6d3'
};

/** Shapes shared by every screen: corner radii (cards 20, controls 14, chips and pills fully round), the soft card shadow, and the 8-point spacing steps. */
export const radius = { card: 20, control: 14, pill: 999 } as const;
export const shadow = { card: '0 1px 2px rgba(17, 23, 47, 0.04), 0 6px 20px rgba(17, 23, 47, 0.05)' } as const;
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export type ThemeName = 'light' | 'dark';

/** The one shared colour object: starts light, and `applyPalette` swaps its values in place. */
export const color: Palette = { ...LIGHT };

export const applyPalette = (name: ThemeName): void => { Object.assign(color, name === 'dark' ? DARK : LIGHT); };

/** Satoshi (assets/fonts, loaded in app/_layout.tsx) for headings and the figures that matter. One family per weight, so never add fontWeight beside it. Body text keeps the phone's own font, which also covers Hindi and the other Indian scripts that Satoshi does not have. */
export const display = { regular: 'Satoshi-Regular', medium: 'Satoshi-Medium', bold: 'Satoshi-Bold' } as const;
