import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../lib/session.ts';

/* Where to start: sign in, then choose business and outlet, then the till. */
export default function Index() {
  const s = useSession();
  if (!s.ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!s.token) return <Redirect href="/login" />;
  if (s.businessId == null || s.branchId == null) return <Redirect href="/choose" />;
  return <Redirect href="/till" />;
}
