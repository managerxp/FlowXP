/*
 * Printers and routing. A business lists its printers once (Settings > Printers) and says which one prints what at each outlet: the receipt,
 * takeaway / parcel bills, the cash drawer, kitchen tickets, and a printer for each kitchen station. The server only decides WHERE a job goes
 * (the `target` it returns with the print bytes); the print agent on the till computer does the sending, as before.
 *
 * Connections: NETWORK (WiFi / LAN, tcp://host:port), USB and BLUETOOTH (a printer installed on the till computer: share://computer/Name on
 * Windows, lp://Name on Mac / Linux, file:///dev/usb/lp0), BROWSER (the normal print dialog). A Bluetooth printer is paired with the computer
 * first, so it is reached the same way as a USB one.
 */
export const CONNECTIONS = ['NETWORK', 'USB', 'BLUETOOTH', 'BROWSER'];
export const ROLES = ['receipt', 'takeaway', 'drawer', 'kot'];

const LOCAL = /^(share|lp|file):\/\/\S+$/i;

/** Check a printer; `partial` (an edit) only checks what was sent. Returns { printer } with only the known keys, or { error }. */
export const cleanPrinter = (input, { partial = false } = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The printer must be an object' };
  const out = {};
  if (!partial || 'name' in input) {
    const name = String(input.name ?? '').trim();
    if (!name) return { error: 'Give the printer a name, such as "Kitchen" or "Counter"' };
    if (name.length > 60) return { error: 'The printer name is too long (60 characters at most)' };
    out.name = name;
  }
  if (!partial || 'connection' in input) {
    if (!CONNECTIONS.includes(input.connection)) return { error: 'Choose how the printer is connected' };
    out.connection = input.connection;
  }
  if ('paper_width' in input || !partial) {
    const w = Number(input.paper_width ?? 80);
    if (![58, 80].includes(w)) return { error: 'Paper width must be 58 or 80 mm' };
    out.paper_width = w;
  }
  if ('is_active' in input) out.is_active = input.is_active === true;
  if (!partial || 'address' in input || 'connection' in input) {
    const connection = out.connection ?? input.connection;
    let address = String(input.address ?? '').trim();
    if (connection === 'BROWSER') address = '';
    else if (!address) return { error: connection === 'NETWORK' ? 'Enter the printer\'s address, such as 192.168.1.50' : 'Enter the printer name as your computer shows it' };
    else if (connection === 'NETWORK') {
      let url;
      try { url = new URL(/^tcp:\/\//i.test(address) ? address : `tcp://${address}`); } catch { return { error: 'That network address is not valid. Use something like 192.168.1.50 or 192.168.1.50:9100' }; }
      if (!url.hostname) return { error: 'That network address is not valid. Use something like 192.168.1.50 or 192.168.1.50:9100' };
      address = `tcp://${url.hostname}:${url.port || 9100}`;
    } else if (!LOCAL.test(address)) return { error: 'A USB or Bluetooth printer needs an address like share://localhost/PrinterName (Windows) or lp://PrinterName (Mac, Linux)' };
    if (address.length > 200) return { error: 'The printer address is too long' };
    out.address = address;
  }
  return { printer: out };
};

const id = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Check a routing object: printer ids only (the caller checks they exist). Unknown keys are dropped. */
export const cleanRouting = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The routing must be an object' };
  const out = { stations: {} };
  for (const role of ROLES) out[role] = id(input[role]);
  for (const [station, printer] of Object.entries(input.stations && typeof input.stations === 'object' ? input.stations : {})) {
    if (id(station) && id(printer)) out.stations[id(station)] = id(printer);
  }
  return { routing: out };
};

export const routedIds = (routing) => [...ROLES.map((r) => routing?.[r]), ...Object.values(routing?.stations || {})].filter(Boolean);

/**
 * The printer a slip should go to, or null when none is set (the caller then uses the device's own address, as before).
 * receipt: the receipt printer. takeaway: the takeaway printer, else the receipt one. drawer: the drawer printer, else the receipt one.
 * kot: the station's printer, else the kitchen default, else null.
 */
export const pickPrinter = (routing, printers, role, stationId = null) => {
  const r = routing || {};
  // the first choice, then the fallbacks; a choice whose printer was deleted or switched off is skipped
  const choices = role === 'kot' ? [r.stations?.[stationId], r.kot]
    : role === 'takeaway' ? [r.takeaway, r.receipt]
      : role === 'drawer' ? [r.drawer, r.receipt]
        : [r.receipt];
  for (const wanted of choices) {
    const found = wanted && printers.find((p) => p.printer_id === Number(wanted) && p.is_active);
    if (found) return found;
  }
  return null;
};

/** What a print job tells the browser: where to send it. BROWSER printers answer 'browser' (use the print dialog). */
export const targetOf = (printer) => (!printer ? null : printer.connection === 'BROWSER' ? 'browser' : printer.address);
