/* A customer's spendable loyalty points, as GET /loyalty/customers/:id returns them (same numbers the website's "Use points" box uses). */
export type Points = { balance: number; balance_value: number; point_value: number; min_redeem_points: number; max_redeem_pct: number; membership_id?: number | null; tier?: { name: string } | null };

/** The most points that can go on a bill of `totalPaise`: the balance, capped by the share of the bill points may pay for. */
export const mostPoints = (p: Points, totalPaise: number): number =>
  Math.max(0, Math.min(p.balance, Math.floor((totalPaise / 100 * p.max_redeem_pct) / 100 / p.point_value)));

/** What `points` take off the bill, in paise (never more than the bill, nothing below the minimum). */
export const pointsOffPaise = (p: Points | null | undefined, points: number, totalPaise: number): number =>
  !p || points < p.min_redeem_points || points > p.balance ? 0 : Math.min(totalPaise, Math.round(points * p.point_value * 100));
