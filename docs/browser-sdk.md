# Browser decision SDK

The browser SDK assigns declared fields from finite, typed options. It does not generate or parse JSON text. All three browser demos use the same inference worker. Last Hearth and Slipstream cache unchanged actor instructions across updates; World 1-1 reuses one observation across movement, jump and speed fields. Uncached observations, field suffixes and any prefix beyond the configured cache cap are still processed.

There are two useful forms of reuse:

- **Across game ticks:** `score()` restores a character's instruction prefix, appends the current world observation, and reads the final candidate logits. A changed policy or token prefix invalidates that character's checkpoint.
- **Across fields in one request:** `scoreFields()` prefills a shared context once, then restores that checkpoint for each independent field suffix. Earlier field answers are never included in later fields' context. The current WebLLM adapter executes the suffixes sequentially; this is not parallel GPU batching.

Five fields with five options require five scored positions, not 25 generations. The model still processes the uncached input and each field suffix. The current model kernel also calculates full-vocabulary logits; the SDK selects the requested labels from the final row. It skips sampling and intermediate CPU vocabulary readback on the optimized path.

## Use it in another game

Run model execution inside a Web Worker. The modules live in `web/src/sdk/` and have no dependency on village or driving logic.

```js
import { FiniteDecisions, WebLLMBackend } from './sdk/index.js';

// Use the exact tokenizer matching the loaded model. The engine must already
// be loaded. `capture` is the registered raw-logit processor used by the public
// WebLLM fallback; see the shared inference worker for its implementation.
const backend = await WebLLMBackend.create({
  engine,
  model: MODEL,
  runtimeVersion: '0.2.85',
  capture,
  cacheSlots: 6,
  maxPrefixTokens: 1024,
});
const decisions = new FiniteDecisions({ backend, tokenizer });

// Serialize one bounded snapshot. Put shared instructions and action meanings
// here; put each actor's role, policy and field-specific question in its suffix.
const sharedPrompt =
  '<|im_start|>system\nChoose one label: A=wait, B=move, C=defend, D=eat, E=repair.\n' +
  '<|im_end|>\n<|im_start|>user\nWorld: ' + JSON.stringify(world) + '\n';
const choices = ['wait', 'move', 'defend', 'eat', 'repair'].map((value, i) => ({
  label: 'ABCDE'[i], value,
}));
const result = await decisions.scoreFields({
  sharedPrompt,
  cacheKey: 'squad-world',
  fields: actors.map(actor => ({
    key: actor.id,
    suffix: `Actor: ${actor.id}. Policy: ${actor.policy}. Choose its action.` +
      '<|im_end|>\n<|im_start|>assistant\n',
    choices,
  })),
  chunkSize: 32,
  yieldMs: 16,
});

// Only actor IDs and one of the supplied values can appear in this object.
applyActions(result.parsed_json);
console.log(result.usage.processed_tokens, result.usage.cached_prefix_tokens);

// Before unloading/reloading the engine, release the SDK's state first.
await decisions.dispose();
await engine.unload();
```

Labels must each round-trip as one token with the model's tokenizer. Options may map labels to strings, finite numbers, booleans or null. Field names are unique and supplied by the application; nested output can be assembled by application code from these typed assignments. Restricted softmax scores are relative preferences among offered labels, not calibrated confidence or proof that an action is safe.

For per-actor inference, preserve the current prompt and provide its reusable prefix:

```js
const result = await decisions.score({
  prompt: instructions + latestObservation + answerSuffix,
  prefix: instructions,
  cacheKey: `game:${actor.id}`,
  candidateTokenIds: verifiedLabelIds,
  chunkSize: 32,
  yieldMs: 16,
  signal: abortController.signal,
});
```

The entire prompt is tokenized first. Only an exact token prefix is reused, so a token spanning the instruction/observation boundary cannot corrupt the context. Cache keys partition actors; exact token content, rather than the key alone, determines a hit. Requests are serialized to prevent concurrent callers from mixing model state. `clear()` evicts all checkpoints. Abort discards partial work, but a GPU call already running must finish first.

### Driving prompt fidelity

Slipstream keeps the published prompt text unchanged and checkpoints its system
message. The available-label header is part of that prefix, so a changed label
set invalidates the checkpoint. New traffic with the same system text reuses it;
the observation and action mapping are always processed afresh. Policy edits also
invalidate that driver's exact prefix. Eight regression snapshots guard the
published prompt bytes.

An earlier prototype moved the available-label header after the policy to keep
more cache hits. It changed one wet-corner choice in the fixed-scene comparison,
so that prompt reorder was removed. [Quality and scheduling measurements](driving-quality.md).

## Runtime and limits

The optimized adapter is version-gated to WebLLM **0.2.85**. It uses private pipeline functions and must be revalidated when upgrading WebLLM or the compiled model library. Both attention KV state and Qwen3.5's recurrent state are forked. A scoped compatibility helper stages same-buffer state copies through a separate GPU buffer because WebGPU prohibits copying a buffer onto itself. It changes only the engine instance during synchronous cache operations; it does not patch dependency files or global prototypes.

Unsupported adapters use independent prefills through WebLLM's public API and report zero cache hits. Check the worker's `sdk_backend`, `prefix_cache_slots` and `cache_fallback_reason` readiness fields. Runtime GPU/state errors fail the request instead of returning stale scores. Use one SDK owner per engine; do not call engine generation/reset methods concurrently with it. Dispose the SDK before unloading or replacing the model.

The game worker stores up to six checkpoints, each capped at 512 tokens. The shipped Mario prompt fits its shared observation within this cap; longer edited prompts may only be partly reused. Generic callers can configure up to eight checkpoints and 1,024 cached tokens per prefix; longer prefixes are only partly cached. Additional checkpoints consume GPU memory, especially recurrent state. Input is limited to 1,800 tokens by default to leave room inside the games' 2,048-token model context. Raising the input limit does not make inference faster.

Rendering continues independently of decision frequency. World 1-1 intentionally pauses physics at action boundaries in Decision steps mode; its Live mode and the other games continue physics during inference. Keep chunk/yield limits suitable for the GPU: bigger chunks can improve inference throughput while increasing contention with rendering. No network inference is used after the model loads.

## Validation

Run `cd web && node --test test/sdk*.test.js` for cache isolation, token-boundary correctness, LRU eviction, abort handling, concurrent requests, typed options and safe GPU-copy tests.

With the demo dependencies installed, run `npm run dev`, then open `/qa/sdk.html` in a WebGPU browser for the real pinned Qwen model benchmark. This downloads the model if it is not already cached. The harness compares warm and fresh scoring, checks edited policies, and exercises a five-field shared-context request. `window.sdkReport` contains timings, token counts and raw candidate logits. `window.sdkError` contains any failure.

Small floating-point differences can occur between GPU executions, including fresh runs. Nearly tied options can swap rank; the harness records numerical differences and reports winner agreement. Valid output keys and values are guaranteed by assembly, not by bit-identical GPU arithmetic.

### Measured browser run

[Raw results](../web/qa/sdk-benchmark.json), Apple/Metal 3 WebGPU, Qwen3.5 0.8B q4f16, 32-token chunks and a 16 ms yield between chunks:

| Workload | Independent prefill | Shared prefix | Work avoided |
| --- | ---: | ---: | ---: |
| Five fields × five options | 6,859 ms | 1,732 ms | 2,048 of 2,735 input-token evaluations |

That is **3.96× faster in one paired synthetic test**. The five field suffixes explicitly request different A–E labels to test state isolation. This is not a policy-quality benchmark, a race win-rate result, or a general speedup guarantee. All five assignments agreed with independent scoring and with reversed field order.

The four village fixtures were **1.37–1.67×** faster warm than the original worker; four driving fixtures ranged from **0.98–1.17×**. Driving's changing observation is a larger share of its prompt, so caching only instructions saves less. Across the eight fixtures, 32/32 cached-versus-fresh SDK comparisons chose the same option in the recorded run; earlier near-tie probes sometimes changed winners. The original worker also changed its near-tied Mira choice between repeated runs.

Cold/warm SDK timings use three pairs per fixture; the original worker uses two runs per fixture. The GPU was not isolated from other browser activity, and the driving prompt fixtures predate later prompt edits. Treat the numbers as local diagnostic measurements. The raw data includes score differences and original-worker samples, rather than implying bit-identical equivalence.

### World 1-1 integration check

The production game scored movement, jump and speed on five paired frozen
observations, with a fresh shared prefix for each pair. Mean whole-request time
fell from **1,478 ms with independent prefills to 541 ms with shared state (2.73×)**.
Both used 128-token chunks and zero artificial yields; all 15 field assignments
agreed. A typical request avoided 672 of 1,146 input-token evaluations.
This small local timing test does not establish policy quality: the first live
Qwen run died at the first enemy. [Full setup and limitations](mario-demo.md#recorded-local-check).
