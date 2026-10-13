/* The launch checklist shown on the overview: what must be true before real customers use the platform. */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { Card, Badge } from '../components/ui.jsx';

const LaunchChecks = () => {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { adminApi('/launch-checks').then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return null;
  if (!d) return null;
  const todo = d.checks.filter((c) => !c.ok);
  return (
    <Card className="mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-400">Launch checklist</h2>
        <Badge tone={d.ready ? 'success' : 'warning'}>{d.ready ? 'Ready to launch' : `${todo.filter((c) => c.level === 'must').length} must-fix item(s)`}</Badge>
      </div>
      <ul className="mt-3 divide-y divide-line text-sm">
        {d.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 py-2">
            <span aria-hidden className={c.ok ? 'text-success' : c.level === 'must' ? 'text-danger' : 'text-warning'}>{c.ok ? '✓' : c.level === 'must' ? '✕' : '!'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-ink-900">{c.label}{!c.ok && c.level === 'should' ? <span className="ml-2 text-xs text-ink-500">(recommended)</span> : null}</p>
              <p className="text-xs text-ink-500">{c.detail}</p>
            </div>
            <span className="sr-only">{c.ok ? 'Done' : 'Not done'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default LaunchChecks;
