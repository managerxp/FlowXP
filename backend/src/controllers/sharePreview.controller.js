/*
 * What WhatsApp, LinkedIn and others show when a booking link is pasted. They read the page's HTML without running any script, so the web
 * server sends /book/<address> and /reserve/<address> here (deploy/nginx.conf): the built index.html goes back with the business's own
 * name in the title and its logo as the picture. People's browsers get the same app as before.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import config from '../config/env.js';
import { resolve as salonBy } from './salonPublic.controller.js';
import { resolve as reserveBy } from './reservationPublic.controller.js';

const find = { book: salonBy, reserve: reserveBy };
const here = path.dirname(fileURLToPath(import.meta.url));
const uploads = () => path.join(process.cwd(), 'uploads');
const indexFile = () => process.env.FRONTEND_DIST_INDEX || path.resolve(here, '../../../frontend/dist/index.html');

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const withPreview = (html, { title, description, url, site, image }) => {
  const tags = [
    ['property', 'og:title', title], ['property', 'og:description', description], ['property', 'og:type', 'website'], ['property', 'og:url', url],
    ['property', 'og:site_name', site], ['name', 'description', description], ['name', 'twitter:card', image ? 'summary_large_image' : 'summary'],
    ...(image ? [['property', 'og:image', image], ['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630']] : [])
  ].map(([kind, key, value]) => `<meta ${kind}="${key}" content="${esc(value)}" />`).join('\n    ');
  // functions as replacements: a "$" in a business name must stay a "$"
  return html
    .replace(/\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>/g, '')
    .replace(/\s*<link rel="canonical"[^>]*>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>\n    ${tags}`);
};

/* GET /share/:kind/:slug */
export const page = async (req, res) => {
  const { kind, slug } = req.params;
  let html;
  try { html = await fs.readFile(indexFile(), 'utf8'); } catch { return res.status(503).type('text/plain').send('Page not built'); }   // nginx then serves the plain file
  const biz = await find[kind](slug);
  if (biz) {
    const url = `${config.appOrigin.replace(/\/$/, '')}/${kind}/${encodeURIComponent(slug.toLowerCase())}`;
    const where = [biz.address, biz.city].filter(Boolean).join(', ');
    html = withPreview(html, {
      title: kind === 'book' ? `Book an appointment at ${biz.name}` : `Reserve a table at ${biz.name}`,
      description: `${kind === 'book' ? 'Pick your service, day and time online.' : 'Pick your day and time online.'}${where ? ` ${where}` : ''}`,
      url, site: biz.name,
      // the ?v= changes with the logo, so an app that remembers the old picture fetches the new one
      image: biz.logo_url ? `${url}/image.jpg?v=${encodeURIComponent(biz.logo_url.split('/').pop())}` : null
    });
  }
  res.set('Cache-Control', 'no-cache').type('html').send(html);
};

const logoBytes = async (url) => {
  if (url.startsWith('/uploads/')) {
    const file = path.join(uploads(), url.slice('/uploads/'.length));
    return file.startsWith(uploads() + path.sep) ? fs.readFile(file) : null;   // never outside the uploads folder
  }
  if (!url.startsWith('https://')) return null;
  const got = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return got.ok ? Buffer.from(await got.arrayBuffer()) : null;
};

/* GET /share/:kind/:slug/image.jpg : the logo on a white card, as a JPEG at the size link previews expect (some of them cannot show WebP) */
export const image = async (req, res) => {
  const biz = await find[req.params.kind](req.params.slug);
  if (!biz?.logo_url) return res.status(404).end();
  try {
    const source = await logoBytes(biz.logo_url);
    if (!source) return res.status(404).end();
    // kept inside the middle square, which is what survives when an app crops the card to a thumbnail
    const logo = await sharp(source).resize(520, 520, { fit: 'inside' }).png().toBuffer();
    const card = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ffffff' } }).composite([{ input: logo, gravity: 'centre' }]).jpeg({ quality: 85 }).toBuffer();
    res.set({ 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' }).type('jpg').send(card);
  } catch (error) {
    console.error('[share] preview picture failed:', error.message);
    res.status(404).end();
  }
};
