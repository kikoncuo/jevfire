# Run JEVfire on a CUDA box

JEVfire is a CPU sidecar connected to an existing vLLM server. It relies on
native batched completions, explicit `logprob_token_ids`, token-ID responses,
and automatic prefix caching. The measured backend version is **vLLM 0.29.0**.

## Tested backend configuration

Install vLLM in its own environment using its
[CUDA installation instructions](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/).
The public benchmark used Qwen3.8-27B-FP8 on an RTX PRO 6000 Blackwell (96 GB
class), with the following settings. Capacity settings are specific to that
hardware and shared-GPU memory allocation; check fit on your machine.

```bash
vllm serve Qwen/Qwen3.8-27B-FP8 \
  --revision 017b9c7af6b5689d5dd426a76e0bc077eb5ca20a \
  --served-model-name qwen3.8-27b \
  --host 127.0.0.1 --port 8000 \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.45 \
  --max-num-batched-tokens 2096 \
  --max-num-seqs 64 \
  --max-model-len 16384 \
  --kv-cache-dtype fp8 \
  --reasoning-parser qwen3 \
  --enable-prefix-caching \
  --language-model-only
```

The original deployment had already cached this model revision. This command
pins that recorded snapshot explicitly. Model weights are downloaded by vLLM,
not distributed by JEVfire.

Install JEVfire from the repository in a second environment:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
export DECISION_VLLM_URL=http://127.0.0.1:8000
export DECISION_MODEL=qwen3.8-27b
export DECISION_TOKENIZER=Qwen/Qwen3.8-27B-FP8
export DECISION_TOKENIZER_REVISION=017b9c7af6b5689d5dd426a76e0bc077eb5ca20a
python -m uvicorn jevfire.app:app --host 127.0.0.1 --port 8010 --no-access-log
```

The sidecar exposes `/health`, `/docs`, `/openapi.json`, and `/v1/decisions`.
It verifies the served model and label tokenization at startup. If configured
above 128 requested scores, it also probes all 255 labels before becoming ready.

## Configuration

| Variable | Default | Purpose |
|:--|:--|:--|
| `DECISION_VLLM_URL` | `http://127.0.0.1:8000` | Native vLLM API root |
| `DECISION_MODEL` | `qwen3.8-27b` | Exact model ID returned by `/v1/models` |
| `DECISION_TOKENIZER` | `Qwen/Qwen3.8-27B-FP8` | Matching tokenizer ID or local path |
| `DECISION_TOKENIZER_REVISION` | unset | Pin a matching tokenizer snapshot |
| `DECISION_LOCAL_FILES_ONLY` | `0` | `1` requires a cached/local tokenizer |
| `DECISION_VLLM_API_KEY` | unset | Optional upstream bearer token |
| `DECISION_CACHE_BLOCK_TOKENS` | `0` | Verified cache boundary; zero disables alignment |
| `DECISION_MAX_SCORE_TOKENS` | `128` | Candidate-score chunk width; at most 256 |

The HTTP client ignores proxy environment variables and allows four concurrent
classifications per sidecar process. Each classification can schedule multiple
field rows. Running multiple workers increases aggregate concurrency and must
be benchmarked separately.

The API has no built-in client authentication. The example binds to loopback;
use your own authenticated gateway for remote clients. The service does not
log request contexts; upstream vLLM logging follows your own configuration.
For tenant-specific cache separation, an application gateway can provide a
secret, application-controlled `cache_salt`; do not rely on a caller's salt
as an authentication boundary.

## Cache alignment

The tested hybrid model used **1,568-token cache blocks** and Mamba `align`
mode. Verify your actual engine's cache settings and runtime cache-hit counters
before enabling this value. It is not a universal Qwen/vLLM constant.
See vLLM's [hybrid KV cache design](https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager/).

```bash
# Only after confirming this block size on your deployment:
export DECISION_CACHE_BLOCK_TOKENS=1568
```

Restart the sidecar to load changed environment variables. `auto` then selects
aligned prefill for at least 16 fields, or at least four fields when context is
at least one block long. Without a configured block, it uses ordinary batching.

Alignment inserts newline-token padding at the end of the common context. The
first real field populates the cache; remaining fields follow in a batch. This
changes token positions, so validate both latency and semantic accuracy.
The measured [cache probe](../benchmarks/results/cache-proof.json) recorded
42,336 reused tokens, exactly 27 × 1,568, for 28 fields.

## Optional 256-score patch

**Only tested on vLLM 0.29.0.** Stock vLLM limits `logprob_token_ids` to 128.
JEVfire already supports 129–255 choices by scoring two chunks of the same
full-option prompt, then combining all raw scores before normalization.

The optional patch raises the engine's requested-score limit to 256. Validation
and the GPU sampler use the same constant. This affects engine buffers; it is
not a context-window increase or a model-weight change. Stop/drain your own
vLLM service before applying it, then restart it normally. These instructions
do not manage or stop any processes for you.

In the **vLLM environment**, from the JEVfire repository root:

```bash
python -c 'import importlib.metadata as m; assert m.version("vllm") == "0.29.0", "Patch requires vLLM 0.29.0"'
VLLM_PACKAGE_ROOT="$(python -c 'import importlib.util as u; from pathlib import Path; print(Path(u.find_spec("vllm").origin).parent.parent)')"
patch --dry-run -p1 -d "$VLLM_PACKAGE_ROOT" < patches/vllm-0.29-score-cap.patch
test ! -e "$VLLM_PACKAGE_ROOT/vllm/sampling_params.py.jevfire-backup" && \
  cp "$VLLM_PACKAGE_ROOT/vllm/sampling_params.py" "$VLLM_PACKAGE_ROOT/vllm/sampling_params.py.jevfire-backup"
patch -p1 -d "$VLLM_PACKAGE_ROOT" < patches/vllm-0.29-score-cap.patch
```

Run each step only if the previous step succeeds. After restarting vLLM, set
`DECISION_MAX_SCORE_TOKENS=256` in the sidecar environment and restart it.
Check that `/health` reports `max_score_tokens: 256`; run the live regression:

```bash
DECISION_TEST_URL=http://127.0.0.1:8010 pytest tests/test_parallel_decoding_live.py -q
```

The API still accepts at most **255 choices** per field. The extra backend slot
is not another advertised API choice. A failed capability probe prevents startup.
Package upgrades can replace the patch; recheck version and behavior after upgrades.

### Roll back

Set the sidecar back to `DECISION_MAX_SCORE_TOKENS=128` and restart it first.
Drain/stop your vLLM service, then reverse the patch in the same vLLM environment:

```bash
patch --dry-run -R -p1 -d "$VLLM_PACKAGE_ROOT" < patches/vllm-0.29-score-cap.patch
patch -R -p1 -d "$VLLM_PACKAGE_ROOT" < patches/vllm-0.29-score-cap.patch
```

Restart vLLM and rerun health/live tests. The backup is available for inspection;
do not restore an old package file over a newly upgraded vLLM version.

## Other models

The engine is written against the vLLM API, but compatibility is not guaranteed
by parameter count alone. A tokenizer must supply 255 distinct round-tripping
single-token labels, and the chat template must elicit an immediate label.
Test option ordering, accuracy, prefill cost, cache behavior, and throughput.
This release includes measured results for one model and hardware configuration.
