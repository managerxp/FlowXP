/*
 * The older Visit card, Points & tiers and salon earning-rule tables. Loyalty cards (loyalty_programmes and friends) are the only loyalty now and no shop had
 * started on the older ones, so there is nothing to carry over. points_ledger and loyalty_redemptions belong to cards and stay.
 */
export const up = async (client) => {
  await client.query(`DROP TABLE IF EXISTS points_tiers, points_programs, loyalty_events, loyalty_programs, salon_loyalty_rules`);
};
