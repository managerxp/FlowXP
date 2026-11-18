/* How wide things are allowed to be. Pure, so the rules can be tested without a screen. */
export const WIDE = 768;       // a tablet, or a phone turned sideways: a left rail and side-by-side panes
export const GRID = 1000;      // room for two columns of rows next to the rail
export const PAGE_MAX = 760;   // a form or list reads best no wider than this
export const GRID_MAX = 1120;
export const SIDEWAYS_MAX_HEIGHT = 520;   // a phone on its side is wide but only about 400 tall
export const SIDEWAYS_PAGE = 900;

export const isWide = (width: number): boolean => width >= WIDE;
/** A phone turned sideways: wide, but short. A tablet is never this short. */
export const isSideways = (width: number, height: number): boolean => width > height && height < SIDEWAYS_MAX_HEIGHT && width >= WIDE;
/** Two columns of rows: a tablet on its side, or a phone on its side (a 750-wide single column of short rows wastes the screen). */
export const columnsFor = (width: number, height?: number): 1 | 2 => (width >= GRID || (height !== undefined && isSideways(width, height)) ? 2 : 1);
/** The widest a page may be: a list page opens up to two columns on a wide screen, a phone on its side uses most of its width, everything else keeps its own limit. */
export const pageMax = (width: number, max: number = PAGE_MAX, grid = false, height?: number): number => {
  if (height !== undefined && isSideways(width, height)) return grid ? GRID_MAX : max >= PAGE_MAX ? Math.max(max, SIDEWAYS_PAGE) : max;   // a form kept narrow on purpose stays narrow
  return grid && width >= GRID ? GRID_MAX : max;
};
