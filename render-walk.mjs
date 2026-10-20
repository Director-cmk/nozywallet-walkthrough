// Edits the real recordings (rec/A, rec/I, rec/B) into a 90 s 9:16 walkthrough with voiceover.
//   node render-walk.mjs                  -> out/nozywallet-walkthrough-9x16.mp4
//   node render-walk.mjs --stills 3,20    -> out/still-*.jpg
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import ffmpegPath from 'ffmpeg-static';

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)));
const out = path.join(here, 'out'); mkdirSync(out, { recursive: true });
const FPS = 30, TARGET = 90, HOOK_EXTRA = 0.8, END_CARD = 4.5;
const args = process.argv.slice(2);
const stills = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;

// ---- plan ------------------------------------------------------------------
const script = JSON.parse(readFileSync(path.join(here, 'script.json'), 'utf8'));
const wavDur = id => (readFileSync(path.join(here, 'audio', id + '.wav')).length - 44) / 96000;
const frames = {}, events = {};
for (const ph of ['A', 'I', 'B']) {
  const dir = path.join(here, 'rec', ph);
  if (!existsSync(path.join(dir, 'events.json'))) continue;
  frames[ph] = readdirSync(dir).filter(f => f.startsWith('f-')).map(f => +f.slice(2, 9)).sort((a, b) => a - b);
  events[ph] = JSON.parse(readFileSync(path.join(dir, 'events.json'), 'utf8'));
}
const markT = (ph, name) => {
  if (name === 'end') return events[ph].at(-1).t;
  const e = events[ph].find(e => e.type === 'mark' && e.name === name);
  if (!e) throw new Error(`marker ${ph}/${name} missing`);
  return e.t;
};
const speech = script.reduce((n, l) => n + wavDur(l.id), 0);
const pad = (TARGET - speech - HOOK_EXTRA - END_CARD) / script.length;
const LEAD = pad * .35;
let t = 0;
const segments = script.map(l => {
  const sd = wavDur(l.id);
  const extra = l.id === 'hook' ? HOOK_EXTRA : 0;
  const dur = sd + pad + extra + (l.id === 'outro' ? END_CARD : 0);
  const [phase, from, to] = l.src;
  const s = { ...l, phase, start: t, dur, speechStart: LEAD + extra, speechDur: sd, available: !!events[phase] };
  if (s.available) { s.a = markT(phase, from); s.b = markT(phase, to); }
  t += dur;
  return s;
});
const missing = segments.filter(s => !s.available).map(s => s.id);
if (missing.length && !stills) throw new Error('Missing recordings for: ' + missing.join(', ') + ' (record phase B first)');
const PLAN = { segments: segments.filter(s => s.available), frames, events, total: t };
console.log(`total ${t.toFixed(2)} s, speech ${speech.toFixed(1)} s`);
for (const s of segments) console.log(`  ${s.start.toFixed(1).padStart(5)}  ${s.id.padEnd(8)} ${s.dur.toFixed(1)} s` + (s.available ? `  src ${((s.b - s.a) / 1000).toFixed(1)} s (${((s.b - s.a) / 1000 / s.dur).toFixed(1)}x)` : '  [not recorded]'));

// ---- SRT with the same chunking as the burned-in captions -------------------
const stamp = x => { const ms = Math.round(x * 1000); const h = String(Math.floor(ms / 3600000)).padStart(2, '0'); const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'); const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`; };
const srt = []; let n = 1;
for (const s of segments) {
  const chunks = []; let cur = [];
  for (const w of s.say.split(' ')) { cur.push(w); if (cur.join(' ').length > 24 || /[.,;]$/.test(w) && cur.join(' ').length > 12) { chunks.push(cur.join(' ')); cur = []; } }
  if (cur.length) chunks.push(cur.join(' '));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  let acc = s.start + s.speechStart;
  for (const c of chunks) { const d = s.speechDur * c.length / total; srt.push(`${n++}\n${stamp(acc)} --> ${stamp(acc + d)}\n${c}\n`); acc += d; }
}
writeFileSync(path.join(out, 'nozywallet-walkthrough.srt'), srt.join('\n'));

// ---- static server for frames + page ---------------------------------------
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(here) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'image/jpeg' });
  createReadStream(p).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, pipe: true });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920 });
await page.goto(`${base}/compose.html`, { waitUntil: 'networkidle0' });
await page.evaluate(async plan => { window.PLAN = plan; await window.__ready; }, PLAN);
const grab = async sec => { const u = await page.evaluate(x => window.__seek(x), sec); return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'); };

if (stills) {
  for (const s of stills) writeFileSync(path.join(out, `still-${s}.jpg`), await grab(s));
  console.log('stills in', out);
} else {
  // voice track: each line placed at its segment's speech start
  const voice = path.join(out, 'voice.wav');
  const inputs = segments.flatMap(s => ['-i', path.join(here, 'audio', s.id + '.wav')]);
  const delays = segments.map((s, i) => `[${i}:a]adelay=${Math.round((s.start + s.speechStart) * 1000)}:all=1,aresample=48000[a${i}]`).join(';');
  const mix = segments.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${segments.length}:normalize=0,apad,atrim=0:${t.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  await new Promise((res, rej) => spawn(ffmpegPath, ['-y', ...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[out]', '-ar', '48000', voice], { stdio: 'ignore' })
    .on('close', c => c === 0 ? res() : rej(new Error('audio mix failed'))));

  const file = path.join(out, 'nozywallet-walkthrough-9x16.mp4');
  const ff = spawn(ffmpegPath, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', voice,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', file],
  { stdio: ['pipe', 'ignore', 'inherit'] });
  const total = Math.round(t * FPS);
  for (let i = 0; i < total; i++) {
    const buf = await grab(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 450 === 0) console.log(`frame ${i}/${total}`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
  console.log('wrote', file);
}
await browser.close();
server.close();
