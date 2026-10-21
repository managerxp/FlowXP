import { useState } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { currentBusiness, useSession } from '../lib/session.ts';
import { t } from '../lib/i18n.ts';
import { Panel, SetupShell } from '../lib/formKit.tsx';
import { findTasks, workshopOn } from '../lib/workshopExtras.ts';
import { Line, Soft, s } from '../lib/ui.tsx';

/* "Help me find": say what you want to do in your own words and tap the screen that does it. Only what this person can open is listed. */
export default function HelpFindScreen() {
  const me = currentBusiness(useSession());
  const [q, setQ] = useState('');
  const rows = findTasks(q, { parts: me?.business_type === 'AUTO_PARTS', workshop: workshopOn(me), owner: me?.role === 'OWNER' });
  return (
    <SetupShell title="Help me find" sub="What do you want to do?" ok denied="">
      <Panel>
        <TextInput style={s.input} value={q} onChangeText={setQ} placeholder={t('For example: add racks, job card, import')} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('What do you want to do?')} />
        {rows.map((x) => <Line key={x.text} left={t(x.text)} onPress={() => router.push(x.go as never)} />)}
        {q.trim() && rows.length === 0 ? <Soft>{t('No screen found for that. Try another word.')}</Soft> : null}
      </Panel>
    </SetupShell>
  );
}
