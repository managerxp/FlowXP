import * as Location from 'expo-location';
import { api, sessionStore } from './session.ts';
import { kvGet, kvSet } from './local.ts';
import { setSpotProvider, type Where } from './field.ts';
import { freshEnough, place, settingOn, withinMs } from './spot.ts';

/* Where a field visit happened. Only for a business that has turned on "record where visits happen" (a setting on the FlowXP website): until then the phone's location is never asked for.
   It is asked once, in the app, the first time a visit is recorded; if the answer is no, or the phone cannot tell in a few seconds, the visit is recorded without a place and nothing else changes. */

const settingKey = (business: number | null) => `visit_location:${business}`;

/** Does this business record visit places? Asked of the server when there is a signal, and kept for when there is not. */
const recordsPlaces = async (business: number | null): Promise<boolean> => {
  const online = await withinMs(api.get<{ visit_location?: boolean }>('/wholesale/settings'), 4000);
  if (online && typeof online.visit_location === 'boolean') { await kvSet(settingKey(business), online.visit_location ? '1' : '0'); return online.visit_location; }
  return settingOn(await kvGet(settingKey(business)));
};

const here = async (): Promise<Where | null> => {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  if (last && freshEnough(last.timestamp, Date.now())) return place(last.coords.latitude, last.coords.longitude);
  const now = await withinMs(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 7000);
  return now ? place(now.coords.latitude, now.coords.longitude) : null;
};

/** Start recording visit places (when the business wants them). Call once when the app starts. */
export const installLocation = () => {
  setSpotProvider(async () => {
    const business = sessionStore.get().businessId;
    if (!(await recordsPlaces(business))) return null;
    return here().catch(() => null);
  });
};
