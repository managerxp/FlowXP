import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { chooseOutlet, signOut, useSession, type Business } from '../lib/session.ts';
import { Button, Screen, Soft, Title, color, s } from '../lib/ui.tsx';

/* One list of every outlet the person may bill at, grouped by business. One choice = both. */
export default function Choose() {
  const session = useSession();
  const rows = session.businesses.flatMap((b: Business) => b.outlets.map((o) => ({ b, o })));

  useEffect(() => {
    if (rows.length === 1) { void chooseOutlet(rows[0].b.business_id, rows[0].o.branch_id).then(() => router.replace('/')); }
  }, [rows.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen>
      <View style={{ gap: 4, marginTop: 24, marginBottom: 12 }}>
        <Title>Where are you billing?</Title>
        <Soft>{session.user?.email}</Soft>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.b.business_id}-${r.o.branch_id}`}
        contentContainerStyle={{ gap: 10 }}
        ListEmptyComponent={<Soft>This account has no outlet to bill at yet. Set one up on the FlowXP website.</Soft>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" style={[s.card, { minHeight: 64, justifyContent: 'center' }]} onPress={() => { void chooseOutlet(item.b.business_id, item.o.branch_id).then(() => router.replace('/')); }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: color.ink }}>{item.o.name}</Text>
            <Soft>{item.b.name}</Soft>
          </Pressable>
        )}
      />
      <Button title="Sign out" kind="quiet" onPress={() => { void signOut().then(() => router.replace('/login')); }} />
    </Screen>
  );
}
