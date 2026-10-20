import { useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { t } from '../lib/i18n.ts';
import { Card, Msg, Panel, SetupShell, confirm, useAct } from '../lib/formKit.tsx';
import { canApply, canRestore, headline, pickProblem, problemLines, shownTables, sourceLine, tableLine, type RestoreReport } from '../lib/restore.ts';
import { Button, Line, SectionTitle, Soft, color } from '../lib/ui.tsx';

/* Restore from a backup: pick the ZIP, check what would be added, then restore what is missing. It only ever adds. */
export default function RestoreBackupScreen() {
  const me = currentBusiness(useSession());
  const [file, setFile] = useState<{ uri: string; name: string; size: number | null } | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const a = useAct();

  const choose = async () => {
    a.setError('');
    const out = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], copyToCacheDirectory: true });
    if (out.canceled || !out.assets?.length) return;
    const f = out.assets[0];
    const problem = pickProblem(f.name, f.size);
    if (problem) { a.setError(t(problem)); return; }
    setFile({ uri: f.uri, name: f.name, size: f.size ?? null }); setReport(null);
  };
  const send = async (apply: boolean) => {
    if (!file) return;
    const blob = await (await fetch(file.uri)).blob();
    const out = await api.call<RestoreReport>(`/businesses/current/restore${apply ? '?confirm=1' : ''}`, { method: 'POST', raw: { body: blob, type: 'application/zip' }, timeoutMs: 180000 });
    setReport(out.data);
  };

  return (
    <SetupShell title="Restore from a backup" sub="Put back what a backup has and this business does not" ok={canRestore(me?.role)} denied="Only the owner can restore from a backup.">
      <Panel>
        <Soft>{t('Choose the ZIP file you downloaded before. Restoring only adds what is missing. Nothing that is already in FlowXP is changed or removed, so it is safe to run twice.')}</Soft>
        <Button title="Choose the backup file" kind="quiet" onPress={() => { void choose(); }} />
        {file ? <Line left={file.name} sub={file.size != null ? `${Math.round(file.size / 1024)} KB` : undefined} /> : null}
        <Msg a={a} />
        {file ? <Button title="Check what would be added" busy={a.busy} onPress={() => { void a.run('', () => send(false), ''); }} /> : null}
        {report ? (
          <Card>
            {sourceLine(report) ? <Soft>{sourceLine(report)}</Soft> : null}
            <SectionTitle>{headline(report)}</SectionTitle>
            {!report.applied ? <Soft>{t('This is only a check. Nothing has been changed yet.')}</Soft> : null}
            {shownTables(report).map((x) => <Line key={x.file} left={x.label} sub={tableLine(x, report.applied)} />)}
            {problemLines(report).slice(0, 8).map((p, i) => <Text key={i} style={{ color: color.warn }}>{p}</Text>)}
            {report.applied ? <Soft>{t('Restored bills do not change the shelf. If goods were lost, count your stock.')}</Soft> : null}
            {canApply(report) ? <Button title="Restore what is missing" busy={a.busy} onPress={() => confirm(t('Make the restore?'), t('The records that are missing are added. Nothing else changes.'), 'Restore what is missing', () => { void a.run('', () => send(true), 'Restored'); })} /> : null}
          </Card>
        ) : null}
      </Panel>
    </SetupShell>
  );
}
