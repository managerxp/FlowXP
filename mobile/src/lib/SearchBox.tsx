import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { setCaptured, useCaptured } from './capture.ts';
import { Button, s } from './ui.tsx';

/* A search box with a Scan button beside it, for finding a product by its barcode: the scanner hands the code back and it is searched like anything typed.
   Used where a barcode helps (stock coming in, orders for shops, the van); not on a restaurant's menu, where items are tapped. */
export const SearchBox = ({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) => {
  const captured = useCaptured();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  // only the screen in front takes the code
  useEffect(() => { if (focused && captured) { onChange(captured); setCaptured(null); } }, [focused, captured]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <TextInput style={[s.input, { flex: 1 }]} value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label} autoCorrect={false} />
      <Button title="Scan" kind="quiet" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} />
    </View>
  );
};
