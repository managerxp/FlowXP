/*
 * The handful of primitives every screen uses.
 *
 * One file rather than components/Button/index.jsx and eleven siblings. These
 * are small enough that the folder structure would be larger than the code in
 * it; split them out when one of them grows its own state.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, LoaderCircle, X } from 'lucide-react';
import Reveal from './Reveal.jsx';

/* ── Logo ────────────────────────────────────────────────────────────────
   The uploaded mark (frontend/public/logo.png) already is "FlowXP", icon and
   wordmark in one image, so it renders alone at its own aspect ratio. A text
   wordmark is the fallback only if the file is ever missing. */
export const Logo = ({ className = '', showTagline = false }) => {
  const [broken, setBroken] = useState(false);
  const height = showTagline ? 'h-11' : 'h-9';
  return (
    <span className={`inline-flex flex-col ${className}`}>
      {broken ? (
        <span className="text-xl font-bold tracking-tight text-ink-900">Flow<span className="text-brand-500">XP</span></span>
      ) : (
        <img src="/logo.png" alt="FlowXP" className={`${height} w-auto object-contain object-left`} onError={() => setBroken(true)} />
      )}
      {showTagline && (
        <span className="mt-2 text-xs text-ink-500">AI billing, stock and GST for every business</span>
      )}
    </span>
  );
};

/* ── Button ──────────────────────────────────────────────────────────────
   Renders as <Link>, <a> or <button> depending on what it was given, so a
   navigation control is a real link — right-clickable, middle-clickable, and
   announced as a link by a screen reader. */
const VARIANTS = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm',
  secondary:
    'bg-surface text-ink-900 border border-line-strong hover:bg-surface-2 hover:border-ink-400 shadow-sm',
  ghost:
    'text-ink-700 hover:text-ink-900 hover:bg-surface-2',
  danger:
    'bg-danger text-white hover:bg-danger/90 active:bg-danger shadow-sm',
  dark:
    'bg-ink-900 text-white hover:bg-ink-700'
};

const SIZES = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]'
};

/* The spinner every busy state uses, sized by the text around it. */
export const Spinner = ({ className = 'h-4 w-4' }) => (
  <LoaderCircle aria-hidden="true" className={`animate-spin ${className}`} />
);

/*
 * `loading` keeps the label (so the button does not change width under the
 * pointer), puts a spinner beside it, and disables the control. Callers that
 * already swap the label for "Saving…" can keep doing so.
 */
export const Button = ({
  as, to, href, variant = 'primary', size = 'md', loading = false, className = '', children, ...rest
}) => {
  const classes =
    `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-control) font-medium ` +
    `transition-[background-color,border-color,color,box-shadow,transform] duration-(--duration-fast) ` +
    `active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ` +
    `${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`;

  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>;
  if (href) return <a href={href} className={classes} {...rest}>{children}</a>;
  const Tag = as || 'button';
  const busy = loading ? { disabled: true, 'aria-busy': true } : {};
  return (
    <Tag className={classes} {...rest} {...busy}>
      {loading && <Spinner />}
      {children}
    </Tag>
  );
};

/* A square button that is only an icon. `label` is required: it is the
   accessible name and the hover title, since there is no visible text. */
export const IconButton = ({ label, className = '', children, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-500 transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-50 ${className}`}
    {...rest}
  >
    {children}
  </button>
);

/* ── Layout ─────────────────────────────────────────────────────────────── */

export const Container = ({ className = '', children }) => (
  <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>
);

export const Eyebrow = ({ children, className = '' }) => (
  <p className={`text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 ${className}`}>{children}</p>
);

/* Section headings are left-aligned by default: business readers scan down
   the left edge. `center` is for the odd section that stands alone.
   Vertical rhythm: 80px a side on desktop (160px between two sections) —
   enough to separate ideas without the page reading as mostly empty. */
export const Section = ({ id, eyebrow, title, lead, className = '', center = false, children }) => (
  <section id={id} className={`scroll-mt-16 py-14 sm:py-20 ${className}`}>
    <Container>
      {(eyebrow || title || lead) && (
        <Reveal className={`mb-10 max-w-2xl sm:mb-12 ${center ? 'mx-auto text-center' : ''}`}>
          {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
          {title && (
            <h2 className="text-h2 font-semibold text-ink-900">{title}</h2>
          )}
          {lead && <p className="mt-4 text-lead text-ink-500">{lead}</p>}
        </Reveal>
      )}
      {children}
    </Container>
  </section>
);

/*
 * `...rest` matters here more than on most components: every scroll-reveal
 * animation in the marketing site finds its targets via a data-attribute
 * (data-card, data-copy, data-price-card...) passed straight to a <Card>. A
 * Card that dropped unknown props would make every one of those selectors
 * silently match nothing — no error, no console warning, just an animation
 * that never plays.
 */
export const Card = ({ className = '', children, ...rest }) => (
  <div className={`rounded-(--radius-card) border border-line bg-surface p-6 ${className}`} {...rest}>{children}</div>
);

/* ── Stat card ───────────────────────────────────────────────────────────
   The number tiles at the top of most screens. Before this, thirteen screens
   each had their own copy, with six different value sizes and three label
   styles, so the same "Sales" figure looked different on every page.

   size="md" is for dense pages (reports, lists); size="lg" is for screens
   read at a glance from across a counter (dashboard, orders, tables,
   kitchen). `children` sits between the value and the note (a change line,
   a delta). Given `onClick` it is a filter toggle (`pressed`); given `to`,
   a link. Content is always top-aligned: a <button> centres its content
   vertically by default, which is what made tiles in one row misalign. */
const STAT_TONES = { danger: 'text-danger', warning: 'text-warning', success: 'text-success', brand: 'text-brand-600' };
const STAT_VALUE = {
  md: 'mt-1 text-title font-semibold',
  lg: 'mt-2 text-xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[26px] sm:leading-none'
};

export const StatCard = ({
  label, value, note, sub, tone, size = 'md', onClick, pressed, active, to, className = '', children
}) => {
  const isPressed = pressed ?? active;
  const toneClass = !tone ? 'text-ink-900' : STAT_TONES[tone] || tone;
  const interactive = Boolean(onClick || to);
  const classes =
    `flex h-full min-w-0 flex-col items-stretch justify-start rounded-(--radius-card) border bg-surface text-left ` +
    `${size === 'lg' ? 'p-4 sm:p-5' : 'p-4'} ` +
    `${isPressed ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'} ` +
    `${interactive ? 'transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-line-strong hover:shadow-sm' : ''} ${className}`;
  const body = (
    <>
      <span className="block text-caption font-medium text-ink-500">{label}</span>
      <span className={`tabular block ${STAT_VALUE[size] || STAT_VALUE.md} ${toneClass}`}>{value}</span>
      {children}
      {(note ?? sub) != null && (note ?? sub) !== '' && (
        <span className={`block ${size === 'lg' ? 'mt-2' : 'mt-1'} text-caption text-ink-500`}>{note ?? sub}</span>
      )}
    </>
  );
  if (to) return <Link to={to} className={classes}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={isPressed ?? undefined} className={classes}>{body}</button>;
  return <div className={classes}>{body}</div>;
};

/* ── Form field ──────────────────────────────────────────────────────────
   The label is always rendered and always tied to the input by id. Placeholder
   text is not a label: it disappears the moment someone types, and screen
   readers do not reliably announce it. */
export const Field = ({ id, label, hint, error, children }) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium text-ink-700">{label}</label>
    {children}
    {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
  </div>
);

/*
 * Both Input and Select hardcode w-full. A className of "max-w-xs" or
 * "min-w-40" composes fine (different CSS property, no conflict), but a
 * plain "w-24" does not reliably win — a same-property utility clash is
 * decided by Tailwind's stylesheet order, not by where the class sits in the
 * className string. To size one narrowly, wrap it: `<div className="w-24">
 * <Input .../></div>` — the wrapper's width, not a losing class-order fight,
 * is what the input's w-full then fills.
 */
const CONTROL =
  'w-full rounded-(--radius-control) border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink-900 ' +
  'transition-[border-color,box-shadow] duration-(--duration-fast) placeholder:text-ink-400 ' +
  'hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-500 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';

export const Input = ({ className = '', ...rest }) => (
  <input className={`${CONTROL} ${className}`} {...rest} />
);

export const Select = ({ className = '', children, ...rest }) => (
  <select className={`${CONTROL} ${className}`} {...rest}>
    {children}
  </select>
);

/* An error the user needs to read, not a toast that vanishes before they do.
   role="alert" so it is announced rather than only shown. */
export const Alert = ({ children }) => children ? (
  <div
    role="alert"
    className="rounded-(--radius-control) border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-sm text-danger"
  >
    {children}
  </div>
) : null;

/* ── Tooltip ────────────────────────────────────────────────────────────
   Pure CSS (a `group`-hover pair), no positioning library and no JS state —
   the one thing this needs (show above the trigger on hover/focus) doesn't
   need more than that. Reach for something heavier only once a real case
   needs edge-flipping (a tooltip near the top of the viewport). */
export const Tooltip = ({ label, children }) => (
  <span className="group relative inline-flex">
    {children}
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {label}
    </span>
  </span>
);

export const Textarea = ({ className = '', ...rest }) => (
  <textarea className={`${CONTROL} ${className}`} {...rest} />
);

/* ── Badge ──────────────────────────────────────────────────────────────── */
const BADGE_TONES = {
  neutral: 'bg-surface-3 text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger'
};

/* transition-colors so a status moving PENDING → PREPARING → READY (or a
   table going occupied → free) fades to its new tone instead of snapping —
   the one change this element needs to read as "live", everywhere it's used. */
export const Badge = ({ tone = 'neutral', children }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors duration-(--duration-normal) ${BADGE_TONES[tone]}`}>
    {children}
  </span>
);

/* Status strings the API returns, mapped to a tone once so a "PARTIAL"
   invoice looks the same shade of amber everywhere it appears. */
const STATUS_TONES = {
  PAID: 'success', ACTIVE: 'success', ISSUED: 'brand', RECEIVED: 'brand',
  PARTIAL: 'warning', UNPAID: 'danger', CANCELLED: 'neutral', ARCHIVED: 'neutral'
};
/* Words people read, not database codes. Unknown codes are shown tidied up. */
const STATUS_LABELS = { PAID: 'Paid', PARTIAL: 'Part paid', UNPAID: 'Unpaid', ISSUED: 'Issued', CANCELLED: 'Cancelled', ACTIVE: 'Active', ARCHIVED: 'Archived', RECEIVED: 'Received' };
const KEEP_CAPS = new Set(['upi', 'gst', 'gstin', 'hsn', 'kot', 'qr', 'sms', 'pos', 'ai']);
export const humanize = (code) => String(code ?? '').toLowerCase().replace(/_/g, ' ')
  .split(' ').map((w) => (KEEP_CAPS.has(w) ? w.toUpperCase() : w)).join(' ')
  .replace(/^./, (c) => c.toUpperCase());
const statusLabel = (status) => STATUS_LABELS[status] || humanize(status);
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONES[status] || 'neutral'}>{statusLabel(status)}</Badge>;

/* ── Avatar ─────────────────────────────────────────────────────────────── */
const AVATAR_COLORS = ['bg-brand-500', 'bg-cyan-500', 'bg-violet-500', 'bg-teal-500', 'bg-amber-500'];

const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
};

// A hash of the name, not a random pick — the same person needs the same
// colour every time this renders, without storing one anywhere.
const colorIndexOf = (name) => {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) % AVATAR_COLORS.length;
  return Math.abs(hash) % AVATAR_COLORS.length;
};

/* `size`, not a className override — a consumer passing "h-7 w-7" to shrink
   this would collide with the base "h-8 w-8" on the same element, and which
   one wins is decided by Tailwind's stylesheet order, not by string
   position (see Input's own comment on this exact class of bug). A prop
   with a fixed set of values sidesteps it entirely. */
const AVATAR_SIZES = { sm: 'h-7 w-7 text-[11px]', md: 'h-8 w-8 text-xs' };

export const Avatar = ({ name, size = 'md', className = '' }) => (
  <span
    className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${AVATAR_SIZES[size]} ${AVATAR_COLORS[colorIndexOf(name)]} ${className}`}
  >
    {initialsOf(name)}
  </span>
);

/* ── Animated number ────────────────────────────────────────────────────
   Counts between values instead of jumping — a bill total growing as an
   item is added, a KPI settling to a fresher figure, stock ticking down a
   unit. The first render for a given mount shows its value immediately (a
   page should never count up from zero on load); only a later change to
   the same mounted element tweens. prefers-reduced-motion skips the tween
   outright, same as everything else in index.css. */
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const AnimatedNumber = ({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 400, className = '' }) => {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const mountedRef = useRef(false);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (!mountedRef.current) { mountedRef.current = true; setShown(value); return undefined; }
    if (!Number.isFinite(from) || !Number.isFinite(value) || from === value || reducedMotion()) { setShown(value); return undefined; }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out: fast start, settles gently
      setShown(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className={`tabular ${className}`}>{format(shown)}</span>;
};

/* ── Table ──────────────────────────────────────────────────────────────── */
/* A wide table must scroll inside its own box, never the page — the one rule
   that keeps a ten-column invoice list from breaking mobile layout. */
export const Table = ({ children }) => (
  <div className="relative overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
    <table className="w-full min-w-max text-sm">{children}</table>
  </div>
);
export const Thead = ({ children }) => (
  <thead className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
    <tr>{children}</tr>
  </thead>
);
export const Th = ({ className = '', children }) => <th className={`px-4 py-3 font-semibold ${className}`}>{children}</th>;
export const Td = ({ className = '', children, ...rest }) => <td className={`px-4 py-3 text-ink-900 ${className}`} {...rest}>{children}</td>;
export const Tr = ({ onClick, className = '', children }) => (
  <tr
    onClick={onClick}
    className={`border-b border-line transition-colors duration-(--duration-fast) last:border-0 ${onClick ? 'cursor-pointer hover:bg-surface-2' : ''} ${className}`}
  >
    {children}
  </tr>
);

/*
 * A convenience wrapper over Table/Thead/Th/Td/Tr, for the common case of
 * "a list of rows with an optional search box" — every list page in this
 * app (Products, Customers, Orders...) currently hand-rolls that search
 * logic itself around the same primitives below. This is a new option for
 * the *next* page built or refactored; it does not replace any existing
 * page's own table in this pass.
 *
 * `columns[].render` is for DISPLAY (can return JSX); search matches
 * against the row's raw field value (or `searchValue(row)` if a column
 * needs something the raw key doesn't capture), never against `render`'s
 * output — a rendered <Badge> stringifies to nothing useful to search on.
 */
export const DataTable = ({
  columns, rows, keyField, searchPlaceholder, onRowClick,
  loading, error, emptyLabel = 'Nothing here yet.'
}) => {
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const filtered = !term ? rows : rows.filter((row) =>
    columns.some((col) => {
      const value = col.searchValue ? col.searchValue(row) : row[col.key];
      return typeof value === 'object' ? false : String(value ?? '').toLowerCase().includes(term);
    })
  );

  const empty = !loading && !error && filtered.length === 0;

  return (
    <div>
      {searchPlaceholder && (
        <div className="mb-4 max-w-xs">
          <Input type="search" aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <ListState
        loading={loading}
        error={error}
        empty={empty}
        emptyLabel={term && rows?.length ? `Nothing matches “${search.trim()}”.` : emptyLabel}
        skeleton={<SkeletonRows rows={5} columns={columns.length} />}
      />

      {!loading && !error && filtered.length > 0 && (
        <Table>
          <Thead>
            {columns.map((col) => (
              <Th key={col.key} className={col.align === 'right' ? 'text-right' : ''}>{col.label}</Th>
            ))}
          </Thead>
          <tbody>
            {filtered.map((row) => (
              <Tr key={row[keyField]} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((col) => (
                  <Td key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                    {col.render ? col.render(row) : row[col.key]}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

/* ── Skeleton ───────────────────────────────────────────────────────────
   A shimmer, not a spinner: a spinner tells you something is happening
   somewhere; a skeleton shaped like the table that's about to appear tells
   you what and roughly how much — which is what "loading" actually needs to
   communicate on a list screen. */
export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} />
);

export const SkeletonRows = ({ rows = 5, columns = 4 }) => (
  <div className="overflow-hidden rounded-(--radius-card) border border-line bg-surface">
    <div className="border-b border-line bg-surface-2 px-4 py-3">
      <Skeleton className="h-3 w-24" />
    </div>
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-6 px-4 py-3.5">
          {Array.from({ length: columns }).map((_, col) => (
            <Skeleton key={col} className={`h-3.5 ${col === 0 ? 'w-32' : 'w-16'}`} />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const SkeletonCards = ({ count = 4 }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-3 rounded-(--radius-card) border border-line bg-surface p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>
    ))}
  </div>
);

/*
 * "Nothing here" said properly: what is empty, why that is fine, and the one
 * thing to do next. `compact` is for a panel inside a page (a side list, a
 * card) rather than a whole screen.
 */
export const EmptyState = ({ icon: Icon = Inbox, title, body, action, compact = false, className = '' }) => (
  <div className={`flex flex-col items-center text-center ${compact ? 'px-4 py-8' : 'rounded-(--radius-card) border border-dashed border-line-strong bg-surface px-6 py-12'} ${className}`}>
    <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-400">
      <Icon className="h-5 w-5" />
    </span>
    {title && <p className="mt-3 text-sm font-semibold text-ink-900">{title}</p>}
    {body && <p className={`${title ? 'mt-1' : 'mt-3'} max-w-sm text-sm text-ink-500`}>{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/* The one loading line used where no shape-matched skeleton fits: route
   fallbacks, a panel still fetching. */
export const PageLoader = ({ label = 'Loading…', className = '' }) => (
  <div role="status" className={`flex items-center justify-center gap-2 py-16 text-sm text-ink-500 ${className}`}>
    <Spinner />
    {label}
  </div>
);

/* Every list screen's three possible states, in one place so "no results"
   never quietly renders as an empty table with just a header row. Pass
   `skeleton` (a <SkeletonRows/> or <SkeletonCards/>) to show a shape-matched
   placeholder while loading instead of the plain-text fallback. `emptyBody`
   and `emptyAction` turn the empty line into a full EmptyState. */
export const ListState = ({ loading, error, empty, emptyLabel = 'Nothing here yet.', emptyBody, emptyAction, emptyIcon, skeleton }) => {
  if (loading) return skeleton ?? <PageLoader />;
  if (error) return <Alert>{error}</Alert>;
  /* Most call sites pass one sentence; that reads as the body, not a bold title. */
  if (empty) return <EmptyState icon={emptyIcon} title={emptyBody ? emptyLabel : undefined} body={emptyBody ?? emptyLabel} action={emptyAction} />;
  return null;
};

/* ── Modal ──────────────────────────────────────────────────────────────── */
/* Every add/edit form in the app renders inside this rather than as its own
   page — a product, a customer, an expense are all "one form, then back to
   the list", and a route per form would mean the list refetches on navigate
   back instead of just updating in place. */
/*
 * Accessibility the browser does not give a <div> for free: focus moves into
 * the dialog when it opens (to an autoFocus field if there is one), Tab stays
 * inside it, Escape closes only the top-most dialog (a confirm opened from a
 * form must not close the form too), the page behind stops scrolling, and
 * focus goes back to whatever opened it on close.
 */
const modalStack = [];
let scrollLocks = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal = ({ title, onClose, children, wide = false, footer }) => {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  /* Read during the first render, not in the effect: by the time effects run,
     an autoFocus field inside the dialog has already taken focus. */
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null));

  useEffect(() => {
    const me = {};
    modalStack.push(me);

    if (scrollLocks++ === 0) document.body.style.overflow = 'hidden';

    const el = panel.current;
    if (el && !el.contains(document.activeElement)) {
      const field = el.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (field || el).focus({ preventScroll: true });
    }

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== me) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
      if (--scrollLocks === 0) document.body.style.overflow = '';
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 pt-10 sm:pt-16">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-panel w-full rounded-(--radius-panel) border border-line bg-surface shadow-lg focus:outline-none ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-title font-semibold text-ink-900">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2"><X className="h-4 w-4" /></IconButton>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4 rounded-b-(--radius-panel)">{footer}</div>}
      </div>
    </div>
  );
};

/*
 * In-app replacements for window.confirm and window.prompt: styled like the
 * rest of FlowXP, readable on a phone, and they name the action on the
 * button ("Cancel order") instead of a bare OK. Both return a promise, so a
 * call site reads the same as before with an `await` in front:
 *
 *   const { confirm } = useDialog();
 *   if (!(await confirm({ title: 'Archive Tea?', body: '…', confirmLabel: 'Archive', danger: true }))) return;
 */
const DialogContext = createContext(null);

const PromptBody = ({ request, onDone }) => {
  const [value, setValue] = useState(request.defaultValue ?? '');
  const id = useId();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (value.trim() || !request.required) onDone(value.trim()); }}>
      {request.body && <p className="mb-4 text-sm text-ink-500">{request.body}</p>}
      <Field id={id} label={request.label || 'Your answer'}>
        {request.multiline
          ? <Textarea id={id} rows={3} value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={request.placeholder} />
          : <Input id={id} type={request.type || 'text'} value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={request.placeholder}
                   inputMode={request.inputMode} autoComplete={request.autoComplete || 'off'} />}
      </Field>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone(null)}>{request.cancelLabel || 'Cancel'}</Button>
        <Button type="submit" variant={request.danger ? 'danger' : 'primary'} disabled={request.required !== false && !value.trim()}>{request.confirmLabel || 'OK'}</Button>
      </div>
    </form>
  );
};

export const DialogProvider = ({ children }) => {
  const [request, setRequest] = useState(null);

  const open = useCallback((kind, options) => new Promise((resolve) => {
    const opts = typeof options === 'string' ? { title: options } : options;
    setRequest({ kind, ...opts, resolve });
  }), []);

  const done = (result) => {
    request?.resolve(result);
    setRequest(null);
  };

  const value = useMemo(() => ({
    confirm: (options) => open('confirm', options),
    prompt: (options) => open('prompt', options)
  }), [open]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {request && (
        <Modal title={request.title} onClose={() => done(request.kind === 'confirm' ? false : null)}>
          {request.kind === 'confirm' ? (
            <>
              {request.body && <p className="text-sm leading-relaxed text-ink-500">{request.body}</p>}
              <div className={`flex flex-wrap justify-end gap-2 ${request.body ? 'mt-6' : ''}`}>
                <Button variant="secondary" onClick={() => done(false)}>{request.cancelLabel || 'Keep it'}</Button>
                <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>{request.confirmLabel || 'Continue'}</Button>
              </div>
            </>
          ) : (
            <PromptBody request={request} onDone={done} />
          )}
        </Modal>
      )}
    </DialogContext.Provider>
  );
};

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used inside DialogProvider');
  return context;
};

/* A page's title row: heading + one primary action, the shape every list
   screen in /app opens with. */
export const PageHeader = ({ title, lead, action }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
      {lead && <p className="mt-1 max-w-2xl text-sm text-ink-500">{lead}</p>}
    </div>
    {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
  </div>
);

/* ── Toast ──────────────────────────────────────────────────────────────
   Ephemeral success/error feedback. Before this, a page that needed to
   confirm a save either left an <Alert> sitting on screen (fine for an
   error someone needs to read and act on, wrong for "saved" — see Alert's
   own comment) or hand-rolled its own inline text and a timer, differently
   each time (BusinessSettings.jsx, admin/AdminPlans.jsx both did). One
   provider, mounted once in main.jsx, replaces every one of those. */
const ToastContext = createContext(null);
const TOAST_TONE_TEXT = { success: 'text-success', danger: 'text-danger', brand: 'text-brand-600' };
const TOAST_TONE_DOT = { success: 'bg-success', danger: 'bg-danger', brand: 'bg-brand-500' };
let toastSeq = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((tone, message) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => remove(id), 4000);
  }, [remove]);

  const value = useMemo(() => ({
    success: (message) => push('success', message),
    error: (message) => push('danger', message),
    info: (message) => push('brand', message)
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => remove(t.id)}
            className={`toast pointer-events-auto flex max-w-sm cursor-pointer items-center gap-2.5 rounded-(--radius-control) border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-900 shadow-md`}
          >
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TOAST_TONE_DOT[t.tone]}`} />
            <span className={t.tone === 'danger' ? TOAST_TONE_TEXT.danger : ''}>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
};
