import test from 'node:test';
import assert from 'node:assert/strict';
import { taxName, stateCode } from '../src/modules/gst/states.js';
import { isInterState, computeLineTax } from '../src/modules/tax.js';

test('union territories with no legislature charge UTGST, states and the other territories charge SGST', () => {
  for (const ut of ['Andaman and Nicobar Islands', 'Andaman & Nicobar Islands', 'andaman and nicobar islands', 'Chandigarh', 'Lakshadweep', 'Ladakh', 'Dadra and Nagar Haveli and Daman and Diu', '35']) assert.equal(taxName(ut), 'UTGST', ut);
  for (const st of ['Karnataka', 'Delhi', 'Puducherry', 'Jammu and Kashmir', 'Maharashtra', '', null, 'Nowhere']) assert.equal(taxName(st), 'SGST', String(st));
});

test('two spellings of the same place are not an inter-state sale', () => {
  assert.equal(isInterState('Andaman and Nicobar Islands', 'Andaman & Nicobar Islands'), false);
  assert.equal(isInterState('Andaman and Nicobar Islands', 'Tamil Nadu'), true);
  assert.equal(isInterState('Karnataka', 'karnataka '), false);
  assert.equal(isInterState('Atlantis', 'Atlantis'), false);
  assert.equal(stateCode('Andaman & Nicobar Islands'), '35');
});

test('a sale inside the Andaman and Nicobar Islands splits evenly into CGST and UTGST (kept in the SGST column), and to another state it is IGST', () => {
  const intra = computeLineTax({ quantity: 1, unitPricePaise: 300000, taxRatePercent: 5, gstEnabled: true, interState: isInterState('Andaman and Nicobar Islands', 'Andaman & Nicobar Islands') });
  assert.deepEqual([intra.cgst_paise, intra.sgst_paise, intra.igst_paise], [7500, 7500, 0]);
  const inter = computeLineTax({ quantity: 1, unitPricePaise: 300000, taxRatePercent: 5, gstEnabled: true, interState: isInterState('Andaman and Nicobar Islands', 'Tamil Nadu') });
  assert.deepEqual([inter.cgst_paise, inter.sgst_paise, inter.igst_paise], [0, 0, 15000]);
});

test('old GSTIN codes mean the same state as their successor, and a GSTIN fixes the buyer state', async () => {
  const { placeOfSupply } = await import('../src/modules/gst/states.js');
  assert.equal(isInterState('37', '28'), false);   // Andhra Pradesh, before and after the Telangana split
  assert.equal(isInterState('26', '25'), false);   // Daman and Diu merged into Dadra and Nagar Haveli
  assert.equal(isInterState('37', '36'), true);
  assert.equal(isInterState('Karnataka', placeOfSupply('27AAAAA0000A1Z5', 'Karnataka')), true);   // the GSTIN says Maharashtra
  assert.equal(isInterState('Karnataka', placeOfSupply(null, 'Karnataka')), false);
});
