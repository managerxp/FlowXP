import { useState } from 'react';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { t } from '../lib/i18n.ts';
import { Card, Input, Msg, Panel, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import { canJobCards } from '../lib/jobCards.ts';
import { serviceBody, serviceLine, serviceProblem, serviceSub, workshopOn, type Service } from '../lib/workshopExtras.ts';
import { Button, Failed, Line, Loading, SectionTitle, Soft } from '../lib/ui.tsx';

/* The services the workshop charges for (oil change, alignment): on a job card each is one tap. */
export default function JobServicesScreen() {
  const me = currentBusiness(useSession());
  const list = useList<Service[]>('/autoparts/jobcards/services');
  const [f, setF] = useState({ name: '', price: '', tax: '' });
  const a = useAct();
  const body = !list.data ? (list.error ? <Failed message={list.error} onRetry={list.reload} /> : <Loading />) : (
    <Panel>
      <Soft>{t('What you charge for work. On a job card each one is a single tap. Adding a name that is already here changes its charge.')}</Soft>
      <Card>
        <SectionTitle>Add a service</SectionTitle>
        <Input label="Service" value={f.name} onChange={(v) => setF({ ...f, name: v })} max={120} />
        <Input label="Charge" numeric value={f.price} onChange={(v) => setF({ ...f, price: v })} max={9} />
        <Input label="GST % (optional)" hint="Blank: the shop's labour rate" numeric value={f.tax} onChange={(v) => setF({ ...f, tax: v })} max={5} />
        <Button title="Add a service" busy={a.busy} onPress={() => { void a.run(serviceProblem(f.name, f.price, f.tax), async () => { await api.post('/autoparts/jobcards/services', serviceBody(f.name, f.price, f.tax)); setF({ name: '', price: '', tax: '' }); list.reload(); }); }} />
        <Msg a={a} />
      </Card>
      {list.data.length === 0 ? <Soft>{t('No services yet. Add the work you do most, with its charge.')}</Soft> : null}
      {list.data.map((s) => (
        <Line key={s.service_id} left={serviceLine(s)} sub={serviceSub(s)}
          onPress={() => confirm(t('Remove {name}?', { name: s.name }), '', 'Remove', () => { void a.run('', async () => { await api.call(`/autoparts/jobcards/services/${s.service_id}`, { method: 'DELETE', body: {} }); list.reload(); }, 'Saved'); })} />
      ))}
    </Panel>
  );
  return (
    <SetupShell title="Labour and services" sub="What you charge for work: oil change, alignment" ok={canJobCards((p) => allowed(me, p)) && workshopOn(me)} denied="You do not have access to job cards.">
      {body}
    </SetupShell>
  );
}
