import { Text } from 'react-native';
import { currentBusiness, loadMe, useSession, api } from '../lib/session.ts';
import { t } from '../lib/i18n.ts';
import { Card, Msg, Panel, Row, SetupShell, useAct } from '../lib/formKit.tsx';
import { canMechanicMode, workshopOn } from '../lib/workshopExtras.ts';
import { Soft, color } from '../lib/ui.tsx';

/* Mechanic mode: the owner of a spare parts shop switches the workshop tools (job cards, labour, staff and payroll) on or off. Off only hides them; nothing is deleted. */
export default function MechanicModeScreen() {
  const me = currentBusiness(useSession());
  const a = useAct();
  const on = workshopOn(me);
  return (
    <SetupShell title="Mechanic mode" sub="Show job cards, labour and staff, or hide them for a parts-only shop" ok={canMechanicMode(me?.role) && me?.business_type === 'AUTO_PARTS'} denied="Only the owner can change mechanic mode.">
      <Panel>
        <Soft>{t('Turn this on if you also service bikes or cars. Turn it off if you only sell parts. You can change it any time, and nothing is deleted.')}</Soft>
        <Card>
          <Row label="This shop also does servicing" hint="On: Job cards, labour and services, what the workshop earned, and staff, attendance and payroll appear in the menu." value={on}
            onChange={(v) => { void a.run('', async () => { await api.call('/businesses/current/workshop-mode', { method: 'PUT', body: { enabled: v } }); await loadMe(); }, v ? 'Mechanic mode is on' : 'Mechanic mode is off'); }} />
          <Text style={{ color: color.soft, fontSize: 13 }}>{t('Racks, parts, vehicles, receiving, trade accounts and reports stay either way.')}</Text>
        </Card>
        <Msg a={a} />
      </Panel>
    </SetupShell>
  );
}
