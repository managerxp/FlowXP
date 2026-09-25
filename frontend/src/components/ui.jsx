/*
 * The handful of primitives every screen uses.
 *
 * One file rather than components/Button/index.jsx and eleven siblings. These
 * are small enough that the folder structure would be larger than the code in
 * it; split them out when one of them grows its own state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

/* ── Logo ────────────────────────────────────────────────────────────────
   The uploaded mark (frontend/public/logo.png) already IS "FlowXP" — the F
   icon and the wordmark are one image, not two things to compose. Setting
   "FlowXP" as text next to it duplicated what the image already says, which
   is the redundancy this used to have. This renders the image alone, at its
   own aspect ratio (never squashed into a square), and falls back to a text
   wordmark only if the file is ever missing — via React state, not by
   reaching into the DOM from an onError handler. */
export const Logo = ({ className = '', showTagline = false }) => {
  const [broken, setBroken] = useState(false);
  // The tagline only ever appears somewhere the logo stands alone (the
  // footer, an auth screen) — those spots read better with a slightly
  // larger mark than the one sitting inline in a nav bar.
  const height = showTagline ? 'h-12' : 'h-9';

  return (
    <span className={`inline-flex flex-col ${className}`}>
      {broken ? (
        <span className="text-xl font-extrabold tracking-tight text-ink-900">
          Flow<span className="text-gradient">XP</span>
        </span>
      ) : (
        <img src="/logo.png" alt="FlowXP" className={`${height} w-auto object-contain`} onError={() => setBroken(true)} />
      )}
      {showTagline && (
        <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-400">
          The smart flow for every business
        </span>
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
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-glow',
  secondary:
    'bg-surface text-ink-900 border border-line-strong hover:bg-surface-2',
  ghost:
    'text-ink-700 hover:text-ink-900 hover:bg-surface-2'
};

const SIZES = {
  sm: 'px-3.5 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base'
};

export const Button = ({
  as, to, href, variant = 'primary', size = 'md', className = '', children, ...rest
}) => {
  const classes =
    `inline-flex items-center justify-center gap-2 rounded-full font-semibold ` +
    /* transform-gpu + will-change scope the scale to its own compositor
       layer, so the press feedback costs a transform, not a layout pass. */
    `transition-[color,background-color,border-color,box-shadow,transform] duration-150 ` +
    `will-change-transform hover:scale-[1.015] active:scale-[0.97] ` +
    `disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ` +
    `${VARIANTS[variant]} ${SIZES[size]} ${className}`;

  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>;
  if (href) return <a href={href} className={classes} {...rest}>{children}</a>;
  const Tag = as || 'button';
  return <Tag className={classes} {...rest}>{children}</Tag>;
};

/* ── Layout ─────────────────────────────────────────────────────────────── */

export const Container = ({ className = '', children }) => (
  <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>
);

export const Section = ({ id, eyebrow, title, lead, className = '', children }) => (
  <section id={id} className={`py-14 sm:py-20 ${className}`}>
    <Container>
      {(eyebrow || title || lead) && (
        <div className="mx-auto mb-10 max-w-2xl text-center">
          {eyebrow && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
              {eyebrow}
            </p>
          )}
          {title && (
            <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">{title}</h2>
          )}
          {lead && <p className="mt-4 text-base leading-relaxed text-ink-500">{lead}</p>}
        </div>
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
  <div className={`glass rounded-[--radius-card] p-6 ${className}`} {...rest}>{children}</div>
);

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
export const Input = ({ className = '', ...rest }) => (
  <input
    className={
      `w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm ` +
      `text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none ${className}`
    }
    {...rest}
  />
);

export const Select = ({ className = '', children, ...rest }) => (
  <select
    className={
      `w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm ` +
      `text-ink-900 focus:border-brand-500 focus:outline-none ${className}`
    }
    {...rest}
  >
    {children}
  </select>
);

/* An error the user needs to read, not a toast that vanishes before they do.
   role="alert" so it is announced rather than only shown. */
export const Alert = ({ children }) => children ? (
  <div
    role="alert"
    className="rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-sm text-danger"
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
  <textarea
    className={
      `w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm ` +
      `text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none ${className}`
    }
    {...rest}
  />
);

/* ── Badge ──────────────────────────────────────────────────────────────── */
const BADGE_TONES = {
  neutral: 'bg-surface-3 text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger'
};

export const Badge = ({ tone = 'neutral', children }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_TONES[tone]}`}>
    {children}
  </span>
);

/* Status strings the API returns, mapped to a tone once so a "PARTIAL"
   invoice looks the same shade of amber everywhere it appears. */
const STATUS_TONES = {
  PAID: 'success', ACTIVE: 'success', ISSUED: 'brand', RECEIVED: 'brand',
  PARTIAL: 'warning', UNPAID: 'danger', CANCELLED: 'neutral', ARCHIVED: 'neutral'
};
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONES[status] || 'neutral'}>{status}</Badge>;

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

/* ── Table ──────────────────────────────────────────────────────────────── */
/* A wide table must scroll inside its own box, never the page — the one rule
   that keeps a ten-column invoice list from breaking mobile layout. */
export const Table = ({ children }) => (
  <div className="overflow-x-auto rounded-[--radius-card] border border-line bg-surface">
    <table className="w-full min-w-max text-sm">{children}</table>
  </div>
);
export const Thead = ({ children }) => (
  <thead className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">
    <tr>{children}</tr>
  </thead>
);
export const Th = ({ className = '', children }) => <th className={`px-4 py-3 font-semibold ${className}`}>{children}</th>;
export const Td = ({ className = '', children }) => <td className={`px-4 py-3 text-ink-900 ${className}`}>{children}</td>;
export const Tr = ({ onClick, className = '', children }) => (
  <tr
    onClick={onClick}
    className={`border-b border-line last:border-0 ${onClick ? 'cursor-pointer hover:bg-surface-2' : ''} ${className}`}
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
          <Input placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <ListState
        loading={loading}
        error={error}
        empty={empty}
        emptyLabel={emptyLabel}
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
  <div className="overflow-hidden rounded-[--radius-card] border border-line bg-surface">
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
      <div key={i} className="glass space-y-3 rounded-[--radius-card] p-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>
    ))}
  </div>
);

/* Every list screen's three possible states, in one place so "no results"
   never quietly renders as an empty table with just a header row. Pass
   `skeleton` (a <SkeletonRows/> or <SkeletonCards/>) to show a shape-matched
   placeholder while loading instead of the plain-text fallback. */
export const ListState = ({ loading, error, empty, emptyLabel = 'Nothing here yet.', skeleton }) => {
  if (loading) return skeleton ?? <p className="px-1 py-8 text-center text-sm text-ink-400">Loading…</p>;
  if (error) return <Alert>{error}</Alert>;
  if (empty) return <p className="px-1 py-8 text-center text-sm text-ink-400">{emptyLabel}</p>;
  return null;
};

/* ── Modal ──────────────────────────────────────────────────────────────── */
/* Every add/edit form in the app renders inside this rather than as its own
   page — a product, a customer, an expense are all "one form, then back to
   the list", and a route per form would mean the list refetches on navigate
   back instead of just updating in place. */
export const Modal = ({ title, onClose, children, wide = false }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 pt-10 sm:pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`glass w-full rounded-[--radius-card] p-6 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-ink-400 hover:bg-surface-2 hover:text-ink-900"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

/* A page's title row: heading + one primary action, the shape every list
   screen in /app opens with. */
export const PageHeader = ({ title, lead, action }) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
      {lead && <p className="mt-1 text-sm text-ink-500">{lead}</p>}
    </div>
    {action}
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
            className={`glass pointer-events-auto max-w-sm cursor-pointer rounded-full px-4 py-2.5 text-sm font-medium shadow-md ${TOAST_TONE_TEXT[t.tone]}`}
          >
            {t.message}
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
