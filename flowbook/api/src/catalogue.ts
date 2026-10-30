import type { Db } from './db.ts';
import { createItem } from './masters.ts';
import { setTracking } from './stock.ts';

/* A ready list of what building, electrical and plumbing businesses buy and use, so nobody types an item list. Each entry: name, unit (GST unit code), HSN/SAC, GST code.
   No prices: they differ by city and by day, so the owner enters the rate once on the first bill. The GST rates are the common ones; the owner's accountant confirms them
   for a particular product, and an item's rate can be changed at any time. */

type Row = [name: string, unit: string, hsn: string, tax: string];
export type CatalogueGroup = { group: string; service?: boolean; rows: Row[] };

export const CATALOGUE: CatalogueGroup[] = [
  { group: 'Cement, sand and concrete', rows: [
    ['Cement OPC 43 grade (50 kg bag)', 'BAG', '2523', 'GST18'], ['Cement OPC 53 grade (50 kg bag)', 'BAG', '2523', 'GST18'], ['Cement PPC (50 kg bag)', 'BAG', '2523', 'GST18'],
    ['River sand', 'TON', '2505', 'GST5'], ['M-sand (manufactured sand)', 'TON', '2505', 'GST5'], ['Aggregate 20 mm', 'TON', '2517', 'GST5'], ['Aggregate 10 mm', 'TON', '2517', 'GST5'],
    ['Ready-mix concrete M20', 'OTH', '3824', 'GST18'], ['Ready-mix concrete M25', 'OTH', '3824', 'GST18'], ['Fly ash', 'TON', '2621', 'GST5'], ['Lime', 'KGS', '2522', 'GST5']] },
  { group: 'Steel and metal', rows: [
    ['TMT bar 8 mm', 'KGS', '7214', 'GST18'], ['TMT bar 10 mm', 'KGS', '7214', 'GST18'], ['TMT bar 12 mm', 'KGS', '7214', 'GST18'], ['TMT bar 16 mm', 'KGS', '7214', 'GST18'],
    ['TMT bar 20 mm', 'KGS', '7214', 'GST18'], ['Binding wire', 'KGS', '7217', 'GST18'], ['MS angle', 'KGS', '7216', 'GST18'], ['MS channel', 'KGS', '7216', 'GST18'],
    ['MS flat', 'KGS', '7211', 'GST18'], ['MS plate', 'KGS', '7208', 'GST18'], ['MS square pipe', 'KGS', '7306', 'GST18'], ['GI sheet', 'KGS', '7210', 'GST18'], ['Welding rod', 'KGS', '8311', 'GST18'], ['Nails', 'KGS', '7317', 'GST18']] },
  { group: 'Bricks, blocks and masonry', rows: [
    ['Red clay brick', 'NOS', '6901', 'GST5'], ['Fly ash brick', 'NOS', '6815', 'GST5'], ['AAC block', 'NOS', '6810', 'GST5'], ['Concrete hollow block', 'NOS', '6810', 'GST5'],
    ['Paver block', 'SQF', '6810', 'GST18'], ['Kerb stone', 'NOS', '6810', 'GST18'], ['Granite slab', 'SQF', '6802', 'GST18'], ['Marble slab', 'SQF', '6802', 'GST18'], ['Kota stone', 'SQF', '6802', 'GST18']] },
  { group: 'Flooring, tiles and sanitary', rows: [
    ['Vitrified tile 600x600', 'SQF', '6907', 'GST18'], ['Ceramic wall tile', 'SQF', '6907', 'GST18'], ['Parking tile', 'SQF', '6907', 'GST18'], ['Tile adhesive', 'BAG', '3214', 'GST18'],
    ['Tile grout', 'KGS', '3214', 'GST18'], ['Wash basin', 'NOS', '6910', 'GST18'], ['Western toilet seat (EWC)', 'NOS', '6910', 'GST18'], ['Indian toilet pan', 'NOS', '6910', 'GST18'],
    ['Flush tank', 'NOS', '3922', 'GST18'], ['Kitchen sink', 'NOS', '7324', 'GST18']] },
  { group: 'Paint and finishing', rows: [
    ['Wall putty', 'KGS', '3214', 'GST18'], ['Primer', 'LTR', '3208', 'GST18'], ['Interior emulsion paint', 'LTR', '3209', 'GST18'], ['Exterior emulsion paint', 'LTR', '3209', 'GST18'],
    ['Enamel paint', 'LTR', '3208', 'GST18'], ['Distemper', 'KGS', '3210', 'GST18'], ['Waterproofing compound', 'LTR', '3824', 'GST18'], ['Thinner', 'LTR', '3814', 'GST18'], ['Sand paper', 'NOS', '6805', 'GST18']] },
  { group: 'Wood, doors and windows', rows: [
    ['Plywood 18 mm', 'NOS', '4412', 'GST18'], ['Plywood 12 mm', 'NOS', '4412', 'GST18'], ['Block board', 'NOS', '4412', 'GST18'], ['Teak wood', 'OTH', '4407', 'GST18'], ['Flush door', 'NOS', '4418', 'GST18'],
    ['Door frame', 'NOS', '4418', 'GST18'], ['Aluminium window', 'SQF', '7610', 'GST18'], ['UPVC window', 'SQF', '3925', 'GST18'], ['Glass 5 mm', 'SQF', '7005', 'GST18'], ['Door lock', 'NOS', '8301', 'GST18'], ['Hinges', 'PRS', '8302', 'GST18']] },
  { group: 'Electrical', rows: [
    ['Copper wire 1.5 sq mm', 'ROL', '8544', 'GST18'], ['Copper wire 2.5 sq mm', 'ROL', '8544', 'GST18'], ['Copper wire 4 sq mm', 'ROL', '8544', 'GST18'], ['Copper wire 6 sq mm', 'ROL', '8544', 'GST18'],
    ['Armoured cable', 'MTR', '8544', 'GST18'], ['Modular switch', 'NOS', '8536', 'GST18'], ['Socket 5A', 'NOS', '8536', 'GST18'], ['Socket 15A', 'NOS', '8536', 'GST18'],
    ['Switch plate', 'NOS', '8538', 'GST18'], ['MCB single pole', 'NOS', '8536', 'GST18'], ['MCB double pole', 'NOS', '8536', 'GST18'], ['RCCB', 'NOS', '8536', 'GST18'],
    ['Distribution board (DB)', 'NOS', '8537', 'GST18'], ['PVC conduit pipe', 'MTR', '3917', 'GST18'], ['Conduit bend and junction box', 'NOS', '3925', 'GST18'], ['LED bulb', 'NOS', '8539', 'GST12'],
    ['LED tube light', 'NOS', '9405', 'GST12'], ['LED panel light', 'NOS', '9405', 'GST12'], ['Ceiling fan', 'NOS', '8414', 'GST18'], ['Exhaust fan', 'NOS', '8414', 'GST18'],
    ['Earthing rod', 'NOS', '7326', 'GST18'], ['Insulation tape', 'ROL', '3919', 'GST18'], ['Cable tie', 'PCS', '3926', 'GST18'], ['Meter board', 'NOS', '8537', 'GST18']] },
  { group: 'Plumbing', rows: [
    ['CPVC pipe 15 mm', 'MTR', '3917', 'GST18'], ['CPVC pipe 20 mm', 'MTR', '3917', 'GST18'], ['PVC pipe 110 mm (drainage)', 'MTR', '3917', 'GST18'], ['PVC pipe 75 mm (drainage)', 'MTR', '3917', 'GST18'],
    ['GI pipe', 'MTR', '7306', 'GST18'], ['PVC fittings (elbow, tee)', 'NOS', '3917', 'GST18'], ['Ball valve', 'NOS', '8481', 'GST18'], ['Gate valve', 'NOS', '8481', 'GST18'],
    ['Tap (bib cock)', 'NOS', '8481', 'GST18'], ['Shower set', 'NOS', '8481', 'GST18'], ['Water tank 1000 L', 'NOS', '3925', 'GST18'], ['Water pump 1 HP', 'NOS', '8413', 'GST18'],
    ['Solvent cement', 'LTR', '3506', 'GST18'], ['Teflon tape', 'ROL', '3919', 'GST18']] },
  { group: 'Hardware and consumables', rows: [
    ['Bolt and nut', 'KGS', '7318', 'GST18'], ['Screws', 'BOX', '7318', 'GST18'], ['Wall plug', 'BOX', '3926', 'GST18'], ['Silicone sealant', 'NOS', '3214', 'GST18'], ['Fevicol / wood adhesive', 'KGS', '3506', 'GST18'],
    ['Hand gloves', 'PRS', '4015', 'GST18'], ['Safety helmet', 'NOS', '6506', 'GST18'], ['Safety shoes', 'PRS', '6401', 'GST18'], ['Tarpaulin', 'NOS', '6306', 'GST18'], ['Diesel', 'LTR', '2710', 'GST0'], ['Shuttering oil', 'LTR', '2710', 'GST18']] },
  { group: 'Labour and contractors', service: true, rows: [
    ['Mason (labour)', 'DAY', '9954', 'GST18'], ['Helper (labour)', 'DAY', '9954', 'GST18'], ['Carpenter (labour)', 'DAY', '9954', 'GST18'], ['Electrician (labour)', 'DAY', '9954', 'GST18'],
    ['Plumber (labour)', 'DAY', '9954', 'GST18'], ['Painter (labour)', 'DAY', '9954', 'GST18'], ['Bar bender (labour)', 'DAY', '9954', 'GST18'], ['Tile layer (labour)', 'DAY', '9954', 'GST18'],
    ['Civil contractor work', 'OTH', '9954', 'GST18'], ['Electrical contractor work', 'OTH', '9954', 'GST18'], ['Plumbing contractor work', 'OTH', '9954', 'GST18'],
    ['JCB / excavator hire', 'HRS', '9973', 'GST18'], ['Transport / truck hire', 'OTH', '9965', 'GST5'], ['Scaffolding hire', 'DAY', '9973', 'GST18']] },
];

const sku = (group: string, name: string) => `B-${group.slice(0, 3).toUpperCase()}-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;

/** The catalogue with each entry's code and whether this business already has it. */
export const catalogueFor = async (c: Db) => {
  const have = new Set((await c.query(`SELECT sku FROM items`)).rows.map((r) => r.sku as string));
  return CATALOGUE.map((g) => ({ group: g.group, service: !!g.service, items: g.rows.map(([name, unit, hsn, tax]) => ({ sku: sku(g.group, name), name, unit, hsn, tax, added: have.has(sku(g.group, name)) })) }));
};

/** Add the chosen entries (their codes) as items; ones already there are skipped. Goods are tracked in stock from the start. */
export const addFromCatalogue = async (c: Db, orgId: bigint, skus: string[] | 'all', actor: string): Promise<number> => {
  const have = new Set((await c.query(`SELECT sku FROM items`)).rows.map((r) => r.sku as string));
  const known = new Set((await c.query(`SELECT code FROM tax_rates`)).rows.map((r) => r.code as string));
  let added = 0;
  for (const g of CATALOGUE) {
    for (const [name, unit, hsn, tax] of g.rows) {
      const code = sku(g.group, name);
      if (have.has(code) || (skus !== 'all' && !skus.includes(code))) continue;
      const id = await createItem(c, orgId, { sku: code, name, kind: g.service ? 'SERVICE' : 'GOODS', hsnSac: hsn, unit, taxCode: known.has(tax) ? tax : undefined }, actor);
      if (!g.service) await setTracking(c, orgId, id, { trackStock: true }, actor);
      added += 1;
    }
  }
  return added;
};
