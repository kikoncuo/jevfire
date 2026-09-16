# CUDA categorical scoring benchmarks — 2026-09-16

This records the initial 128-score deployment. See [the subsequent engine-tuning experiments](tuning.md) for the batch-budget sweep, cache ablation, and 256-score patch.

Test hardware: NVIDIA RTX PRO 6000 Blackwell (96 GB class), Qwen3.8-27B-FP8, vLLM 0.29.0. The existing vLLM process was reused, without restarting it or loading a second GPU model. Other ASR/transcription services remained running.

**260 measured requests, 13 distinct synthetic fixtures, five repetitions per fixture/method/cache regime. Both automatic scoring and constrained JSON matched all 850 scored field values in their 130 measured requests. No HTTP errors or schema violations.** Repetitions are not independent new examples; this is a correctness/performance smoke benchmark, not clinical validation.

The automatic path uses batching for small schemas and cache-aligned prefill for >=16 fields, or >=4 fields with context at least one cache block long. Probabilities remain uncalibrated relative label scores.

## Fresh prefix

All latencies are end-to-end milliseconds. Speedup compares medians. p95 is based on only five samples per cell.

| Fixture | JSON p50 | Auto p50 | Speedup | JSON p95 | Auto p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Spanish summary intent (1 field) | 343.6 | 105.7 | 3.25× | 347.7 | 108.8 |
| English medication intent (1 field) | 361.9 | 102.9 | 3.52× | 376.0 | 106.3 |
| Negated intent (1 field) | 317.9 | 104.2 | 3.05× | 321.6 | 110.8 |
| Spanish facts (4 fields) | 877.5 | 109.9 | 7.98× | 881.1 | 185.0 |
| Explicit negatives (4 fields) | 897.2 | 107.8 | 8.32× | 903.5 | 169.4 |
| Missing information (4 fields) | 921.1 | 111.2 | 8.28× | 940.4 | 215.4 |
| Shared-prefix category names (1 field) | 399.2 | 102.7 | 3.89× | 404.5 | 105.3 |
| Incident facts (4 fields) | 818.0 | 105.9 | 7.72× | 824.4 | 163.4 |
| Incident facts (12 fields) | 2239.4 | 330.1 | 6.78× | 2240.4 | 414.4 |
| Incident facts (28 fields) | 5113.1 | 496.9 | 10.29× | 5118.6 | 511.1 |
| Long context 150 (12 fields) | 2433.2 | 621.1 | 3.92× | 2436.9 | 625.6 |
| Long context 450 (12 fields) | 2951.1 | 1060.8 | 2.78× | 2958.8 | 1086.4 |
| 255 categories (1 field) | 611.3 | 474.3 | 1.29× | 620.2 | 488.1 |

## Warm prefix

All latencies are end-to-end milliseconds. Speedup compares medians. p95 is based on only five samples per cell.

| Fixture | JSON p50 | Auto p50 | Speedup | JSON p95 | Auto p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Spanish summary intent (1 field) | 343.4 | 99.0 | 3.47× | 363.8 | 111.9 |
| English medication intent (1 field) | 356.7 | 103.5 | 3.45× | 361.4 | 110.5 |
| Negated intent (1 field) | 320.8 | 105.0 | 3.06× | 323.8 | 107.5 |
| Spanish facts (4 fields) | 878.2 | 110.5 | 7.95× | 888.4 | 164.9 |
| Explicit negatives (4 fields) | 899.4 | 185.2 | 4.86× | 903.3 | 191.1 |
| Missing information (4 fields) | 919.8 | 127.9 | 7.19× | 926.4 | 203.0 |
| Shared-prefix category names (1 field) | 400.4 | 106.6 | 3.76× | 408.0 | 116.9 |
| Incident facts (4 fields) | 817.5 | 113.2 | 7.22× | 822.2 | 195.5 |
| Incident facts (12 fields) | 2239.8 | 402.0 | 5.57× | 2252.2 | 411.9 |
| Incident facts (28 fields) | 5112.8 | 346.3 | 14.77× | 5118.4 | 348.2 |
| Long context 150 (12 fields) | 2264.8 | 261.0 | 8.68× | 2268.5 | 284.7 |
| Long context 450 (12 fields) | 2236.8 | 314.2 | 7.12× | 2265.9 | 319.3 |
| 255 categories (1 field) | 450.9 | 295.4 | 1.53× | 460.4 | 305.4 |

## Methodology and limits

- Same model weights, FP8 quantization, GPU, and engine configuration for both methods. Thinking disabled; compact grammar-constrained JSON baseline, not pretty-printed unconstrained generation.
- Method order randomized within each repetition. Fresh-prefix trials use unique cache salts; warm-prefix trials are primed separately for each method. Weights/kernels remain warm in both conditions. No global cache flush.
- Single benchmark client. The live tests also exercised four concurrent requests for independence, but this report is not a throughput or saturation benchmark.
- Fixtures cover intent, negation, missing information, category strings with shared prefixes, field-count scaling, long administrative context, and 255 choices. The full definitions and gold answers are stored in the raw report.
- Cache alignment inserts newline padding between context and the selected field definition. This changes token positions; its correctness was evaluated on the same fixtures. The deployment-specific 1,568-token cache block must be verified before using this on another server.
- Scores are single-token surrogate-label likelihoods. They are neither exact full-sequence probabilities for the original category strings nor calibrated probabilities of correctness. Option ordering can affect decisions.
- 129–255 choices need two selected-token score calls due to vLLM’s 128-ID limit, reducing their speed benefit.
- Raw prompt usage includes all logical input tokens, including cached tokens and alignment padding; it does not measure unique GPU computation.

## Verified cache reuse

A separate fresh-salt 28-field probe returned every field correctly in 507.43 ms. vLLM’s model-level counters increased by **45,080 queried prompt tokens and 42,336 cache-hit tokens**. The latter is exactly **27 × 1,568**, confirming that the remaining fields reused the prefix populated by the first. The unique uncached portion was 2,744 tokens. Counters are global to the model; the probe ran between benchmark suites.

## Artifacts and reproduction

- [Full report, fixtures, predictions and per-request measurements](results/benchmark.json)
- [Raw measured request rows](results/benchmark.jsonl)
- [Cache-reuse probe](results/cache-proof.json)
- [GPU, package versions, model snapshot and configuration](environment.json)
- [Endpoint, schema, deployment and reproduction instructions](../docs/deployment.md)

```bash
python -m jevfire.benchmark \
  --methods json_schema,auto --repeats 5 --output results/parallel-decoding-auto.json
```
