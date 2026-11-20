/*
 * Every shop moves onto Loyalty cards: the older Visit card and the older Points & tiers programmes are turned into cards (same rules, same customers, same balances)
 * and switched off, so no owner has to press the Move button. See modules/loyaltyMigrate.js for exactly what is copied and what differs.
 *
 * Salons are left out for now: their till has earning rules per service, product and package that cards cannot hold yet.
 * A shop that cannot be moved cleanly (for example more tiers than a card allows) is skipped with a warning and keeps its older programme and its Move banner.
 * Each move runs inside its own savepoint, so one shop's problem never stops the others or the deploy.
 */
export const up = async (client) => {
  const { preview, run, previewPoints, runPoints } = await import('../src/modules/loyaltyMigrate.js');
  const shops = (await client.query(
    `SELECT business_id FROM businesses WHERE business_type <> 'SALON'
       AND (business_id IN (SELECT business_id FROM loyalty_programs WHERE is_enabled) OR business_id IN (SELECT business_id FROM points_programs WHERE is_enabled)) ORDER BY business_id`)).rows;
  const moves = [['visit card', preview, run], ['points', previewPoints, runPoints]];
  for (const { business_id: businessId } of shops) {
    for (const [label, look, go] of moves) {
      await client.query('SAVEPOINT older_loyalty');
      try {
        if ((await look(client, businessId)).state !== 'READY') { await client.query('RELEASE SAVEPOINT older_loyalty'); continue; }
        await go(client, { businessId });
        await client.query('RELEASE SAVEPOINT older_loyalty');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT older_loyalty');
        console.warn(`[migration 0152] business ${businessId}: ${label} stays on the older programme: ${error.message}`);
      }
    }
  }
};
