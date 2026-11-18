import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { currentBusiness, restoreSession, useSession } from '../lib/session.ts';
import { needsLanguageAsk } from '../lib/langAsked.ts';
import { Splash } from '../lib/Splash.tsx';

/* Where to start: sign in, then (the first time only) choose a language, then choose business and outlet, then the till. */
export default function Index() {
  const s = useSession();
  const userId = s.user?.user_id ?? null;
  const [ask, setAsk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!s.token || !s.user) { setAsk(null); return; }
    let live = true;
    void needsLanguageAsk(s.user).then((v) => { if (live) setAsk(v); });
    return () => { live = false; };
  }, [s.token, userId, s.user?.language]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.ready) return <Splash onRetry={() => { void restoreSession(); }} />;
  if (!s.token) return <Redirect href="/login" />;
  if (ask === null) return <Splash />;   // a moment: reading whether this person has been asked
  if (ask) return <Redirect href="/language" />;
  if (s.businessId == null || s.branchId == null) return <Redirect href="/choose" />;
  // a person who only works the kitchen goes straight to the kitchen screen, with no till or reports
  if (currentBusiness(s)?.role === 'KITCHEN') return <Redirect href="/kitchen" />;
  return <Redirect href="/home" />;
}
