# Benchmarks

`run.mjs` measures how well Jev answers reading-comprehension questions when it is called the same way the app calls it.

| Benchmark | Task | Answer type used |
|---|---|---|
| [BoolQ](https://github.com/google-research-datasets/boolean-questions) | Read a Wikipedia passage and answer a real search-engine question with yes or no | Yes / No |
| [QuALITY](https://github.com/nyu-mll/quality) | Read a long article or short story (about 5,000 words) and answer a 4-option question written so that skimming is not enough | Multiple choice (`A, B, C, D`, options listed in the text) |

## Results (2026-09-21, seed 42, 100 questions each)

| Benchmark | Accuracy | Random guess | Median latency | Avg input tokens |
|---|---|---|---|---|
| BoolQ (SuperGLUE validation) | 94 / 100 | 50% | 0.38 s | 406 |
| QuALITY (dev) | 93 / 100 | 25% | 0.62 s | 6,279 |
| QuALITY (dev, hard subset) | 45 / 50 | 25% | 0.60 s | 6,429 |

Answers given with at least 90% confidence: 156 of 157 correct (BoolQ 76/77, QuALITY 80/80).
Total list price for all 200 questions: $0.028. Per-question results: [`results-2026-09-21.json`](results-2026-09-21.json).

Caveats: 100 questions per benchmark is a small sample, and because both datasets are public, training-data contamination cannot be ruled out.

## How it works

Questions are sampled with a fixed seed, so anyone can reproduce the same set.
The results file stores only question IDs, the gold answer, Jev's answer and its confidence — no dataset text.

## Reproduce

```bash
# BoolQ (SuperGLUE release)
curl -LO https://dl.fbaipublicfiles.com/glue/superglue/data/v2/BoolQ.zip
unzip BoolQ.zip

# QuALITY v1.0.1 dev set
curl -L -o quality_dev.jsonl https://raw.githubusercontent.com/nyu-mll/quality/main/data/v1.0.1/QuALITY.v1.0.1.htmlstripped.dev

AI_GATEWAY_API_KEY=your_key node benchmarks/run.mjs \
  --boolq BoolQ/val.jsonl --quality quality_dev.jsonl --n 100 --seed 42
```

Options: `--n` questions per benchmark, `--seed` sampling seed, `--concurrency` parallel requests (default 3), `--out` results file.

## Datasets

- **BoolQ** — Clark et al., *BoolQ: Exploring the Surprising Difficulty of Natural Yes/No Questions*, NAACL 2019. CC BY-SA 3.0.
- **QuALITY** — Pang et al., *QuALITY: Question Answering with Long Input Texts, Yes!*, NAACL 2022. CC BY 4.0.

The datasets are not included in this repository.
