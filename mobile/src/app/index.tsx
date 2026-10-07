import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { currentBusiness, useSession } from '../lib/session.ts';

/* Where to start: sign in, then choose business and outlet, then the till. */
export default function Index() {
  const s = useSession();
  if (!s.ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!s.token) return <Redirect href="/login" />;
  if (s.businessId == null || s.branchId == null) return <Redirect href="/choose" />;
  // a person who only works the kitchen goes straight to the kitchen screen, with no till or reports
  if (currentBusiness(s)?.role === 'KITCHEN') return <Redirect href="/kitchen" />;
  return <Redirect href="/home" />;
}
