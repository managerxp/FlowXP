#!/usr/bin/env node
/*
 * FlowXP print agent: a tiny program that runs on the till computer and passes print jobs from the
 * FlowXP web app to the receipt printer, with no print dialog, and can pop the cash drawer.
 * A web page can't talk to a printer directly, so this listens on this computer only (127.0.0.1).
 *
 *   TOKEN=some-long-secret ORIGINS=https://app.example.com node agent.js
 *
 *   TOKEN     the web app sends it with every request; enter the same one in FlowXP (Business settings). Left out, one is made
 *             once and kept in print-agent/.token (it is printed when the agent starts)
 *   ORIGINS   the web address(es) allowed to use it, comma separated (default: the token alone protects it)
 *   PORT      default 9101
 *
 * A job is { target, data } with `data` = base64 ESC/POS bytes. target says where they go:
 *   tcp://192.168.1.50:9100      a network printer (raw port 9100)
 *   winprint://PrinterName       a printer installed on this Windows computer (USB), no sharing needed
 *   share://PC-NAME/PrinterName  a USB printer shared in Windows
 *   lp://PrinterName             a printer known to CUPS (macOS / Linux)
 *   file:///dev/usb/lp0          a device file (Linux)
 * No dependencies: Node 18 or newer is all it needs.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.0.0';
const MAX_BYTES = 1024 * 1024;
const NAME_OK = /^[\w .\-]{1,80}$/;

const run = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited with ${code}`))));
});

const withTempFile = async (bytes, use) => {
  const file = path.join(os.tmpdir(), `flowxp-${crypto.randomBytes(6).toString('hex')}.bin`);
  fs.writeFileSync(file, bytes);
  try { return await use(file); } finally { fs.rm(file, () => {}); }
};

const capture = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('error', reject);
  child.on('close', () => resolve(out));
});

/** The printers installed on this computer, as FlowXP targets: [{ name, target, port }]. USB and Bluetooth printers both show up here once installed. */
/** Windows' built-in "printers" that only make files: never the till printer, so they are left out of the list. */
const VIRTUAL = /^(Fax|Microsoft (Print to PDF|XPS Document Writer)|OneNote|Send To OneNote|Adobe PDF)/i;
export const listPrinters = async () => {
  if (process.platform === 'win32') {
    const json = await capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object Name,PortName | ConvertTo-Json -Compress']);
    const rows = [].concat(json.trim() ? JSON.parse(json) : []);
    const queues = rows.filter((r) => NAME_OK.test(r.Name) && !VIRTUAL.test(r.Name)).map((r) => ({ name: r.Name, port: r.PortName, target: `winprint://${encodeURIComponent(r.Name)}` }));
    // paired Bluetooth devices that have an outgoing serial port: a printer with no driver still shows up here. The port belongs to the device whose address is in its id.
    const bt = await capture('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$ports = Get-PnpDevice -Class Ports -PresentOnly; Get-PnpDevice -Class Bluetooth -PresentOnly | Where-Object { $_.InstanceId -match '^BTHENUM\\\\DEV_([0-9A-F]{12})' } | ForEach-Object { $mac = $Matches[1]; $c = $ports | Where-Object { $_.InstanceId -match "$mac" + '_C0' } | Select-Object -First 1; if ($c -and $c.FriendlyName -match '\\((COM\\d+)\\)') { [pscustomobject]@{ Name = $_.FriendlyName; Port = $Matches[1] } } } | ConvertTo-Json -Compress`]).catch(() => '');
    const paired = [].concat(bt.trim() ? JSON.parse(bt) : []).filter((r) => NAME_OK.test(r.Name)).map((r) => ({ name: `${r.Name} (Bluetooth)`, port: r.Port, target: `com://${r.Port}` }));
    return [...queues, ...paired];
  }
  const names = (await capture('lpstat', ['-e'])).split('\n').map((s) => s.trim()).filter((n) => NAME_OK.test(n));
  return names.map((name) => ({ name, port: '', target: `lp://${encodeURIComponent(name)}` }));
};

/** Send bytes to a target. Rejects with a message a person can act on. */
export const send = async (target, bytes) => {
  let url;
  try { url = new URL(target); } catch { throw new Error('The printer address is not valid (expected tcp://, winprint://, share://, lp:// or file://)'); }

  if (url.protocol === 'tcp:') {
    const port = Number(url.port || 9100);
    if (!url.hostname || !(port > 0 && port < 65536)) throw new Error('The network printer address needs a host and a port');
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: url.hostname, port, timeout: 8000 }, () => socket.end(bytes));
      socket.on('close', (hadError) => { if (!hadError) resolve(); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error(`The printer at ${url.hostname} did not answer`)); });
      socket.on('error', (e) => reject(new Error(`Could not reach the printer at ${url.hostname}: ${e.message}`)));
    });
  }
  if (url.protocol === 'share:') {
    const host = url.hostname; const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (process.platform !== 'win32') throw new Error('share:// printers are for Windows; use lp:// on this computer');
    if (!NAME_OK.test(host) || !NAME_OK.test(name)) throw new Error('The shared printer name has characters that are not allowed');
    return withTempFile(bytes, (file) => run('cmd', ['/c', 'copy', '/b', file, `\\\\${host}\\${name}`]));
  }
  if (url.protocol === 'winprint:') {
    const name = decodeURIComponent(url.hostname || url.pathname.replace(/^\//, ''));
    if (process.platform !== 'win32') throw new Error('winprint:// printers are for Windows; use lp:// on this computer');
    if (!NAME_OK.test(name)) throw new Error('The printer name has characters that are not allowed');
    const script = fileURLToPath(new URL('./winprint.ps1', import.meta.url));
    return withTempFile(bytes, (file) => run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', name, '-File', file]));
  }
  if (url.protocol === 'com:') {
    const port = (url.hostname || url.pathname.replace(/^\//, '')).toUpperCase();
    if (process.platform !== 'win32') throw new Error('com:// printers are for Windows; use lp:// on this computer');
    if (!/^COM\d{1,3}$/.test(port)) throw new Error('The port should look like com://COM13');
    const script = fileURLToPath(new URL('./comprint.ps1', import.meta.url));
    return withTempFile(bytes, (file) => run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', port, '-File', file]));
  }
  if (url.protocol === 'lp:') {
    const name = decodeURIComponent(url.hostname || url.pathname.replace(/^\//, ''));
    if (!NAME_OK.test(name)) throw new Error('The printer name has characters that are not allowed');
    return withTempFile(bytes, (file) => run('lp', ['-d', name, '-o', 'raw', file]));
  }
  if (url.protocol === 'file:') {
    const dev = decodeURIComponent(url.pathname);
    if (!/^\/dev\/[\w/.-]+$/.test(dev)) throw new Error('Only device files under /dev are allowed');
    return fs.promises.writeFile(dev, bytes);
  }
  throw new Error('Unknown printer type: use tcp://, winprint://, share://, lp:// or file://');
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BYTES * 2) { reject(new Error('That job is too big')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

/** The HTTP server, without listening (so tests can start it on any port). */
export const createAgent = ({ token, origins = [], sender = send } = {}) => {
  if (!token || token.length < 8) throw new Error('Set TOKEN to a secret of at least 8 characters');
  const allowAny = origins.includes('*');
  const tokenBuf = Buffer.from(token);

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originOk = !origin || allowAny || origins.includes(origin);
    const reply = (status, body) => {
      const headers = { 'content-type': 'application/json' };
      if (origin && originOk) {
        headers['access-control-allow-origin'] = origin;
        headers.vary = 'Origin';
      }
      res.writeHead(status, headers).end(JSON.stringify(body));
    };

    // Preflight from the FlowXP page. Chrome also asks permission to reach a local address.
    if (req.method === 'OPTIONS') {
      if (!originOk) return reply(403, { ok: false, error: 'This website is not allowed to print here' });
      res.writeHead(204, {
        'access-control-allow-origin': origin, vary: 'Origin',
        'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-private-network': 'true', 'access-control-max-age': '600'
      });
      return res.end();
    }
    if (!originOk) return reply(403, { ok: false, error: 'This website is not allowed to print here' });

    // Pairing: the FlowXP page asks for the token itself, so nobody types it. Only a website named in ORIGINS gets it (never "any website").
    if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/pair') {
      if (!origin || allowAny || !origins.includes(origin)) return reply(403, { ok: false, error: 'Automatic pairing needs the agent started with your FlowXP address (ORIGINS). Enter the token by hand instead.' });
      return reply(200, { ok: true, token });
    }

    const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (given.length !== tokenBuf.length || !crypto.timingSafeEqual(given, tokenBuf)) return reply(401, { ok: false, error: 'Wrong token. Enter the same token the agent was started with.' });

    const route = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && route === '/status') return reply(200, { ok: true, version: VERSION, platform: process.platform, host: os.hostname() });

    if (req.method === 'GET' && route === '/printers') {
      try { return reply(200, { ok: true, printers: await listPrinters() }); }
      catch (error) { return reply(502, { ok: false, error: `Could not list the printers on this computer: ${error.message}` }); }
    }

    if (req.method === 'POST' && route === '/print') {
      let job;
      try { job = JSON.parse(await readBody(req)); } catch { return reply(400, { ok: false, error: 'That was not a print job' }); }
      const bytes = Buffer.from(String(job.data ?? ''), 'base64');
      if (!bytes.length) return reply(400, { ok: false, error: 'There was nothing to print' });
      if (bytes.length > MAX_BYTES) return reply(413, { ok: false, error: 'That job is too big' });
      try { await sender(String(job.target ?? ''), bytes); return reply(200, { ok: true, bytes: bytes.length }); }
      catch (error) { return reply(502, { ok: false, error: error.message }); }
    }
    return reply(404, { ok: false, error: 'Not found' });
  });
};

/* Run it: node agent.js */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT || 9101);
  // ORIGINS from the environment, else from .origins beside the agent (the Windows installer writes it)
  let originsText = process.env.ORIGINS || '';
  if (!originsText) { try { originsText = fs.readFileSync(fileURLToPath(new URL('./.origins', import.meta.url)), 'utf8'); } catch { /* none */ } }
  const origins = originsText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  // No TOKEN given: make one once and keep it in .token beside the agent, so starting it is just `node agent.js`
  let token = process.env.TOKEN;
  if (!token) {
    const file = fileURLToPath(new URL('./.token', import.meta.url));
    try { token = fs.readFileSync(file, 'utf8').trim(); } catch { token = ''; }
    if (token.length < 8) { token = crypto.randomBytes(12).toString('hex'); fs.writeFileSync(file, token); }
    console.log(`Token (enter it once in FlowXP, Business settings): ${token}`);
  }
  let server;
  try { server = createAgent({ token, origins: origins.length ? origins : ['*'] }); }
  catch (error) { console.error(`FlowXP print agent: ${error.message}`); process.exit(1); }
  server.listen(port, '127.0.0.1', () => console.log(`FlowXP print agent ${VERSION} listening on http://127.0.0.1:${port} (${origins.length ? origins.join(', ') : 'any website with the token'})`));
}
