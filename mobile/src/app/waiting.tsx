import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../lib/nav.ts';
import { WaitingList } from '../lib/WaitingList.tsx';
import { Button, Title, s } from '../lib/ui.tsx';

export default function Waiting() {
  return (
    <SafeAreaView style={s.screen}>
      <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>Bills waiting to send</Title>
        <Button title="Back" kind="quiet" onPress={() => goBack()} />
      </View>
      <WaitingList />
    </SafeAreaView>
  );
}
