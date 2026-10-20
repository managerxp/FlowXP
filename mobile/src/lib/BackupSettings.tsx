import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ErrorText, Soft, color } from './ui.tsx';
import { API_URL, sessionStore } from './session.ts';
import { backupRequest } from './backup.ts';
import { shareBackupZip } from './share.ts';
import { dayOf } from './till.ts';
import { t } from './i18n.ts';

/* Settings > Backup (owner only): a ZIP of CSV files with every record of the business, saved and sent from the phone's share sheet. */
export default function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { await shareBackupZip(backupRequest(API_URL, sessionStore.get(), dayOf(Date.now()))); }
    catch (e) { setError(e instanceof Error ? t(e.message) : t('Could not take the backup.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('Backup')}</Text>
      <Soft>{t('Download a copy of all your records (customers, products, bills, payments, expenses and stock) as a ZIP of CSV files, then save or send it from the share sheet. Keep it somewhere safe. FlowXP does not restore from it by itself: ask support if you ever need your data put back.')}</Soft>
      <Button title="Download backup" kind="quiet" onPress={() => { void run(); }} busy={busy} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
