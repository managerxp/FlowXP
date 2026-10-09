/* How wide things are allowed to be. Pure, so the rules can be tested without a screen. */
export const WIDE = 768;       // a tablet, or a phone turned sideways: a left rail and side-by-side panes
export const GRID = 1000;      // room for two columns of rows next to the rail
export const PAGE_MAX = 760;   // a form or list reads best no wider than this
export const GRID_MAX = 1120;

export const isWide = (width: number): boolean => width >= WIDE;
export const columnsFor = (width: number): 1 | 2 => (width >= GRID ? 2 : 1);
/** The widest a page may be: a list page opens up to two columns on a wide screen, everything else keeps its own limit. */
export const pageMax = (width: number, max: number = PAGE_MAX, grid = false): number => (grid && width >= GRID ? GRID_MAX : max);
