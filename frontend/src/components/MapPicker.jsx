/*
 * Where the shop is: a Google map with a pin the owner can drag, or click the map to place it. It reports { lat, lon }.
 *
 * Needs the browser key VITE_GOOGLE_MAPS_API_KEY (restricted to our websites and to the Maps JavaScript API in Google Cloud; a browser map key is public by design).
 * Without a key, or if Google refuses it, `fallback` is shown instead (the plain embedded map), so onboarding never depends on Google.
 */
import { useEffect, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const INDIA = { lat: 20.5937, lng: 78.9629 };
let loading = null;   // one script load for the whole page

const loadMaps = () => {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.gm_authFailure = () => { loading = null; reject(new Error('refused')); };   // Google calls this when it rejects the key
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__flowxpMapsReady`;
    s.async = true;
    window.__flowxpMapsReady = () => resolve(window.google.maps);
    s.onerror = () => { loading = null; reject(new Error('could not load')); };
    document.head.appendChild(s);
  });
  return loading;
};

const MapPicker = ({ value, onChange, fallback = null }) => {
  const box = useRef(null);
  const map = useRef(null);
  const pin = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [failed, setFailed] = useState(!KEY);

  // build the map once
  useEffect(() => {
    if (!KEY) return undefined;
    let live = true;
    loadMaps().then((maps) => {
      if (!live || !box.current) return;
      const start = value ? { lat: value.lat, lng: value.lon } : INDIA;
      map.current = new maps.Map(box.current, { center: start, zoom: value ? 16 : 4, streetViewControl: false, mapTypeControl: false, fullscreenControl: false });
      const place = (pos) => {
        const at = { lat: Number(pos.lat().toFixed(6)), lon: Number(pos.lng().toFixed(6)) };
        if (!pin.current) { pin.current = new maps.Marker({ map: map.current, position: pos, draggable: true }); pin.current.addListener('dragend', (e) => place(e.latLng)); }
        else pin.current.setPosition(pos);
        onChangeRef.current(at);
      };
      if (value) { pin.current = new maps.Marker({ map: map.current, position: start, draggable: true }); pin.current.addListener('dragend', (e) => place(e.latLng)); }
      map.current.addListener('click', (e) => place(e.latLng));
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a position set from outside (the "use my location" button) moves the pin
  useEffect(() => {
    if (!value || !map.current || !window.google?.maps) return;
    const pos = { lat: value.lat, lng: value.lon };
    if (!pin.current) {
      pin.current = new window.google.maps.Marker({ map: map.current, position: pos, draggable: true });
      pin.current.addListener('dragend', (e) => onChangeRef.current({ lat: Number(e.latLng.lat().toFixed(6)), lon: Number(e.latLng.lng().toFixed(6)) }));
    } else pin.current.setPosition(pos);
    map.current.panTo(pos); if (map.current.getZoom() < 15) map.current.setZoom(16);
  }, [value?.lat, value?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return fallback;
  return (
    <div>
      <div ref={box} role="application" aria-label="Map: click or drag the pin to your shop" className="h-56 w-full rounded-lg border border-line bg-surface-2" />
      <p className="mt-1 text-caption text-ink-500">{value ? `${value.lat}, ${value.lon}` : 'Click the map to place the pin on your shop. You can drag it to adjust.'}</p>
    </div>
  );
};

export default MapPicker;
