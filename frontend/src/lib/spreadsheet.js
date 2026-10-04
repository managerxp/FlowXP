/*
 * Read a CSV or Excel (.xlsx) file into rows of { header: value }, the shape every import endpoint takes.
 * The Excel reader is loaded only when an .xlsx is chosen. Dates in Excel cells become YYYY-MM-DD; numbers become text
 * (a barcode is an identifier, not a quantity), and empty rows are dropped, as for CSV.
 */
import { parseCsv } from './wholesale.js';

const cell = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};

export const isExcel = (file) => /\.xlsx$/i.test(file?.name || '');

export const readTable = async (file) => {
  if (!isExcel(file)) return parseCsv(await file.text());
  const { default: readExcel } = await import('read-excel-file/browser');
  const sheets = await readExcel(file);
  const grid = (sheets[0]?.data || []).map((row) => row.map(cell)).filter((row) => row.some((c) => c !== ''));
  const [head, ...body] = grid;
  if (!head) return [];
  return body.map((row) => Object.fromEntries(head.map((h, i) => [h, row[i] ?? ''])));
};
