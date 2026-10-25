import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { API_URL, api, currentBusiness, sessionStore, useSession } from '../lib/session.ts';
import { allowed, hasFeature } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { shareDownload } from '../lib/share.ts';
import { SPAN_LIMIT_DAYS, emailBody, emailProblem, packPeriods, packRequest, spanDays } from '../lib/accountantPack.ts';
import { formatDate } from '../lib/display.ts';
import { Button, Chips, Empty, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* The accountant pack: one ZIP of CSV files for a period, downloaded and shared from the phone, or e-mailed to the accountant by the server (needs the export permission). */
export default function AccountantPack() {
  const session = useSession();
  const business = currentBusiness(session);
  const may = allowed(business, 'export');
  const [fyMonth, setFyMonth] = useState(4);
  const periods = useMemo(() => packPeriods(new Date(), fyMonth), [fyMonth]);
  const [periodId, setPeriodId] = useState('month');
  const period = periods.find((p) => p.id === periodId) ?? periods[0];
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!may) return;
    api.get<{ financial_year_start_month?: number; receipt_settings?: { accountant_email?: string } }>('/businesses/current').then((b) => {
      if (b.financial_year_start_month) setFyMonth(b.financial_year_start_month);
      setEmail((e) => e || b.receipt_settings?.accountant_email || '');
    }).catch(() => {});
  }, [may]);

  const tooLong = spanDays(period) > SPAN_LIMIT_DAYS;
  const download = async () => {
    if (tooLong) { setError(t('Choose a period of up to about a year')); return; }
    setBusy('download'); setError(''); setNote('');
    try { await shareDownload(packRequest(API_URL, sessionStore.get(), period), 'application/zip', 'public.zip-archive', 'Accountant pack'); }
    catch (e) { setError(e instanceof Error ? t(e.message.startsWith('Could not take the backup') ? 'Could not send. Check the connection and try again.' : e.message) : ''); }
    finally { setBusy(''); }
  };
  // the phone's share sheet has WhatsApp in it, with the file attached: pick the accountant's chat there
  const whatsapp = async () => {
    if (tooLong) { setError(t('Choose a period of up to about a year')); return; }
    setBusy('whatsapp'); setError(''); setNote('');
    try { await shareDownload(packRequest(API_URL, sessionStore.get(), period), 'application/zip', 'public.zip-archive', 'Accountant pack'); }
    catch (e) { setError(e instanceof Error ? t(e.message.startsWith('Could not take the backup') ? 'Could not send. Check the connection and try again.' : e.message) : ''); }
    finally { setBusy(''); }
  };
  const send = async () => {
    const problem = emailProblem(email);
    if (problem) { setError(t(problem)); return; }
    if (tooLong) { setError(t('Choose a period of up to about a year')); return; }
    setBusy('email'); setError(''); setNote('');
    try { const r = await api.post<{ sent_to: string }>('/reports/accountant-pack/email', emailBody(email, period)); setNote(t('Sent: {email}', { email: r.sent_to })); }
    catch (e) { setError(e instanceof ApiError ? e.message : t('Could not send. Check the connection and try again.')); }
    finally { setBusy(''); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Accountant pack</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!may ? <Empty>Only owners, admins and accountants can export.</Empty> : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Soft>{t('One ZIP of CSV files for the period: sales and purchase registers, HSN and tax-rate summaries, profit and loss, expenses, every transaction, and what is owed each way.')}</Soft>
            <Text style={{ color: color.soft, fontSize: 13 }}>{t('Period')}</Text>
            <Chips items={periods.map((p) => ({ id: p.id, label: t(p.label) }))} value={period.id} onChange={(id) => { setPeriodId(id); setError(''); setNote(''); }} />
            <Text style={{ color: color.ink, fontWeight: '600' }}>{`${formatDate(period.from)} – ${formatDate(period.to)}`}</Text>
            <ErrorText>{error}</ErrorText>
            {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
            <Button title={busy === 'download' ? t('Preparing…') : t('Download')} onPress={() => { void download(); }} busy={busy === 'download'} disabled={Boolean(busy)} />
            {hasFeature(business, 'messaging') ? <Button title={busy === 'whatsapp' ? t('Preparing…') : t('Send on WhatsApp')} kind="quiet" onPress={() => { void whatsapp(); }} busy={busy === 'whatsapp'} disabled={Boolean(busy)} /> : null}
            <View style={{ gap: 8, borderTopWidth: 1, borderColor: color.line, paddingTop: 12 }}>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Accountant email')}</Text>
              <TextInput style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Accountant email')} />
              <Soft>{t('Their address is remembered for next time.')}</Soft>
              <Button title={busy === 'email' ? t('Preparing…') : t('Email')} kind="quiet" onPress={() => { void send(); }} busy={busy === 'email'} disabled={Boolean(busy)} />
            </View>
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
