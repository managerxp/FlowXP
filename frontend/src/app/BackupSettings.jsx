/*
 * Settings → Business → Backup: one click downloads a ZIP of CSV files with every record of the business (the owner's own copy; backend modules/backup.js), and the same
 * ZIP can be put back. Restore only ADDS what is missing (backend modules/restore.js): it is checked first, as a preview that changes nothing, and nothing already in
 * FlowXP is ever changed or removed.
 */
import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, downloadFile } from '../lib/api.js';
import { Alert, Button, Card } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const Report = ({ report }) => {
  const tr = useT();
  const rows = report.tables.filter((t) => t.found);
  return (
    <div className="space-y-3">
      {report.source?.name && <p className="text-small text-ink-700">{tr('From {{name}}, made on {{date}}.', { name: report.source.name, date: report.source.made_on || '—' })}</p>}
      {report.totals.added === 0 && report.totals.skipped === 0
        ? <p className="rounded-lg bg-surface-2 px-3 py-2 text-small text-ink-700">{tr('Nothing was missing: everything in the backup is already here.')}</p>
        : <p className="rounded-lg bg-brand-50 px-3 py-2 text-small font-medium text-brand-700">{report.applied ? tr('{{n}} records were added.', { n: report.totals.added }) : tr('{{n}} records would be added.', { n: report.totals.added })}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-small">
          <thead className="text-left text-caption font-semibold uppercase tracking-wide text-ink-500"><tr><th className="pb-2 pr-3">{tr('Records')}</th><th className="pb-2 pr-3 text-right">{report.applied ? tr('Added') : tr('Would be added')}</th><th className="pb-2 pr-3 text-right">{tr('Already here')}</th><th className="pb-2 text-right">{tr('Skipped')}</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => (
              <tr key={t.file}>
                <td className="py-1.5 pr-3">{t.label}</td>
                <td className="tabular py-1.5 pr-3 text-right">{t.added}</td><td className="tabular py-1.5 pr-3 text-right text-ink-500">{t.already_there}</td><td className={`tabular py-1.5 text-right ${t.skipped ? 'font-semibold text-warning' : 'text-ink-400'}`}>{t.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((t) => t.problems.length > 0) && (
        <ul className="list-disc space-y-0.5 pl-5 text-caption text-ink-500">
          {rows.flatMap((t) => t.problems.map((p, i) => <li key={`${t.file}${i}`}>{t.label}, row {p.row}: {p.why}</li>))}
        </ul>
      )}
      {report.applied && <p className="text-caption text-ink-500">{tr('Restored bills do not change the shelf. If goods were lost, count your stock.')}</p>}
    </div>
  );
};

const Restore = () => {
  const tr = useT();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (confirm) => {
    setBusy(true); setError('');
    try { setReport(await api(`/businesses/current/restore${confirm ? '?confirm=1' : ''}`, { method: 'POST', body: file })); }
    catch (caught) { setError(caught.message); setReport(null); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="text-base font-bold text-ink-900">{tr('Restore from a backup')}</h3>
      <p className="mt-1 text-sm text-ink-500">{tr('Choose the ZIP file you downloaded here before. Restoring only adds what is missing. Nothing that is already in FlowXP is changed or removed, so it is safe to run twice.')}</p>
      <div className="mt-4 space-y-3">
        <Alert>{error}</Alert>
        <input ref={input} type="file" accept=".zip,application/zip" aria-label={tr('Choose the backup file')} className="block w-full text-small"
               onChange={(e) => { setFile(e.target.files?.[0] || null); setReport(null); setError(''); }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(false)} disabled={!file || busy}><Upload aria-hidden="true" className="h-4 w-4" />{busy ? tr('Thinking…') : tr('Check what would be added')}</Button>
          {report && !report.applied && report.totals.added > 0 && <Button onClick={() => send(true)} disabled={busy}>{tr('Restore what is missing')}</Button>}
        </div>
        {report && !report.applied && <p className="text-caption text-ink-500">{tr('This is only a check. Nothing has been changed yet.')}</p>}
        {report && <Report report={report} />}
      </div>
    </div>
  );
};

export default function BackupSettings() {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { await downloadFile('/businesses/current/backup', `flowxp-backup-${new Date().toISOString().slice(0, 10)}.zip`); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Backup')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Download a copy of all your records (customers, products, bills, payments, expenses and stock) as a ZIP of CSV files. Keep it somewhere safe.')}</p>
      <div className="mt-4 space-y-3">
        <Alert>{error}</Alert>
        <Button variant="secondary" onClick={run} disabled={busy}><Download aria-hidden="true" className="h-4 w-4" />{busy ? tr('Thinking…') : tr('Download backup')}</Button>
      </div>
      <Restore />
    </Card>
  );
}
