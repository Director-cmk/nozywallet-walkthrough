// Records the install step: Chrome Web Store listing, then the GitHub "Latest" release. Output: rec/I/
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)));
const OUT = path.join(here, 'rec', 'I'); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, pipe: true, userDataDir: path.join(here, 'profile-install') });
const p = await b.newPage(); await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await p.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '2.7'; }); });
await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0');
// Decline Google cookie consent before recording.
await p.goto('https://chromewebstore.google.com/detail/nozywallet/kjbpoimgafbikmachlilkhoamdlnhooj', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await p.evaluate(() => { const r = [...document.querySelectorAll('button')].find(x => /Reject all/i.test(x.innerText)); r?.click(); });
await p.waitForNetworkIdle({ timeout: 20000 }).catch(() => {}); await sleep(3000);
// Dismiss the store's "Switch to Chrome?" prompt before recording.
await p.evaluate(() => { const r = [...document.querySelectorAll('button,a')].find(x => /^No thanks$/i.test(x.innerText.trim())); r?.click(); }); await sleep(1500);
const t0 = Date.now(); const now = () => Date.now() - t0; const events = []; const log = (type, d = {}) => events.push({ t: now(), type, ...d });
const cdp = await p.createCDPSession(); let n = 0;
cdp.on('Page.screencastFrame', ({ data, sessionId }) => { writeFileSync(path.join(OUT, `f-${String(now()).padStart(7, '0')}.jpg`), Buffer.from(data, 'base64')); n++; cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92 });
log('mark', { name: 'store' });
const st = await p.evaluate(() => document.body.innerText.replace(/\n+/g, ' / '));
console.log('STORE>', st.slice(0, 600));
log('info', { storeVersion: (st.match(/Version\s*\/?\s*([\d.]+)/i) || [])[1] || null });
const add = await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(x => /Add to (Chrome|Microsoft Edge)|Get/i.test(x.innerText)); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, label: el.innerText.trim() }; });
console.log('ADD BUTTON', add);
await sleep(3000);
if (add) { log('tap', { label: add.label, x: add.x + add.w / 2, y: add.y + add.h / 2, rect: add, fake: true }); await sleep(1500); }
await p.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' })); await sleep(2500);
log('mark', { name: 'github' });
await p.goto('https://github.com/LEONINE-DAO/Nozy-wallet/releases/tag/extension-v2.0.3', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await sleep(3500);
await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /nozy-extension-chromium-2\.0\.3\.zip/.test(x.innerText)); a?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); await sleep(2500);
const z = await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /nozy-extension-chromium-2\.0\.3\.zip/.test(x.innerText)); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
if (z) log('tap', { label: 'zip', x: z.x + z.w / 2, y: z.y + z.h / 2, rect: z, fake: true });
await sleep(2500);
log('end'); await cdp.send('Page.stopScreencast'); await sleep(300);
writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1));
console.log('frames', n, (now() / 1000).toFixed(1), 's'); await b.close();
