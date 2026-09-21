// Local server for Jev Chat (listens on 127.0.0.1 only, so it is reachable from this PC only)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

const PORT = 3939;
const MODEL = 'typesafe-ai/jev';
const MIN_BALANCE_USD = 0.001; // refuse to send once the free credits are used up
const LEDGER = new URL('./usage-ledger.json', import.meta.url);
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const scriptPath = (name) => fileURLToPath(new URL(`./scripts/windows/${name}`, import.meta.url));

function loadLedger() {
  try { const l = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); return { chargedUsd: 0, marketUsd: 0, ...l }; }
  catch { return { totalInputTokens: 0, chargedUsd: 0, marketUsd: 0, calls: 0 }; }
}

const DEFAULT_QUESTION = {
  boolean: 'Is this statement correct?',
  choice: 'Which option fits best?',
  score: 'Which level applies?',
};

// Actual (free) credit balance on Vercel, cached for 60 seconds
let creditsCache = null, creditsAt = 0, creditsKey = '';
async function getCredits(apiKey, force = false) {
  if (!apiKey) return null;
  if (!force && creditsCache && creditsKey === apiKey && Date.now() - creditsAt < 60_000) return creditsCache;
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return creditsCache;
    const j = await r.json();
    creditsCache = { balance: Number(j.balance), used: Number(j.total_used) };
    creditsAt = Date.now();
    creditsKey = apiKey;
  } catch {}
  return creditsCache;
}

function buildQuestion({ question, kind, options }) {
  const opts = String(options ?? '').split(/[,、，\n]/).map(s => s.trim()).filter(Boolean);
  if (kind === 'choice') {
    if (opts.length < 2) throw new Error('Enter at least two options, separated by commas.');
    return { type: 'choice', instructions: question, criteria: Object.fromEntries(opts.map(o => [o, null])) };
  }
  if (kind === 'score') {
    const levels = opts.length >= 2 ? opts : ['Low', 'Medium', 'High'];
    return { type: 'score', instructions: question, criteria: levels };
  }
  return { type: 'boolean', instructions: question };
}

function runPowerShell(script, args, maxBuffer) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(script), ...args],
      { encoding: 'utf8', maxBuffer },
      (err, stdout, stderr) => (err ? reject(new Error(stderr?.trim() || err.message)) : resolve(stdout)));
  });
}

// Read text from an image with the built-in Windows OCR (no internet connection needed)
async function ocrImage(buffer, ext) {
  const file = path.join(os.tmpdir(), `jev-ocr-${Date.now()}.${ext || 'png'}`);
  fs.writeFileSync(file, buffer);
  try {
    return await runPowerShell('ocr.ps1', ['-Path', file], 20 * 1024 * 1024);
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

// Render each PDF page to PNG with the built-in Windows PDF renderer; returns the page count
async function pdfToPng(pdfPath, outDir) {
  const out = await runPowerShell('pdf2png.ps1', ['-Path', pdfPath, '-OutDir', outDir], 10 * 1024 * 1024);
  return Number(String(out).trim().split(/\r?\n/)[0]);
}

// Rendered PDF pages are kept temporarily and removed after 30 minutes
const pdfJobs = new Map();
function cleanJobs() {
  const now = Date.now();
  for (const [id, job] of pdfJobs) {
    if (now - job.at > 30 * 60 * 1000) {
      pdfJobs.delete(id);
      try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch {}
    }
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// Exit automatically when the page stops pinging (i.e. the window was closed)
const IDLE_EXIT_MS = 3 * 60 * 1000;
let lastSeen = Date.now();
setInterval(() => { if (Date.now() - lastSeen > IDLE_EXIT_MS) process.exit(0); }, 30 * 1000);

const server = http.createServer(async (req, res) => {
  lastSeen = Date.now();
  if (req.url === '/api/ping') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/api/usage') {
    const apiKey = (req.headers['x-api-key'] || '').toString();
    return send(res, 200, { ...loadLedger(), credits: await getCredits(apiKey) });
  }

  // Receive a PDF and render its pages to images for OCR
  if (req.method === 'POST' && req.url === '/api/pdfprep') {
    const data = await readBody(req);
    try {
      cleanJobs();
      const id = `jev-pdf-${Date.now()}`;
      const dir = path.join(os.tmpdir(), id);
      fs.mkdirSync(dir, { recursive: true });
      const pdfPath = path.join(dir, 'src.pdf');
      fs.writeFileSync(pdfPath, data);
      const pages = await pdfToPng(pdfPath, dir);
      pdfJobs.set(id, { dir, at: Date.now() });
      return send(res, 200, { id, pages });
    } catch (e) {
      return send(res, 400, { error: 'Could not convert the PDF to images. ' + (e?.message ?? '') });
    }
  }

  // OCR one rendered PDF page
  if (req.method === 'GET' && req.url.startsWith('/api/pdfpage')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const job = pdfJobs.get(q.get('id') ?? '');
    if (!job) return send(res, 400, { error: 'PDF job not found. Please load the file again.' });
    try {
      const file = path.join(job.dir, `p${String(Number(q.get('page'))).padStart(4, '0')}.png`);
      const text = await ocrImage(fs.readFileSync(file), 'png');
      job.at = Date.now();
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 400, { error: 'Could not read the page. ' + (e?.message ?? '') });
    }
  }

  if (req.method === 'POST' && req.url === '/api/ocr') {
    const data = await readBody(req);
    try {
      const ext = (req.headers['x-file-ext'] || 'png').toString().replace(/[^a-z0-9]/gi, '').slice(0, 5);
      return send(res, 200, { text: await ocrImage(data, ext) });
    } catch (e) {
      return send(res, 400, { error: 'Could not read text from the image. ' + (e?.message ?? '') });
    }
  }

  if (req.method === 'POST' && req.url === '/api/evaluate') {
    const raw = (await readBody(req)).toString('utf8');
    try {
      const apiKey = (req.headers['x-api-key'] || '').toString().trim();
      if (!apiKey) throw new Error('No API key set. Use "API key" at the top right to set one.');
      const gateway = createGateway({ apiKey });
      const body = JSON.parse(raw);
      let state = body.state?.trim() ?? '';
      // Questions arrive as an array; Jev can answer several in a single call
      const asked = (body.questions ?? [{ question: body.question, kind: body.kind, options: body.options }])
        .map(q => ({ question: (q.question ?? '').trim(), kind: q.kind, options: q.options }))
        .filter((q, i, arr) => q.question || arr.length === 1);
      if (!asked.length) throw new Error('Please enter a question.');
      if (!state && !asked[0].question) throw new Error('Please enter some text or a question.');
      for (const q of asked) if (!q.question) q.question = DEFAULT_QUESTION[q.kind] ?? DEFAULT_QUESTION.boolean;
      if (!state) state = asked[0].question;

      const ledger = loadLedger();
      const credits = await getCredits(apiKey);
      if (credits && credits.balance < MIN_BALANCE_USD) {
        throw new Error('Stopped: your free credits are used up (you will not be charged).');
      }
      const questions = {};
      asked.forEach((q, i) => { questions['q' + i] = buildQuestion(q); });

      let result = null, perQuestion = null;
      try {
        result = await evaluate({ model: gateway.evaluationModel(MODEL), state, questions });
      } catch (e) {
        // If Jev cannot decide one question, the whole call fails; retry the questions one by one
        if (asked.length === 1 || !/highest-probability|did not select/i.test(e?.message ?? '')) throw e;
        perQuestion = [];
        for (let i = 0; i < asked.length; i++) {
          try {
            const one = await evaluate({ model: gateway.evaluationModel(MODEL), state, questions: { ['q' + i]: questions['q' + i] } });
            perQuestion.push(one.answers['q' + i]);
          } catch {
            perQuestion.push(null); // this question could not be decided
          }
        }
      }

      const answers = asked.map((q, i) => {
        const a = result ? result.answers['q' + i] : perQuestion[i];
        if (a && questions['q' + i].type === 'score') a.levels = questions['q' + i].criteria;
        return { question: q.question, answer: a };
      });
      const gw = result?.providerMetadata?.gateway ?? {};
      const cost = Number(gw.cost ?? 0);             // amount actually charged
      const marketCost = Number(gw.marketCost ?? 0); // list price before discounts
      ledger.totalInputTokens += result?.usage?.inputTokens ?? 0;
      ledger.chargedUsd = (ledger.chargedUsd ?? 0) + cost;
      ledger.marketUsd = (ledger.marketUsd ?? 0) + marketCost;
      ledger.calls += 1;
      fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      return send(res, 200, { answers, tokens: result?.usage?.inputTokens ?? 0, cost, marketCost,
        usage: { ...ledger, credits: await getCredits(apiKey, true) } });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (/quota_for_entity_exceeded|budget exceeded/i.test(msg)) {
        return send(res, 400, { error: 'Stopped: your Vercel budget limit was reached (you will not be charged).' });
      }
      if (/credit|402/i.test(msg)) {
        return send(res, 400, { error: 'Stopped: no free credits left (you will not be charged).' });
      }
      return send(res, 400, { error: msg });
    }
  }

  if (req.method === 'GET' && serveStatic(req, res)) return;
  res.writeHead(404); res.end();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Already running: just open the page
    if (!process.env.NO_OPEN) exec(`start "" http://localhost:${PORT}`);
    process.exit(0);
  } else throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jev Chat is running at http://localhost:${PORT} (close this window to stop)`);
  if (!process.env.NO_OPEN) exec(`start "" http://localhost:${PORT}`);
});
