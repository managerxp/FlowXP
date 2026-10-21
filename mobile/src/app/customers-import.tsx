import { useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Msg, Panel, SetupShell, useAct } from '../lib/formKit.tsx';
import { canImport, checkLine, errorLines, importFileProblem, parseCsv, type CustomerCheck } from '../lib/workshopExtras.ts';
import { Button, Line, Soft, color } from '../lib/ui.tsx';

/* Customers from a file (Tally, Vyapar, Busy or Excel saved as CSV): checked first, imported only when every row is good. People already here are skipped. */
export default function CustomersImportScreen() {
  const me = currentBusiness(useSession());
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [check, setCheck] = useState<CustomerCheck | null>(null);
  const a = useAct();

  const choose = async () => {
    a.setError('');
    const out = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', 'application/octet-stream'], copyToCacheDirectory: true });
    if (out.canceled || !out.assets?.length) return;
    const f = out.assets[0];
    const problem = importFileProblem(f.name, f.size ?? null);
    if (problem) { a.setError(t(problem)); return; }
    const rows = parseCsv(await (await fetch(f.uri)).text());
    if (!rows.length) { a.setError(t('That file has no rows. The first line must be the column names.')); return; }
    setFile({ name: f.name, rows }); setCheck(null);
  };
  const send = async (apply: boolean) => { if (file) setCheck(await api.post<CustomerCheck>('/customers/import', { rows: file.rows, apply })); };

  return (
    <SetupShell title="Import customers" sub="A CSV file of customers: names, phones, credit limits" ok={allowed(me, 'customers')} denied="You do not have access to customers.">
      <Panel>
        <Soft>{t('Bring your customers from Tally, Vyapar, Busy or Excel. Save the file as CSV first. People already here (same phone, or same name when there is no phone) are skipped. What a customer owes is worked out from their unpaid bills, so it is not imported.')}</Soft>
        <Button title="Choose the customer file" kind="quiet" onPress={() => { void choose(); }} />
        {file ? <Line left={file.name} sub={t('{n} rows', { n: file.rows.length })} /> : null}
        <Msg a={a} />
        {file ? <Button title="Check the file" busy={a.busy} onPress={() => { void a.run('', () => send(false), ''); }} /> : null}
        {check ? (
          <Card>
            <Text style={{ color: check.total_errors ? color.danger : color.ink, fontWeight: '600' }}>{checkLine(check)}</Text>
            {errorLines(check).map((l) => <Soft key={l}>{l}</Soft>)}
          </Card>
        ) : null}
        {canImport(check) ? <Button title="Import the customers" busy={a.busy} onPress={() => { void a.run('', () => send(true), ''); }} /> : null}
      </Panel>
    </SetupShell>
  );
}
