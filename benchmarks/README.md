# Read the numbers, rerun the experiment

The headline is **10.29× lower median latency** for a 28-field synthetic task:
5,113.1 ms constrained JSON versus 496.9 ms automatic scoring, fresh prefix,
five measured requests per method. The headline experiment used the stock
128-score path; its 28 boolean fields do not need the optional 256-score patch.

## Experiment map

| Experiment | Measured requests | Artifacts |
|:--|--:|:--|
| Initial JSON/scoring comparison | 260 | [Report](initial.md), [raw data](results/benchmark.json) |
| Batch-budget sweep + restarted control | 2,064 | [Tables](results/tuning/TABLES.md), [summary](results/tuning/summary.json) |
| Cache-strategy ablation | 36 | [Data](results/tuning/cache-strategies.json) |
| Candidate-score cap comparison | 160 | [Data and score probes](results/tuning/score-caps.json) |
| Final regression | 26 | [Data](results/tuning/final-regression.json) |
| Targeted 255-choice latency/throughput | 336 | [Summary](results/tuning/targeted-throughput-summary.json), [128](results/tuning/scorecap-128), [256](results/tuning/scorecap-256) |

The last five rows total **2,622**. The separate initial experiment brings the
published measured total to **2,882**. All measured requests exactly matched
their synthetic expected output with zero request errors. Untimed warmups,
score probes, boundary checks, and unit/live tests are excluded.

There are **13 base fixtures** and **eight catalog-boundary variants**, reused
across methods and configurations. Repetition counts are not dataset diversity.
Tests cover mechanism correctness; they do not establish general task accuracy.

## Controls and limitations

- Same FP8 model and GPU for scoring and compact grammar-constrained JSON;
  thinking disabled for both. Weights and kernels remain warm.
- Randomized method order. Fresh-prefix requests get unique salts; warm-prefix
  requests are primed separately per method. No global cache reset.
- Serial wall latency includes client/HTTP work. Five samples per cell in the
  main comparison/sweep, three in the cache ablation, ten in targeted latency.
  Small-sample p95 is descriptive, not a tail-latency guarantee.
- Concurrent tests use finite closed-loop batches at concurrency four, including
  fill/drain; 16 requests per sweep cell and 32 per targeted cell. They are not
  sustained saturation tests. Do not infer throughput from single-client latency.
- Other services remained on the GPU. Telemetry sampled the **whole GPU** every
  500 ms; energy estimates are approximate and do not establish dollar savings.
- Catalog comparisons use two sidecars with different chunk widths on the same
  patched engine. Recorded raw candidate scores matched exactly. Different
  labels/options or other models still need accuracy checks.
- The 255-choice fresh-prefix throughput was slightly lower than JSON even
  after the patch. The method is workload dependent.

See [initial results](initial.md), [tuning results](tuning.md), and
[environment metadata](environment.json) for exact settings and model revision.
Published measurements retain their original numeric values. Host identifiers
and absolute operational paths were omitted; the public package name and API
port were normalized. The original server restart helper is not distributed.

## Reproduce

Start the [backend and sidecar](../docs/deployment.md). The commands below assume
loopback services without authentication. Use the model ID your backend serves.

```bash
python -m jevfire.benchmark \
  --endpoint http://127.0.0.1:8010 --vllm-url http://127.0.0.1:8000 \
  --model qwen3.8-27b --repeats 5 --methods json_schema,auto \
  --output results/initial.json

python -m jevfire.load_benchmark \
  --endpoint http://127.0.0.1:8010 --vllm-url http://127.0.0.1:8000 \
  --model qwen3.8-27b --concurrency 4 --requests 32 \
  --cases cardinality_255 --output results/throughput.json

python -m jevfire.benchmark \
  --cases scale_28,long_context_450 --repeats 3 \
  --methods batch,prefill_then_batch,aligned_prefill \
  --output results/cache-strategies.json
```

`run_tuning_benchmark` wraps serial and concurrent runs with `nvidia-smi` telemetry;
it must run on the GPU host. Change engine budgets yourself and use distinct
output directories for each run. `summarize_tuning --root YOUR_RUN_DIRECTORY`
rebuilds tables for `b*-c*` directories.

To compare score caps, run two sidecars on the **same patched engine**, one with
`DECISION_MAX_SCORE_TOKENS=128` on port 8010 and the other with `256` on 8011:

```bash
python -m jevfire.score_cap_benchmark \
  --endpoint128 http://127.0.0.1:8010 --endpoint256 http://127.0.0.1:8011 \
  --repeats 5 --output results/score-caps.json
```

Each report stores fixtures, expected outputs, predictions, field/schema checks,
logical token usage, timings and errors. Logical prompt tokens include cached
tokens and padding; they are not unique GPU work or a billed-token estimate.

Verify the checked-in data and regenerate the README chart without a GPU:

```bash
python scripts/verify_benchmarks.py
python scripts/render_benchmarks.py
```
