# Inference tuning — 2026-09-16

The batch-budget sweep did not establish a consistent improvement from increasing `max_num_batched_tokens`. Keep **2,096**, cache-aligned shared prefill, and the existing model, precision, context window, sequence limit, and GPU memory fraction. The candidate-score experiment supports raising the engine's selected-token limit to **256**, allowing the API's maximum 255 choices to be scored in one backend call.

## Batch-budget experiment

Tested 2,096, 4,096 and 8,192 tokens, followed by a restarted 2,096 control. Each configuration completed 260 serial measurements and 256 measurements at concurrency four: **2,064/2,064 exact matches, no request errors**. Both scoring and compact grammar-constrained JSON used the same engine configuration in each run. Model snapshot stayed `017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`.

| Batch budget | Fresh long-context scoring p50 | Fresh 28-field throughput | Warm 28-field throughput | Available KV cache |
|---|---:|---:|---:|---:|
| 2,096, initial | 972 ms | 2.98 req/s | 4.94 req/s | 13.84 GiB |
| 4,096 | 1,016 ms | 2.87 req/s | 4.14 req/s | 11.48 GiB |
| 8,192 | 1,019 ms | 2.74 req/s | 4.21 req/s | 11.40 GiB |
| 2,096, restarted control | 1,045 ms | 2.97 req/s | 4.63 req/s | 13.84 GiB |

There are individual improvements, including short-schema latency, but the restarted control reproduces much of the short-request gain. Warm-cache timings vary noticeably. The larger budgets also leave about 17–18% less cache capacity under the fixed memory allocation. These results do not justify replacing the existing global budget. All settings retain the same 1,568-token hybrid cache block.

See [all latency and throughput tables](results/tuning/TABLES.md) and [machine-readable summaries with whole-GPU telemetry](results/tuning/summary.json).

## Cache-strategy ablation

These are three repetitions per method/cache condition at the restored 2,096-token budget. All **36/36** requests matched the expected results. Cache alignment was already implemented; this experiment measures its contribution rather than claiming an additional optimization.

| Case and cache | Ordinary batch | Unaligned first-field prefill, then batch | Aligned first-field prefill, then batch |
|---|---:|---:|---:|
| 28 fields, fresh | 1,048 ms | 1,085 ms | **455 ms** |
| 28 fields, warm | 1,054 ms | 1,096 ms | **306 ms** |
| 12 fields, long context, fresh | 2,714 ms | 2,739 ms | **980 ms** |
| 12 fields, long context, warm | 2,167 ms | 2,185 ms | **255 ms** |

On this hybrid model, simply sending shared text does not guarantee reusable recurrent-state checkpoints at the field boundary. Padding the common prefix to the verified block boundary and completing one field before submitting its siblings materially improves reuse. For the long-context case, alignment is 2.77× faster than ordinary batching with a fresh prefix and 8.51× faster with a warm prefix. Every genuinely new context still needs its initial prefill.

Raw data: [cache strategies](results/tuning/cache-strategies.json).

## Selected-token limit

The [local vLLM 0.29 patch](../patches/vllm-0.29-score-cap.patch) changes `MAX_LOGPROB_TOKEN_IDS` from 128 to 256. Both request validation and the GPU sampler's row allocation import this constant. The engine is restarted after the change. This does not modify weights, sampling temperature, the input context limit, or the number of generated tokens per scoring call.

Two sidecar endpoints on the **same patched engine** used chunk sizes 128 and 256. Request order was randomized, with five repetitions across eight catalog-boundary variants and two cache conditions. All **160/160** predictions were correct. Additional probes compared all candidate log probabilities, with **maximum absolute difference 0.0** across the measured comparisons.

| Choices | Cache | Two calls, cap 128 | One call, cap 256 | Speedup |
|---|---|---:|---:|---:|
| 129 | Fresh | 348.7 ms | 175.9 ms | **1.98×** |
| 129 | Warm | 346.2 ms | 176.7 ms | **1.96×** |
| 255 | Fresh | 464.0 ms | 324.1 ms | **1.43×** |
| 255 | Warm | 291.1 ms | 147.9 ms | **1.97×** |

These are pooled medians over catalog variants of each size. Smaller schemas already fit into one call and do not get this specific benefit. Mixed GPU batches containing two 255-choice fields and a boolean passed, including winners beyond the old 128-entry boundary. Raw vLLM requests for 256 scores succeeded; 257 were rejected with HTTP 400. All 13 original fixtures also passed fresh and warm regression checks on the new endpoint.

Raw data: [randomized score-cap comparison](results/tuning/score-caps.json), [mixed-batch and boundary checks](results/tuning/score-cap-checks.json).

## Targeted concurrent comparison

Both sidecars used the same patched engine at 2,096 batched tokens. This separate test used 32 requests per method/cache cell at concurrency four, plus ten serial repetitions per cell. All **336/336** requests passed. The identifiers `scorecap-128` and `scorecap-256` denote the sidecar's chunk width, not different engines.

| 255-choice workload | Two-call scoring | One-call scoring | Scoring throughput gain | JSON throughput, same engine |
|---|---:|---:|---:|---:|
| Fresh prefix | 2.33 req/s | **3.21 req/s** | **1.38×** | 3.30 req/s |
| Warm prefix | 3.85 req/s | **7.54 req/s** | **1.96×** | 6.14 req/s |

The patch fixes a substantial part of the high-cardinality overhead. Fresh-prefix scoring is still roughly tied with JSON throughput, slightly slower in this run; warm-prefix scoring is about 23% faster. Single-request latency and concurrent throughput should not be conflated.

Sampled whole-GPU energy per scoring request fell from approximately **253 to 183 J** fresh and **154 to 78 J** warm. These are coarse power/throughput estimates on the shared GPU, not isolated model energy or financial savings. Compared with JSON, one-call scoring was about 4% higher in this fresh-prefix energy proxy and about 8% lower warm.

Raw data: [two-call run](results/tuning/scorecap-128/latency.json), [one-call run](results/tuning/scorecap-256/latency.json), [concurrent throughput and telemetry summaries](results/tuning/targeted-throughput-summary.json). Raw per-request rows and GPU samples are adjacent to each report.

Across the sweep, restarted control, cache ablation, candidate comparison, targeted performance runs and final 26-request regression, **2,622/2,622 measured requests matched the synthetic expected outputs, with zero request errors**. Untimed warmups, raw-score probes, boundary checks and the 28 passing unit/live tests are additional checks, excluded from this count.

## Reproduction and limits

See [deployment and reversible engine patch instructions](../docs/deployment.md) and [benchmark reproduction](README.md).

Serial sweep cells have five samples; cache ablations have three. Throughput uses finite closed-loop batches at concurrency four, including fill and drain. These are mechanism and correctness smoke tests on synthetic fixtures, not production accuracy, sustained saturation, or financial savings measurements. GPU telemetry includes other services. Small temporal differences can confound sequential comparisons.
