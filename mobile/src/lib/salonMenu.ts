/* The salon's service menu: how a service reads, what the form holds and checks, what is sent (only what changed on an edit). The server has the last word. */

export type MenuService = {
  service_id: number; name: string; category_id: number | null; category_name: string | null; price: number; tax_rate: number; duration_min: number;
  gender: string; description: string | null; status: string;
};
export type ServiceDraft = { name: string; price: string; minutes: string; gst: string; category_id: string; gender: string; description: string };

export const GST = ['0', '5', '12', '18'];
export const MINUTES = ['15', '30', '45', '60', '90', '120'];
export const WHO: { id: string; label: string }[] = [{ id: 'ANY', label: 'Anyone' }, { id: 'WOMEN', label: 'Women' }, { id: 'MEN', label: 'Men' }, { id: 'KIDS', label: 'Kids' }];

export const blank = (defaultGst = '18'): ServiceDraft => ({ name: '', price: '', minutes: '30', gst: defaultGst, category_id: '0', gender: 'ANY', description: '' });

export const fromService = (s: MenuService): ServiceDraft => ({
  name: s.name, price: String(s.price), minutes: String(s.duration_min), gst: String(s.tax_rate), category_id: s.category_id ? String(s.category_id) : '0', gender: s.gender || 'ANY', description: s.description ?? ''
});

export const serviceProblem = (d: ServiceDraft): string => {
  if (d.name.trim().length < 2) return 'Give the service a name';
  if (d.price.trim() === '' || !(Number(d.price) >= 0)) return 'Enter the price';
  const m = Number(d.minutes);
  if (!Number.isInteger(m) || m < 5 || m > 720) return 'Enter how long it takes, in minutes (5 to 720)';
  return '';
};

export const serviceBody = (d: ServiceDraft) => ({
  name: d.name.trim(), price: Number(d.price), duration_min: Number(d.minutes), tax_rate: Number(d.gst), category_id: d.category_id === '0' ? null : Number(d.category_id),
  gender: d.gender, description: d.description.trim() || null
});

export const changedBody = (before: ServiceDraft, after: ServiceDraft): Record<string, unknown> => {
  const was = serviceBody(before) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(serviceBody(after)).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k])));
};

/** "45 min" or "1 h 30 min". */
export const durationText = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export const rowText = (s: Pick<MenuService, 'duration_min' | 'gender' | 'status'>): string =>
  [durationText(s.duration_min), s.gender && s.gender !== 'ANY' ? WHO.find((w) => w.id === s.gender)?.label : null, s.status === 'ARCHIVED' ? 'removed' : null].filter(Boolean).join(' · ');

/** The menu grouped by category, categories by name, "Other" last, services by name. */
export const grouped = <T extends Pick<MenuService, 'name' | 'category_name'>>(rows: T[]): { category: string; rows: T[] }[] => {
  const map = new Map<string, T[]>();
  for (const r of rows) { const k = r.category_name || 'Other'; map.set(k, [...(map.get(k) ?? []), r]); }
  return [...map.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b))).map(([category, list]) => ({ category, rows: [...list].sort((x, y) => x.name.localeCompare(y.name)) }));
};
