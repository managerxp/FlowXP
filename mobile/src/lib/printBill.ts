import { api } from './session.ts';
import { printBillDirect } from './printerLink.ts';
import { t } from './i18n.ts';

/** Print the running bill of an open table or order on the receipt printer. Returns the sentence to show; throws a readable one when it cannot. */
export const printRunningBill = async (orderId: number): Promise<string> => {
  let sent = false;
  try { sent = await printBillDirect(api, orderId); }
  catch (e) { throw new Error(e instanceof Error ? t(e.message) : t('Could not print.')); }
  if (!sent) throw new Error(t('No printer is set up yet. Open More, then Settings, then Set up my printer.'));
  return t('Bill sent to the printer');
};
