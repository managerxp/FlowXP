/*
 * Import a price list from a spreadsheet: name the list (a new name makes a new list; an existing name is updated),
 * optionally tie it to a territory, then choose the file. Checked row by row before anything is written.
 */
import { useState } from 'react';
import { DIST_IMPORTS } from '../../lib/distributor.js';
import { Field, Input, Select } from '../../components/ui.jsx';
import { CsvImportModal } from '../wholesale/parts.jsx';
import { TerritorySelect } from './parts.jsx';

const PriceListImport = ({ onClose, onDone }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('STANDARD');
  const [territory, setTerritory] = useState('');
  const [replace, setReplace] = useState(false);
  const extra = { list_name: name.trim(), kind, territory_id: territory === '' ? undefined : territory, replace };
  return (
    <CsvImportModal kind="price-list" title={DIST_IMPORTS['price-list'].title} endpoint="/distributor/import/price-list" template={DIST_IMPORTS['price-list']} allowUpdate={false} extra={extra} onClose={onClose} onDone={onDone}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pli-name" label="Price list name" hint="A new name creates the list"><Input id="pli-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field id="pli-kind" label="Kind"><Select id="pli-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="STANDARD">Standard</option><option value="PROMOTION">Promotion</option></Select></Field>
        <TerritorySelect id="pli-terr" value={territory} onChange={setTerritory} hint="Only used when the list is new" emptyLabel="Everywhere" />
        <label className="flex items-center gap-2 self-end pb-2 text-small text-ink-700"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />Replace everything already on the list</label>
      </div>
    </CsvImportModal>
  );
};
export default PriceListImport;
