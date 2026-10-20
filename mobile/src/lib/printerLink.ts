/*
 * The calls that reach a printer: Bluetooth (classic serial, which is what almost every receipt printer sold in India uses) and a plain network
 * connection to the printer's port (usually 9100). These need native code, so they work in the FlowXP development app and the store app, not in the
 * Expo Go test copy; each is loaded only when used, so nothing else in FlowXP depends on them. The rules around them (which printer, what is
 * checked) are in printerSetup.ts and are tested; these two connections can only be proven against a real printer.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { kvGet, kvSet } from './local.ts';
import { escposBytes, toBase64, type EscposOptions } from './escpos.ts';
import { chunks, cleanPrinters, colsFor, linkProblem, printerFor, type SavedPrinter } from './printerSetup.ts';

export const readPrinters = async (): Promise<SavedPrinter[]> => { try { return cleanPrinters(JSON.parse((await kvGet('printers_list')) || '[]')); } catch { return []; } };
export const savePrinters = async (list: SavedPrinter[]): Promise<void> => { await kvSet('printers_list', JSON.stringify(list)).catch(() => {}); };

export type Found = { name: string; address: string };

/** Ask for the Bluetooth permissions Android 12 and later need (older Android needs none at run time for paired printers). */
const allowBluetooth = async (): Promise<void> => {
  if (Platform.OS !== 'android') throw new Error('Bluetooth printing is for Android phones.');
  if (Number(Platform.Version) < 31) return;
  const got = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]);
  if (Object.values(got).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) throw new Error('Bluetooth permission was not given.');
};

/** Whether this copy of the app carries the printer code (the development or store app does; Expo Go does not). */
export const printingAvailable = async (): Promise<boolean> => {
  try { const m = (await import('react-native-bluetooth-classic')).default; return typeof m?.getBondedDevices === 'function'; } catch { return false; }
};

const bt = async () => {
  await allowBluetooth();
  const RN = (await import('react-native-bluetooth-classic')).default;
  if (!(await RN.isBluetoothEnabled())) { if (!(await RN.requestBluetoothEnabled())) throw new Error('Bluetooth is not enabled.'); }
  return RN;
};

/** The printers already paired in the phone's Bluetooth settings. */
export const pairedPrinters = async (): Promise<Found[]> => {
  try { return (await (await bt()).getBondedDevices()).map((d) => ({ name: d.name || d.address, address: d.address })); } catch (e) { throw new Error(linkProblem('bluetooth', e)); }
};
/** Look for devices nearby (about 12 seconds). A printer must be switched on; to use it, pair it in the phone's Bluetooth settings. */
export const scanPrinters = async (): Promise<Found[]> => {
  try {
    const RN = await bt();
    try { return (await RN.startDiscovery()).map((d) => ({ name: d.name || d.address, address: d.address })); } finally { await RN.cancelDiscovery().catch(() => {}); }
  } catch (e) { throw new Error(linkProblem('bluetooth', e)); }
};

const sendBluetooth = async (address: string, bytes: Uint8Array): Promise<void> => {
  const RN = await bt();
  const device = (await RN.isDeviceConnected(address).catch(() => false)) ? await RN.getConnectedDevice(address) : await RN.connectToDevice(address, { delimiter: '', charset: 'binary' } as never);
  try { for (const part of chunks(bytes)) await device.write(toBase64(part), 'base64'); await new Promise((r) => setTimeout(r, 400)); }
  finally { await device.disconnect().catch(() => {}); }
};

const sendNetwork = async (host: string, port: number, bytes: Uint8Array): Promise<void> => {
  const TcpSocket = (await import('react-native-tcp-socket')).default;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => { if (done) return; done = true; try { socket.destroy(); } catch { /* already closed */ } if (error) reject(error); else resolve(); };
    const socket = TcpSocket.createConnection({ host, port, timeout: 5000 } as never, () => {
      socket.write(bytes as never, undefined, (e?: Error | null) => { if (e) finish(e); else setTimeout(() => finish(), 300); });
    });
    socket.on('error', (e: Error) => finish(e));
    socket.on('timeout', () => finish(new Error('timeout')));
  });
};

/** Send bytes to a saved printer. Throws a sentence a person can act on. */
export const sendToPrinter = async (printer: SavedPrinter, bytes: Uint8Array): Promise<void> => {
  try { if (printer.kind === 'bluetooth') await sendBluetooth(printer.address, bytes); else await sendNetwork(printer.address, printer.port, bytes); }
  catch (e) { throw new Error(linkProblem(printer.kind, e)); }
};

/** The customer's receipt, straight to the printer set for receipts. */
export const printReceiptDirect = async (text: string, options: EscposOptions = {}): Promise<void> => {
  const printer = printerFor(await readPrinters(), 'receipt');
  if (!printer) throw new Error('No printer is set for receipts.');
  await sendToPrinter(printer, escposBytes(text, printer.paper, options));
};

/** The kitchen's slips for one sent order (the server makes them, one per station), to the kitchen printer. Returns false when no printer is set for the kitchen. */
export const printKitchenDirect = async (api: { get: <T>(path: string) => Promise<T> }, kotId: number): Promise<boolean> => {
  const printer = printerFor(await readPrinters(), 'kot');
  if (!printer) return false;
  const { slips } = await api.get<{ slips: { data: string }[] }>(`/kitchen/kots/${kotId}/escpos?cols=${colsFor(printer.paper)}`);
  for (const slip of slips) await sendToPrinter(printer, Uint8Array.from(atob(slip.data), (c) => c.charCodeAt(0)));
  return slips.length > 0;
};
