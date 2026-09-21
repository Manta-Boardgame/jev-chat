// Reading-comprehension benchmarks for Jev, using the same request format as the app.
//
//   BoolQ   (yes/no questions over Wikipedia passages)       -> "Yes / No" answer type
//   QuALITY (4-option questions over long articles/stories)  -> "Multiple choice" answer type
//
// Usage (see benchmarks/README.md for how to get the data):
//   AI_GATEWAY_API_KEY=... node benchmarks/run.mjs --boolq path/to/BoolQ/val.jsonl \
//       --quality path/to/QuALITY.v1.0.1.htmlstripped.dev --n 100 --seed 42
import fs from 'node:fs';
import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) =>
  (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const N = Number(args.n ?? 100);
const SEED = Number(args.seed ?? 42);
const CONCURRENCY = Number(args.concurrency ?? 3);
const OUT = args.out ?? `benchmarks/results-${new Date().toISOString().slice(0, 10)}.json`;

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error('Set AI_GATEWAY_API_KEY');
const model = createGateway({ apiKey }).evaluationModel('typesafe-ai/jev');

// Deterministic sampling so results are reproducible
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function sample(items, n, seed) {
  const rand = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

async function ask(state, question) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    try {
      const r = await evaluate({ model, state, questions: { q: question } });
      const gw = r.providerMetadata?.gateway ?? {};
      return { answer: r.answers.q, tokens: r.usage.inputTokens ?? 0, ms: Date.now() - t0,
               cost: Number(gw.cost ?? 0), marketCost: Number(gw.marketCost ?? 0) };
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/highest-probability|did not select/i.test(msg)) return { answer: null, tokens: 0, ms: Date.now() - t0, cost: 0, marketCost: 0 };
      const transient = e?.isRetryable || /429|rate|timeout|ECONNRESET|unavailable|5\d\d/i.test(msg);
      if (attempt < 6 && transient) { await new Promise(r => setTimeout(r, 3000 * 2 ** attempt)); continue; }
      // Give up on this question but keep the run going; errors are reported separately
      return { answer: null, error: msg.split(/\r?\n/)[0].slice(0, 200), tokens: 0, ms: Date.now() - t0, cost: 0, marketCost: 0 };
    }
  }
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 10 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }));
  return out;
}

function summarize(name, allRows, chance) {
  const rows = allRows.filter(r => !r.error);
  const correct = rows.filter(r => r.correct).length;
  const s = {
    benchmark: name, n: rows.length, errors: allRows.length - rows.length, correct,
    accuracy: +(correct / rows.length).toFixed(3), chance,
    noAnswer: rows.filter(r => r.predicted === null).length,
    avgInputTokens: Math.round(rows.reduce((t, r) => t + r.tokens, 0) / rows.length),
    medianLatencyMs: rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
    totalCostUsd: +rows.reduce((t, r) => t + r.cost, 0).toFixed(6),
    totalListPriceUsd: +rows.reduce((t, r) => t + r.marketCost, 0).toFixed(6),
  };
  console.log(JSON.stringify(s));
  return s;
}

const results = { date: new Date().toISOString(), model: 'typesafe-ai/jev', seed: SEED, summaries: [], items: {} };

if (args.boolq) {
  console.error(`BoolQ: ${N} questions`);
  const items = sample(readJsonl(args.boolq), N, SEED);
  const rows = await pool(items, async (it) => {
    const q = it.question.charAt(0).toUpperCase() + it.question.slice(1) + '?';
    const r = await ask(it.passage, { type: 'boolean', instructions: q });
    const predicted = r.answer ? r.answer.probability >= 0.5 : null;
    return { id: it.idx, gold: it.label, predicted, confidence: r.answer?.probability ?? null, error: r.error,
             correct: predicted === it.label, tokens: r.tokens, ms: r.ms, cost: r.cost, marketCost: r.marketCost };
  });
  results.items.boolq = rows;
  results.summaries.push(summarize('BoolQ (SuperGLUE validation)', rows, 0.5));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}

if (args.quality) {
  console.error(`QuALITY: ${N} questions`);
  const all = readJsonl(args.quality).flatMap(a =>
    a.questions.map(q => ({ ...q, article: a.article, title: a.title })));
  const items = sample(all, N, SEED);
  const L = ['A', 'B', 'C', 'D'];
  const rows = await pool(items, async (it) => {
    // Same format the README recommends: options listed in the text, letters as the choices
    const state = `${it.title}\n\n${it.article}\n\nQuestion: ${it.question}\n`
      + it.options.map((o, i) => `${L[i]}. ${o}`).join('\n');
    const r = await ask(state, { type: 'choice',
      instructions: 'Which option (A, B, C or D) correctly answers the question?',
      criteria: { A: null, B: null, C: null, D: null } });
    const predicted = r.answer ? r.answer.choice : null;
    const gold = L[it.gold_label - 1];
    return { id: it.question_unique_id, hard: !!it.difficult, gold, predicted, error: r.error,
             confidence: r.answer?.probabilities?.[predicted] ?? null,
             correct: predicted === gold, tokens: r.tokens, ms: r.ms, cost: r.cost, marketCost: r.marketCost };
  });
  results.items.quality = rows;
  results.summaries.push(summarize('QuALITY (dev, all)', rows, 0.25));
  results.summaries.push(summarize('QuALITY (dev, HARD subset)', rows.filter(r => r.hard), 0.25));
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.error(`Saved ${OUT}`);
