/*
 * Imported first by every seed script (seed-demo, seed-live, seed-salon, seed-pharmacy, seed-wholesale,
 * seed-distributor). Those scripts create demo businesses, users with known passwords and made-up sales; run by
 * accident on the live server they would mix fake data into real accounts. So with NODE_ENV=production they stop
 * before touching the database, unless ALLOW_SEED_IN_PRODUCTION=yes is set for a deliberate one-off (a demo server).
 *
 * Loads backend/.env itself, so NODE_ENV from the file counts too, and so it can stand in for `import 'dotenv/config'`.
 */
import 'dotenv/config';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED_IN_PRODUCTION !== 'yes') {
  console.error('[seed] refusing to run: NODE_ENV is production. Demo data does not belong in a live database.\n'
    + '       If this really is a demo server, run it again with ALLOW_SEED_IN_PRODUCTION=yes.');
  process.exit(1);
}
