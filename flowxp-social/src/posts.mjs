/*
 * The five FlowXP posts: 1080 x 1350, one idea each, every screen a real crop of the running app
 * (flowxp-social/screenshots, captured from the demo restaurant). Crops are cut with overflow, never stretched.
 *
 *   node posts.mjs            renders posts/01..05.png (needs playwright-core and Chrome; see prep notes in the report)
 *
 * crop(): x,y,w,h are source pixels of the screenshot; s is canvas pixels per source pixel.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = pathToFileURL(path.join(ROOT, 'screenshots')).href;
const LOGO = pathToFileURL(path.join(ROOT, 'src/assets/logo-reversed.png')).href;
const SRC_W = 2880;

const crop = ({ img, x, y, w, h, s, left, top, radius = 18, id = '', extra = '' }) => `
  <div class="win" ${id ? `id="${id}"` : ''} style="left:${left}px;top:${top}px;width:${Math.round(w * s)}px;height:${Math.round(h * s)}px;border-radius:${radius}px;${extra}">
    <img src="${SHOTS}/${img}" style="width:${Math.round(SRC_W * s)}px;left:${-Math.round(x * s)}px;top:${-Math.round(y * s)}px">
  </div>`;
const chip = (text, left, top, { w = '', tone = 'cyan' } = {}) => `<div class="chip ${tone}" style="left:${left}px;top:${top}px;${w ? `width:${w}px;` : ''}">${text}</div>`;

const frame = ({ n, headline, sub, subTop, body, note = 'Sample data from the FlowXP demo restaurant.' }) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --bg:#060913; --blue:#0054FA; --cyan:#36d1ff; --violet:#8b6cff; --mint:#3ee0a8; }
  * { box-sizing: border-box; }
  body { margin:0; width:1080px; height:1350px; background:var(--bg); font-family:'Plus Jakarta Sans',system-ui,sans-serif; color:#fff; position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  .glow1 { position:absolute; right:-240px; top:-280px; width:900px; height:900px; background:radial-gradient(closest-side, rgba(0,84,250,.50), rgba(0,84,250,0)); }
  .glow2 { position:absolute; left:-300px; bottom:-300px; width:900px; height:900px; background:radial-gradient(closest-side, rgba(139,108,255,.30), rgba(139,108,255,0)); }
  .glow3 { position:absolute; right:-200px; bottom:120px; width:600px; height:600px; background:radial-gradient(closest-side, rgba(54,209,255,.14), rgba(54,209,255,0)); }
  .logo { position:absolute; left:58px; top:44px; height:72px; }
  .count { position:absolute; right:64px; top:68px; font-size:22px; font-weight:600; color:rgba(255,255,255,.5); letter-spacing:.02em; }
  h1 { position:absolute; left:64px; top:140px; width:952px; margin:0; font-weight:800; font-size:80px; line-height:1.03; letter-spacing:-.035em; }
  h1 em { font-style:normal; color:var(--cyan); }
  .sub { position:absolute; left:64px; width:860px; font-size:29px; line-height:1.38; font-weight:500; color:rgba(255,255,255,.76); }
  .win { position:absolute; overflow:hidden; background:#fff; box-shadow:0 34px 90px rgba(0,0,0,.6), 0 0 0 1.5px rgba(255,255,255,.16); }
  .win img { position:absolute; display:block; max-width:none; }
  .chip { position:absolute; padding:12px 20px; border-radius:16px; font-weight:700; font-size:22px; line-height:1.25; background:rgba(9,15,32,.92); border:1.5px solid rgba(54,209,255,.5); box-shadow:0 14px 40px rgba(0,0,0,.5); }
  .chip.mint { border-color:rgba(62,224,168,.55); }
  .chip.violet { border-color:rgba(139,108,255,.6); }
  .step { position:absolute; height:44px; min-width:44px; padding:0 18px 0 6px; border-radius:999px; background:var(--blue); font-weight:800; font-size:22px; display:flex; align-items:center; gap:10px; box-shadow:0 10px 30px rgba(0,84,250,.55); }
  .step b { width:32px; height:32px; border-radius:50%; background:#fff; color:var(--blue); display:flex; align-items:center; justify-content:center; font-size:19px; }
  .arrow { position:absolute; font-weight:800; color:var(--cyan); font-size:34px; line-height:1; }
  .cta { position:absolute; left:64px; bottom:60px; height:68px; padding:0 36px; border-radius:999px; background:var(--blue); font-weight:800; font-size:26px; display:flex; align-items:center; gap:12px; box-shadow:0 14px 44px rgba(0,84,250,.5); }
  .byline { position:absolute; right:64px; bottom:78px; font-size:21px; font-weight:600; color:rgba(255,255,255,.55); }
  .note { position:absolute; left:64px; bottom:24px; font-size:15px; font-weight:500; color:rgba(255,255,255,.38); }
</style></head><body>
  <div class="glow1"></div><div class="glow2"></div><div class="glow3"></div>
  <img class="logo" src="${LOGO}"><div class="count">${n} / 5</div>
  <h1>${headline}</h1>
  <div class="sub" style="top:${subTop}px">${sub}</div>
  ${body}
  <div class="cta">Book a demo <span style="font-size:28px">&rarr;</span></div>
  <div class="byline">FlowXP by ManagerXP</div>
  <div class="note">${note}</div>
</body></html>`;

const posts = [
  /* 1  the order's whole path */
  frame({
    n: 1, headline: 'The order doesn\u2019t<br>stop at the <em>till</em>.', subTop: 336,
    sub: 'From the table to the kitchen to the bill: one order, one flow.',
    body: [
      crop({ img: 'tables/tables-floor.png', x: 544, y: 785, w: 876, h: 302, s: 0.7, left: 64, top: 492 }),
      crop({ img: 'kitchen/kitchen-display.png', x: 544, y: 792, w: 796, h: 713, s: 0.66, left: 64, top: 726 }),
      crop({ img: 'pos/pos-bill-upi.png', x: 2095, y: 900, w: 770, h: 850, s: 0.55, left: 592, top: 690 }),
      `<div class="step" style="left:84px;top:470px"><b>1</b>Table</div>`,
      `<div class="step" style="left:84px;top:704px"><b>2</b>Kitchen</div>`,
      `<div class="step" style="left:612px;top:668px"><b>3</b>Bill</div>`,
      `<div class="arrow" style="left:330px;top:688px">&darr;</div>`
    ].join('')
  }),

  /* 2  multi-outlet */
  frame({
    n: 2, headline: 'One branch is easy.<br>What happens at <em>three</em>?', subTop: 330,
    sub: 'Compare every outlet side by side: orders, revenue, average bill and food cost.',
    body: [
      crop({ img: 'branches/outlets-compare.png', x: 544, y: 557, w: 1502, h: 193, s: 0.64, left: 64, top: 470 }),
      crop({ img: 'branches/outlets-compare.png', x: 544, y: 802, w: 1206, h: 350, s: 0.78, left: 64, top: 612 }),
      chip('Green is the best outlet on each measure, amber the weakest', 64, 912, { w: 560, tone: 'mint' }),
      chip('The menu is shared. Stock, tables, orders and staff belong to each outlet.', 64, 1004, { w: 640 }),
      crop({ img: 'dashboard/dashboard-all-outlets.png', x: 511, y: 14, w: 648, h: 87, s: 1.0, left: 64, top: 1104, radius: 16 }),
      `<div class="chip violet" style="left:736px;top:1088px;width:280px;font-size:20px;padding:10px 16px">Switch to <b>All outlets</b> for the whole business</div>`
    ].join('')
  }),

  /* 3  recipe cost and margin */
  frame({
    n: 3, headline: 'What does one biryani<br>really <em>cost</em> you?', subTop: 330,
    sub: 'Recipe cost, wastage and margin for every dish, from your own ingredient prices.',
    body: [
      crop({ img: 'menu/menu-products.png', x: 544, y: 1024, w: 1391, h: 364, s: 0.69, left: 64, top: 478 }),
      crop({ img: 'menu/menu-products.png', x: 2035, y: 886, w: 810, h: 674, s: 0.66, left: 64, top: 750 }),
      chip('Cost from the recipe, including wastage', 628, 770, { w: 388 }),
      chip('Margin shown for every dish on the menu list', 628, 888, { w: 388, tone: 'mint' }),
      chip('Ingredient cost follows the latest price you paid', 628, 1006, { w: 388, tone: 'violet' })
    ].join('')
  }),

  /* 4  Flow AI */
  frame({
    n: 4, headline: 'Ask your restaurant<br>a <em>question</em>.', subTop: 330,
    sub: 'Flow AI answers from your own records and shows what it looked at. It reads your figures. It can\u2019t change anything.',
    body: [
      crop({ img: 'ai/flow-ai-answer.png', x: 2128, y: 334, w: 690, h: 92, s: 0.66, left: 565, top: 478, radius: 28, extra: 'box-shadow:0 14px 40px rgba(0,84,250,.45);' }),
      crop({ img: 'ai/flow-ai-answer.png', x: 1040, y: 455, w: 1440, h: 605, s: 0.64, left: 64, top: 548 }),
      crop({ img: 'inventory/inventory-forecast.png', x: 544, y: 449, w: 1366, h: 48, s: 0.66, left: 64, top: 954, radius: 12 }),
      crop({ img: 'inventory/inventory-forecast.png', x: 544, y: 540, w: 1288, h: 275, s: 0.66, left: 64, top: 998 })
    ].join('')
  }),

  /* 5  QR ordering to the kitchen */
  frame({
    n: 5, headline: 'Scan. Order. Straight<br>to the <em>kitchen</em>.', subTop: 330,
    sub: 'Guests order from their phone. It lands on the table\u2019s tab and the kitchen sees it at once.',
    body: [
      `<div style="position:absolute;left:64px;top:500px;width:520px;height:690px;border-radius:58px 58px 0 0;background:#0d1426;box-shadow:0 34px 90px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.22);padding:14px 14px 0;overflow:hidden">
         <div style="position:relative;width:492px;height:676px;border-radius:46px 46px 0 0;overflow:hidden;background:#fff">
           <img src="${SHOTS}/qr/qr-menu-mobile-t6.png" style="position:absolute;left:0;top:0;width:492px;max-width:none">
         </div>
         <div style="position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(to bottom, rgba(6,9,19,0), rgba(6,9,19,.96))"></div>
       </div>`,
      chip('No app, no login. The guest scans the table QR.', 600, 500, { w: 416 }),
      crop({ img: 'kitchen/kitchen-with-qr-order.png', x: 544, y: 793, w: 814, h: 457, s: 0.56, left: 560, top: 606 }),
      `<div class="arrow" style="left:790px;top:884px">&darr;</div>`,
      chip('On the table\u2019s tab, ticket sent automatically', 600, 940, { w: 416, tone: 'mint' }),
      chip('Routed to the right kitchen station', 600, 1050, { w: 416, tone: 'violet' })
    ].join('')
  })
];

const names = ['01-the-order-doesnt-stop-at-the-till', '02-one-kitchen-three-outlets', '03-what-a-dish-really-costs', '04-ask-your-restaurant', '05-scan-order-kitchen'];
fs.mkdirSync(path.join(ROOT, 'src/html'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'posts'), { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (let i = 0; i < posts.length; i++) {
  if (only && !only.test(names[i])) continue;
  const file = path.join(ROOT, 'src/html', `${names[i]}.html`);
  fs.writeFileSync(file, posts[i]);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ROOT, 'posts', `${names[i]}.png`) });
  await page.close();
  console.log('rendered', names[i]);
}
await browser.close();
