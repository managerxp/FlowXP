import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { goBack } from '../lib/nav.ts';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useScope } from '../lib/local.ts';
import { add } from '../lib/sale.ts';
import { setCaptured } from '../lib/capture.ts';
import { markDone } from '../lib/learn.tsx';
import { Button, Screen, Soft, color } from '../lib/ui.tsx';

/* Scan one item after another; the camera stays open until Done. The same code twice in a row within a moment is one scan. */
export default function Scan() {
  const scope = useScope();
  const { capture } = useLocalSearchParams<{ capture?: string }>();
  const [permission, ask] = useCameraPermissions();
  const [message, setMessage] = useState('Point the camera at the barcode');
  const last = useRef({ code: '', at: 0 });

  if (!permission) return <Screen><Soft>Checking camera…</Soft></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontSize: 18, color: color.ink }}>Allow the camera so FlowXP can read barcodes. It does not take or keep photos.</Text>
          <Button title="Allow the camera" onPress={() => { void ask(); }} />
          <Button title="Not now" kind="quiet" onPress={() => goBack()} />
        </View>
      </Screen>
    );
  }

  const onCode = async ({ data }: { data: string }) => {
    const now = Date.now();
    if (data === last.current.code && now - last.current.at < 1500) return;
    last.current = { code: data, at: now };
    if (capture) { setCaptured(data.trim()); goBack(); return; }   // for a form: hand the code back and close
    const product = await scope?.catalog.findByBarcode(data);
    if (!product) { setMessage(`${data} is not in your products. Check the code, or add it under Products.`); return; }
    if (!product.is_available) { setMessage(`${product.name} is not available at this outlet`); return; }
    if (product.modifier_group_ids?.length) { router.push({ pathname: '/options', params: { id: String(product.product_id) } }); return; }
    add(product); markDone('first_scan');
    setMessage(`Added ${product.name}. Scan the next one, or tap Done.`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={onCode} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }} />
      <View style={{ padding: 16, gap: 10, backgroundColor: color.card }}>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, color: color.ink }}>{message}</Text>
        <Button title="Done" onPress={() => goBack()} />
      </View>
    </View>
  );
}
