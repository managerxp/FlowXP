/*
 * Shop-name search for onboarding (Google Places API New, Text Search), called from the server with its own key
 * (GOOGLE_PLACES_API_KEY: restricted to Places API (New) and this server's address, never sent to the browser).
 * Only the cheap fields are asked for (name, address, position, address parts): no phone or ratings.
 * The owner reviews and edits whatever comes back; nothing is stored from Google except what they confirm.
 */
import config from '../config/env.js';

const part = (comps, type) => comps?.find((c) => c.types?.includes(type))?.longText || '';

export const placesConfigured = () => Boolean(config.googlePlacesKey);

export const searchPlaces = async (query, { lat, lon } = {}) => {
  const body = { textQuery: query, languageCode: 'en', regionCode: 'IN', pageSize: 5 };
  if (Number.isFinite(lat) && Number.isFinite(lon)) body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 20000 } };
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googlePlacesKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Places ${res.status}`);
  const data = await res.json();
  return (data.places || []).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text || '',
    formatted: p.formattedAddress || '',
    lat: p.location?.latitude,
    lon: p.location?.longitude,
    city: part(p.addressComponents, 'locality') || part(p.addressComponents, 'administrative_area_level_2'),
    state: part(p.addressComponents, 'administrative_area_level_1'),
    postal_code: part(p.addressComponents, 'postal_code'),
    country: part(p.addressComponents, 'country')
  })).filter((p) => p.lat != null && p.lon != null);
};
