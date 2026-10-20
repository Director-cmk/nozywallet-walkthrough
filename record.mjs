// Screen-records the real NozyWallet extension (latest release) in Edge.
//   node record.mjs A   install page -> connect -> create -> back up -> verify -> home -> receive
//   node record.mjs B   unlock -> home with funds -> send to own address -> review -> broadcast -> activity
// Frames: rec/<phase>/f-<ms>.jpg (1080x1920). Events: rec/<phase>/events.json (taps, markers, blur rects in CSS px).
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)));
const EXT = path.join(here, '..', 'nozy-ext-dl', 'ext', 'nozy-extension');
const PHASE = process.argv[2] || 'A';
const OUT = path.join(here, 'rec', PHASE);
const PASSWORD = 'demo-throwaway-2026';
const STORE = 'https://chromewebstore.google.com/detail/nozywallet/kjbpoimgafbikmachlilkhoamdlnhooj';
const SEND_AMOUNT = process.env.SEND_AMOUNT || '0.001';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, enableExtensions: [EXT], pipe: true, userDataDir: path.join(here, 'profile'),
});
await sleep(2000);
const id = new URL(browser.targets().find(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://')).url()).host;
const POPUP = `chrome-extension://${id}/wasm-core/popup/dist/index.html`;

const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
// Headless Edge ignores deviceScaleFactor for capture, so lay out at 400 CSS px and paint at 2.7x with CSS zoom.
await page.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '2.7'; }); });

// --- recording -------------------------------------------------------------
const t0 = Date.now();
const now = () => Date.now() - t0;
const events = [];
const log = (type, data = {}) => { events.push({ t: now(), type, ...data }); };
const cdp = await page.createCDPSession();
let frames = 0;
cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
  writeFileSync(path.join(OUT, `f-${String(now()).padStart(7, '0')}.jpg`), Buffer.from(data, 'base64'));
  frames++;
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });

// --- interaction helpers ---------------------------------------------------
const rectOf = sel => page.evaluate(s => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, sel);
async function tap(text, after = 1200) {
  const r = await page.evaluate(t => {
    const els = [...document.querySelectorAll('button,a,[role=button],[role=tab]')].filter(e => e.offsetParent);
    const el = els.find(e => e.innerText.trim() === t) || els.find(e => e.innerText.trim().startsWith(t));
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, text);
  if (!r) throw new Error(`Button not found: ${text}`);
  await sleep(350);
  log('tap', { label: text, x: r.x + r.w / 2, y: r.y + r.h / 2, rect: r });
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await sleep(after);
}
async function typeInto(sel, text, label, delay = 55) {
  await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
  await sleep(250);
  const r = await rectOf(sel);
  log('tap', { label, x: r.x + r.w / 2, y: r.y + r.h / 2, rect: r });
  await page.click(sel);
  log('typing', { label, rect: r });
  await page.type(sel, text, { delay });
  await sleep(500);
}
const waitText = async (re, timeout = 120000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(src => new RegExp(src, 'i').test(document.body.innerText), re.source)) return true;
    await sleep(500);
  }
  return false;
};
const bodyText = () => page.evaluate(() => document.body.innerText);

// --- phases ----------------------------------------------------------------
await startCast();

if (PHASE === 'A') {
  log('mark', { name: 'install' });
  await page.goto(STORE, { waitUntil: 'networkidle2' }).catch(() => {});
  await sleep(3500);
  const store = (await bodyText()).replace(/\n+/g, ' / ');
  log('info', { storeVersion: (store.match(/Version\s*\/?\s*([\d.]+)/i) || [])[1] || null });
  await page.evaluate(() => window.scrollBy({ top: 260, behavior: 'smooth' }));
  await sleep(2500);

  log('mark', { name: 'open' });
  await page.goto(POPUP, { waitUntil: 'networkidle0' });
  await sleep(2500);

  log('mark', { name: 'connect' });
  await tap('NozyWallet', 1500);
  await waitText(/connected/, 30000);
  if (/Yes — NozyWallet/.test(await bodyText())) await tap('Yes — NozyWallet', 1500);
  if (/Connect NozyWallet/.test(await bodyText())) await tap('Connect NozyWallet', 2500);
  await waitText(/Connected/, 30000);
  await sleep(1500);

  log('mark', { name: 'create' });
  await tap('Create', 1200);
  await typeInto("input[placeholder='Encrypts this copy on Chrome']", PASSWORD, 'password', 70);
  await tap('Create wallet', 500);
  await waitText(/Backup your wallet/, 60000);
  await sleep(1500);

  log('mark', { name: 'backup' });
  await tap('Tap to reveal recovery phrase', 300);
  const seedRect = await rectOf('ol.grid');
  log('blur', { name: 'seed', rect: seedRect, until: 'verify' });
  const words = await page.$$eval('ol.grid li span.font-semibold', s => s.map(e => e.textContent.trim()));
  if (words.length !== 24) throw new Error('Expected 24 seed words, got ' + words.length);
  await sleep(3500);
  log('mark', { name: 'verify' });
  await tap('I’ve saved it — verify', 1500);
  const asks = await page.evaluate(() => [...document.body.innerText.matchAll(/Word #(\d+)/g)].map(m => +m[1]));
  // The verify screen shows candidate words for a few positions; blur it too so no seed words appear.
  log('blur', { name: 'verify-words', rect: await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => /^Word #\d+$/.test(e.textContent.trim()));
    const a = els[0].getBoundingClientRect(); const lastRow = els[els.length - 1].nextElementSibling ?? els[els.length - 1];
    const b = lastRow.getBoundingClientRect();
    return { x: a.x - 16, y: a.y - 16, w: 940, h: b.bottom - a.y + 32 };
  }), until: 'home' });
  for (const k of asks) {
    // click the correct candidate button within that word's row
    const r = await page.evaluate((k, w) => {
      const lab = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === `Word #${k}`);
      const row = lab.nextElementSibling;
      const btn = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === w);
      const q = btn.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height };
    }, k, words[k - 1]);
    log('tap', { label: 'word', x: r.x + r.w / 2, y: r.y + r.h / 2, rect: r, hideLabel: true });
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await sleep(700);
  }
  words.length = 0;
  await tap('Continue', 500);
  await waitText(/AVAILABLE/, 60000);
  log('mark', { name: 'home' });
  await sleep(4000);

  log('mark', { name: 'receive' });
  await tap('Receive', 2000);
  const addr = (await bodyText()).match(/u1[0-9a-z]{60,}/)?.[0];
  log('zoom', { name: 'address', rect: await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => /^u1[0-9a-z]{60,}$/.test(e.textContent.trim()) && !e.children.length);
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }) });
  await sleep(3000);
  await tap('Copy address', 2500);
  writeFileSync(path.join(OUT, 'address.txt'), addr + '\n');
  console.log('RECEIVE ADDRESS', addr);
}

if (PHASE === 'B') {
  await page.goto(POPUP, { waitUntil: 'networkidle0' });
  await sleep(2500);
  log('mark', { name: 'unlock' });
  if (await page.$("input[type='password']")) {
    await typeInto("input[type='password']", PASSWORD, 'password', 60);
    const t = await bodyText();
    await tap(/Unlock/.test(t) ? 'Unlock' : 'Continue', 3000);
  }
  await waitText(/AVAILABLE/, 60000);
  log('mark', { name: 'funded' });
  // wait for sync to surface the deposit (NO_FUNDS=1 records the unfunded flow instead)
  const NO_FUNDS = !!process.env.NO_FUNDS;
  const start = Date.now();
  while (!NO_FUNDS && Date.now() - start < 15 * 60_000) {
    const m = (await bodyText()).match(/([\d.]+)\s*ZEC/);
    if (m && parseFloat(m[1]) > 0) break;
    await sleep(3000);
  }
  log('mark', { name: 'balance' });
  await sleep(3500);

  log('mark', { name: 'send' });
  await tap('Send', 1800);
  const own = (await page.evaluate(() => document.body.innerText)).match(/u1[0-9a-z]{6,}…[0-9a-z]+/)?.[0];
  const addr = process.env.SEND_TO;
  await typeInto("input[placeholder^='u1']", addr, 'recipient', 12);
  await typeInto("input[placeholder='0.00']", SEND_AMOUNT, 'amount', 120);
  await typeInto('textarea', 'My first shielded transaction', 'memo', 45);
  await sleep(1200);
  log('mark', { name: 'review' });
  await tap('Review transaction', 1000);
  if (NO_FUNDS) {
    // Capture exactly what the wallet reports for an empty wallet, then stop. Nothing is confirmed or broadcast.
    await sleep(12000);
    console.log('REVIEW (no funds)>', (await bodyText()).replace(/\n+/g, ' / ').slice(0, 1200));
    log('mark', { name: 'activity' });
    await tap('Home', 3000);
    await sleep(3000);
  } else {
  // proving can take a while
  await waitText(/Confirm|Send now|Broadcast|Fee/, 180000);
  await sleep(4000);
  console.log('REVIEW>', (await bodyText()).replace(/\n+/g, ' / ').slice(0, 900));
  log('mark', { name: 'confirm' });
  const t = await bodyText();
  const confirmLabel = ['Confirm and send', 'Confirm & send', 'Send now', 'Broadcast', 'Confirm', 'Send ZEC'].find(l => t.includes(l));
  if (!confirmLabel) throw new Error('No confirm button found');
  await tap(confirmLabel, 1000);
  await waitText(/txid|Transaction ID|Sent|Broadcast|submitted/, 180000);
  await sleep(4000);
  console.log('AFTER SEND>', (await bodyText()).replace(/\n+/g, ' / ').slice(0, 900));
  log('mark', { name: 'activity' });
  if (await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Home'))) await tap('Home', 3000);
  await sleep(5000);
  console.log('HOME>', (await bodyText()).replace(/\n+/g, ' / ').slice(0, 900));
  }
}

log('end');
await cdp.send('Page.stopScreencast');
await sleep(300);
writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1));
console.log(`phase ${PHASE}: ${frames} frames, ${(now() / 1000).toFixed(1)} s`);
await browser.close();
