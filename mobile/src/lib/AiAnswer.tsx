import { Text, View } from 'react-native';
import { blocks } from './flowai.ts';
import { color } from './ui.tsx';

/* An answer from Flow AI, drawn as plain text: paragraphs, bullets, numbers and bold. Nothing the assistant writes is ever run or opened. */
export default function AiAnswer({ text }: { text: string }) {
  return (
    <View style={{ gap: 6 }}>
      {blocks(text).map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {b.kind === 'bullet' ? <Text style={{ color: color.ink, fontSize: 16 }}>•</Text> : b.kind === 'number' ? <Text style={{ color: color.ink, fontSize: 16 }}>{b.n}.</Text> : null}
          <Text style={{ flex: 1, color: color.ink, fontSize: 16, lineHeight: 23 }}>{b.spans.map((sp, k) => <Text key={k} style={sp.bold ? { fontWeight: '700' } : undefined}>{sp.text}</Text>)}</Text>
        </View>
      ))}
    </View>
  );
}
