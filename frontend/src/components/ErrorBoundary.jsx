/*
 * The net under every page.
 *
 * React unmounts the entire tree on an uncaught render error — one bad
 * component turns the whole app into a blank white screen, mid-sale, with no
 * way back except a manual URL reload. An error boundary is the only way to
 * catch that (there is no hook equivalent, hence the class component), and it
 * is placed around AppShell's <Outlet/> specifically: a crash in one screen
 * loses that screen, not the sidebar, the session, or the business context.
 */
import { Component } from 'react';
import { Button } from './ui.jsx';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <p className="text-lg font-semibold text-ink-900">Something went wrong on this page</p>
          <p className="mt-2 text-sm text-ink-500">
            Nothing you did caused this. Your data is safe — try again, or go back to the dashboard.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })} variant="secondary">Try again</Button>
            <Button onClick={() => { this.setState({ error: null }); window.location.href = '/app'; }}>
              Back to dashboard
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
