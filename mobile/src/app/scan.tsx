import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useScope } from '../lib/local.ts';
import { add } from '../lib/sale.ts';
import { Button, Screen, Soft, color } from '../lib/ui.tsx';

/* Scan one item after another; the camera stays open until Done. The same code twice in a row within a moment is one scan. */
export default function Scan() {
  const scope = useScope();
  const [permission, ask] = useCameraPermissions();
  const [message, setMessage] = useState('Point the camera at a barcode');
  const last = useRef({ code: '', at: 0 });

  if (!permission) return <Screen><Soft>Checking camera…</Soft></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
          <Text style={{ fontSize: 18, color: color.ink }}>FlowXP needs the camera to scan barcodes.</Text>
          <Button title="Allow the camera" onPress={() => { void ask(); }} />
          <Button title="Not now" kind="quiet" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const onCode = async ({ data }: { data: string }) => {
    const now = Date.now();
    if (data === last.current.code && now - last.current.at < 1500) return;
    last.current = { code: data, at: now };
    const product = await scope?.catalog.findByBarcode(data);
    if (!product) { setMessage(`${data}: not in the catalogue`); return; }
    if (!product.is_available) { setMessage(`${product.name} is not available at this outlet`); return; }
    if (product.modifier_group_ids?.length) { router.push({ pathname: '/options', params: { id: String(product.product_id) } }); return; }
    add(product);
    setMessage(`Added ${product.name}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={onCode} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }} />
      <View style={{ padding: 16, gap: 10, backgroundColor: color.card }}>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, color: color.ink }}>{message}</Text>
        <Button title="Done" onPress={() => router.back()} />
      </View>
    </View>
  );
}
