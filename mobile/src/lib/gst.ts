/*
 * The GST options the owner switched on for this business (website: Settings > Business > GST options), as /auth/me hands them to the phone.
 * The phone only PREVIEWS a bill from them; the server works out the real one (backend modules/gstOptions.js and billing.js), so a stale
 * copy here can show a slightly different preview but never a wrong bill.
 */
export type GstOptions = { composite: boolean; composite_rate: number; cess: boolean; tcs: boolean; tcs_rate: number; tds: boolean; tds_rate: number; reverse_charge: boolean };

/** Every option off, the rates the server starts from (the website's GST options). */
export const GST_DEFAULTS_PHONE: GstOptions = { composite: false, composite_rate: 1, cess: false, tcs: false, tcs_rate: 1, tds: false, tds_rate: 2, reverse_charge: false };

/** What the till needs: whether tax is charged at all, and which of the options are on. */
export type GstView = { on: boolean; composite: boolean; cess: boolean; tcs: boolean; tcsRate: number; tds: boolean; tdsRate: number; reverseCharge: boolean };

/** What the cashier ticked on THIS bill. The server applies each only if the option is on. */
export type Levies = { tcs?: boolean; tds?: boolean; reverse_charge?: boolean };

type BusinessGst = { gst_enabled?: boolean; gst_options?: Partial<GstOptions> } | null | undefined;

/** A business whose copy has no word on GST (an older sign-in) is treated as before: tax charged, no options. */
export const gstView = (b: BusinessGst): GstView => {
  const o = b?.gst_options ?? {};
  const on = b?.gst_enabled !== false;
  return {
    on, composite: on && o.composite === true, cess: on && o.cess === true,
    tcs: on && o.tcs === true, tcsRate: Number(o.tcs_rate ?? 1), tds: on && o.tds === true, tdsRate: Number(o.tds_rate ?? 2), reverseCharge: on && o.reverse_charge === true
  };
};

/** The body fields for the ticks that count (only options that are on). */
export const leviesBody = (levies: Levies | undefined, gst: GstView | undefined) => ({
  ...(gst?.tcs && levies?.tcs ? { tcs: true } : {}),
  ...(gst?.tds && levies?.tds ? { tds: true } : {}),
  ...(gst?.reverseCharge && levies?.reverse_charge ? { reverse_charge: true } : {})
});
