/*
 * Placeholder for the modules that are not built yet.
 *
 * The sidebar lists the whole product because that is what the shell will hold
 * — but a link to a blank page is worse than no link. This says plainly which
 * priority the screen belongs to and what it will do, so a click is
 * informative rather than a dead end.
 *
 * Delete a route's use of this as its real screen lands.
 */
import { Card, Button } from '../components/ui.jsx';

const ComingSoon = ({ title, body, priority }) => (
  <div className="mx-auto max-w-2xl">
    <Card className="text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
        Priority {priority}
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">{body}</p>
      <Button to="/app" variant="secondary" size="sm" className="mt-7">Back to dashboard</Button>
    </Card>
  </div>
);

export default ComingSoon;
