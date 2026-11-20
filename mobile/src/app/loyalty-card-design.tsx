import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { hasFeature } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { ACCENTS, ICONS, THEMES, canDesign, cardBody, isHex, lookOf, readableOn, suggestedIcons, type CardLook, type Programme } from '../lib/cardDesign.ts';
import CardFace from '../lib/CardFace.tsx';
import { Button, Empty, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const Swatch = ({ hex, on, label, onPress }: { hex: string; on: boolean; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: hex, borderWidth: 3, borderColor: on ? color.ink : color.line }} />
);

/* One card's look: live preview, colours (a theme or your own), stamp colour, an icon from five that suit the business, heading and message. */
export default function LoyaltyCardDesign() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const me = currentBusiness(useSession());
  const ok = canDesign(me?.role) && hasFeature(me, 'loyalty_programmes');
  const [p, setP] = useState<Programme | null>(null);
  const [look, setLook] = useState<CardLook | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const [bgText, setBgText] = useState(''); const [accentText, setAccentText] = useState('');

  useEffect(() => {
    if (!ok) return;
    api.get<Programme[]>('/loyalty/programmes').then((list) => {
      const found = list.find((x) => x.programme_id === Number(id)) ?? null;
      setP(found); if (found) { const l = lookOf(found); setLook(l); setBgText(l.bg); setAccentText(l.accent); } else setError(t('Not found'));
    }).catch((e: Error) => setError(e.message));
  }, [id, ok]);

  const change = (patch: Partial<CardLook>) => { setLook((l) => (l ? { ...l, ...patch } : l)); setSaved(false); };
  const typedColour = (v: string, key: 'bg' | 'accent') => {
    const hex = v.startsWith('#') ? v : `#${v}`;
    key === 'bg' ? setBgText(v) : setAccentText(v);
    if (isHex(hex)) change(key === 'bg' ? { bg: hex, fg: readableOn(hex) } : { accent: hex });
  };
  const save = async () => {
    if (!p || !look) return;
    if (!isHex(look.bg) || !isHex(look.accent)) { setError(t('Use a colour like #0f766e.')); return; }
    setBusy(true); setError('');
    try { await api.call(`/loyalty/programmes/${p.programme_id}`, { method: 'PUT', body: cardBody(look) }); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const label = (text: string) => <Text style={{ color: color.soft, fontSize: 13 }}>{t(text)}</Text>;
  const icons = more ? Object.keys(ICONS) : suggestedIcons(me?.business_type, look?.icon);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{t('Card design')}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!ok ? <Empty>You do not have access to the card designer.</Empty> : !p || !look ? (error ? <ErrorText>{error}</ErrorText> : <Loading />) : (
            <>
              <CardFace look={look} business={me?.name ?? ''} name={p.name} kind={p.kind} balance={p.kind === 'POINTS' ? 120 : Math.min(2, p.redeem_points)} redeemAt={p.redeem_points} />
              <View style={{ gap: 8 }}>
                {label('Colours')}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {THEMES.map(([bg, fg, accent]) => <Swatch key={bg} hex={bg} on={look.bg === bg} label={bg} onPress={() => { change({ bg, fg, accent }); setBgText(bg); setAccentText(accent); }} />)}
                </View>
                {label('Colour (like #0f766e)')}
                <TextInput style={s.input} value={bgText} onChangeText={(v) => typedColour(v, 'bg')} autoCapitalize="none" autoCorrect={false} maxLength={7} accessibilityLabel={t('Pick your own colour')} />
              </View>
              <View style={{ gap: 8 }}>
                {label('Stamp colour')}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{ACCENTS.map((hex) => <Swatch key={hex} hex={hex} on={look.accent === hex} label={hex} onPress={() => { change({ accent: hex }); setAccentText(hex); }} />)}</View>
                <TextInput style={s.input} value={accentText} onChangeText={(v) => typedColour(v, 'accent')} autoCapitalize="none" autoCorrect={false} maxLength={7} accessibilityLabel={t('Stamp colour')} />
              </View>
              <View style={{ gap: 8 }}>
                {label('Icon')}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  {icons.map((k) => (
                    <Pressable key={k} accessibilityRole="button" accessibilityLabel={t(ICONS[k].name)} accessibilityState={{ selected: look.icon === k }} onPress={() => change({ icon: k })}
                      style={{ width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: look.icon === k ? color.brand : color.line, backgroundColor: color.card }}>
                      <MaterialCommunityIcons name={ICONS[k].glyph} size={24} color={color.ink} />
                    </Pressable>
                  ))}
                  <Button title={more ? 'Fewer icons' : 'More icons'} kind="quiet" onPress={() => setMore((v) => !v)} />
                </View>
              </View>
              <View style={{ gap: 4 }}>
                {label('Heading on the card')}
                <TextInput style={s.input} value={look.title} onChangeText={(v) => change({ title: v })} maxLength={40} accessibilityLabel={t("Heading on the card")} />
                <Soft>{t('Leave empty to use the card name.')}</Soft>
              </View>
              <View style={{ gap: 4 }}>
                {label('Message inside the card')}
                <TextInput style={s.input} value={look.message} onChangeText={(v) => change({ message: v })} maxLength={140} accessibilityLabel={t("Message inside the card")} />
              </View>
              <ErrorText>{error}</ErrorText>
              {saved ? <Soft style={{ color: color.brand }}>{t('Saved')}</Soft> : null}
              <Button title="Save the look" onPress={() => { void save(); }} busy={busy} />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
