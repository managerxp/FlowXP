# FlowXP gaming lounge: plan and status

Target (owner, 2026-10-12): a basic **PS5 / console lounge or a pool / snooker hall, not a PC café**. Timer is the basic timer only (other advanced features live in ManagerXP).
Staff screens only: no gamer phone page, no public booking page.

## Reuse (audited)
`GAMING_CAFE` already existed and was a restaurant type, so tables, orders/tabs, KOT, the kitchen display, QR ordering, recipes, stock, billing, split bills, discounts, loyalty, receipts, GST and credit
notes were reused as they are. New: the gaming layer (stations, rates, sessions, wallet, packs, bookings, tournaments, reports) and a handful of guarded hooks (see `GAMING.md`).

## Phases and status (all built, 2026-10-12)
| Phase | Built | Tests |
|---|---|---|
| 1 Foundation | migration 0092, settings, zones, stations (+ table), roles, permissions, plan switches | `gamingSessions`, `gamingSecurity` |
| 2 Pricing, sessions, timer | pricing engine, lifecycle, board, alerts, time on the tab, bill through the ordinary path | `gamingPricing`, `gamingSessions`, `gamingSecurity` |
| 3 Prepaid | migration 0093/0094, players, wallet with bonus, WALLET payment, refunds, hour packs | `gamingWallet` |
| 4 Bookings, tournaments | bookings with hold and no-show, light tournaments | `gamingBookings` |
| 5 Reports, dashboard, seed | summary, by station, busy hours, games, dashboard, "Pixel Lounge" | `gamingReports` |
| 6 Website, docs, signup | `/industries/gaming`, home tab, SEO, sitemap, signup option | build, browser walkthrough |

## Not built
Console/PC lock or unlock, gamer phone page, online booking, brackets, phone-app screens, deposits on bookings, paying prizes out. See "Known limits" in `GAMING.md`.
