/* What the second half of the GST split is called. A state charges SGST; the union territories with no legislature of their own (Chandigarh, Dadra and Nagar
   Haveli and Daman and Diu, Lakshadweep, the Andaman and Nicobar Islands and Ladakh) charge UTGST. The amount is stored and filed in the same place either way. */
const UT_NAMES = new Set(['chandigarh', 'dadra and nagar haveli and daman and diu', 'dadra and nagar haveli', 'daman and diu', 'lakshadweep', 'andaman and nicobar islands', 'andaman & nicobar islands', 'a&n islands', 'ladakh']);
export const stateTaxName = (state) => (UT_NAMES.has(String(state ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) ? 'UTGST' : 'SGST');
