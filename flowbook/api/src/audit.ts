import { createHash } from 'node:crypto';
import type { Db } from './db.ts';

/* Postgres stores JSONB with its own key order, so the hash must not depend on the order keys were written in. */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(typeof v === 'bigint' ? v.toString() : v) ?? 'null';
};

/**
 * Append to the organization's audit log. Each row hashes the previous one, so deleting or editing a row
 * breaks the chain and `verifyAudit` says where. The per-organization advisory lock keeps the chain linear.
 */
export const audit = async (c: Db, orgId: bigint, entry: { actor?: string | null; action: string; entityType: string; entityId: string | bigint; detail?: Record<string, unknown> }): Promise<void> => {
  await c.query('SELECT pg_advisory_xact_lock($1)', [orgId]);
  const last = (await c.query('SELECT hash FROM audit_log WHERE organization_id = $1 ORDER BY id DESC LIMIT 1', [orgId])).rows[0];
  const prev = (last?.hash as string | undefined) ?? 'genesis';
  const detail = canonical(entry.detail ?? {});
  const body = [prev, entry.actor ?? '', entry.action, entry.entityType, String(entry.entityId), detail].join('|');
  const hash = createHash('sha256').update(body).digest('hex');
  await c.query(
    `INSERT INTO audit_log (organization_id, actor, action, entity_type, entity_id, detail, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [orgId, entry.actor ?? null, entry.action, entry.entityType, String(entry.entityId), detail, prev, hash]
  );
};

/** Recompute the chain. Returns the id of the first broken row, or null when intact. */
export const verifyAudit = async (c: Db, orgId: bigint): Promise<bigint | null> => {
  const rows = (await c.query('SELECT id, actor, action, entity_type, entity_id, detail, prev_hash, hash FROM audit_log WHERE organization_id = $1 ORDER BY id', [orgId])).rows;
  let prev = 'genesis';
  for (const r of rows) {
    const body = [prev, r.actor ?? '', r.action, r.entity_type, r.entity_id, canonical(r.detail)].join('|');
    if (r.prev_hash !== prev || createHash('sha256').update(body).digest('hex') !== r.hash) return r.id as bigint;
    prev = r.hash as string;
  }
  return null;
};
