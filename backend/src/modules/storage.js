/*
 * Where uploaded files (product photos) live.
 *
 *   STORAGE_DRIVER=local   this server's disk under uploads/ (development, or one
 *                          server with a persistent disk)
 *   STORAGE_DRIVER=s3      any S3-compatible bucket (AWS S3, Cloudflare R2,
 *                          DigitalOcean Spaces, MinIO): survives redeploys and
 *                          scales past one server
 *
 * The rest of the app only calls put() and remove() and stores the URL it gets
 * back, so switching driver never touches another file. Requests to S3 are signed
 * with AWS Signature V4, written here with node:crypto so there is no SDK to
 * install for two operations. Stored URLs are absolute for s3 and /uploads/...
 * for local, so old photos keep working after a switch.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/env.js';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * AWS Signature V4 for a request with headers we control. Returns the headers to send
 * (the given ones, plus x-amz-date, x-amz-content-sha256 and Authorization).
 * Pure: `now` is a parameter so it can be checked against AWS's published examples.
 */
export const signV4 = ({ method, url, headers = {}, payload = '', region, service = 's3', accessKeyId, secretAccessKey, now = new Date() }) => {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');          // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  const payloadHash = typeof payload === 'string' && payload === '' ? sha256('') : sha256(payload);

  const all = { ...headers, host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = u.pathname.split('/').map((seg) => encode(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return { ...all, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
};

/* ── drivers ────────────────────────────────────────────────────────────── */

const localDriver = {
  name: 'local',
  root: () => path.join(process.cwd(), 'uploads'),
  async put({ key, buffer }) {
    const file = path.join(this.root(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return `/uploads/${key}`;
  },
  async remove(url) {
    if (!url?.startsWith('/uploads/')) return;
    const file = path.join(this.root(), url.slice('/uploads/'.length));
    // never leave the uploads folder, whatever the stored value says
    if (!file.startsWith(this.root() + path.sep)) return;
    await fs.rm(file, { force: true });
  }
};

const s3Driver = {
  name: 's3',
  base() {
    const { endpoint, bucket } = config.storage;
    return `${endpoint.replace(/\/+$/, '')}/${bucket}`;
  },
  publicBase() {
    return (config.storage.publicUrl || this.base()).replace(/\/+$/, '');
  },
  async request(method, key, { buffer, contentType } = {}) {
    const { region, accessKeyId, secretAccessKey } = config.storage;
    const url = `${this.base()}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const headers = signV4({ method, url, headers: contentType ? { 'content-type': contentType } : {}, payload: buffer ?? '', region, accessKeyId, secretAccessKey });
    const response = await fetch(url, { method, headers, body: buffer, signal: AbortSignal.timeout(20000) });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      throw new Error(`storage ${method} failed (${response.status})`);
    }
  },
  async put({ key, buffer, contentType }) {
    await this.request('PUT', key, { buffer, contentType });
    return `${this.publicBase()}/${key.split('/').map(encodeURIComponent).join('/')}`;
  },
  async remove(url) {
    const prefix = `${this.publicBase()}/`;
    if (!url?.startsWith(prefix)) return;
    await this.request('DELETE', decodeURI(url.slice(prefix.length)));
  }
};

const driver = () => (config.storage.driver === 's3' ? s3Driver : localDriver);

export const storageDriver = () => driver().name;

/** Store a file; returns the URL to keep. `key` is a relative path like products/12/34-1700000000.jpg. */
export const putFile = ({ key, buffer, contentType }) => driver().put({ key, buffer, contentType });

/** Best-effort delete of a previously stored URL (a failed cleanup must never fail the request). */
export const removeFile = async (url) => {
  try { await driver().remove(url); } catch (error) { console.error('[storage] remove failed:', error.message); }
};

export const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
