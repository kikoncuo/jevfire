import { MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { Tokenizer } from '@mlc-ai/web-tokenizers';
import { FiniteDecisions, WebLLMBackend } from '../src/sdk/index.js';
import { Game } from '../src/game.js';
import { DrivingGame } from '../src/driving/game.js';
import {
  buildDecisionPrompt,
  decisionChoices,
} from '../src/decision-prompt.js';
import { buildDrivingPrompt } from '../src/driving/prompt.js';
import { driverChoices } from '../src/driving/contract.js';

const MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const REVISION = '0ec138972555613c1d7812a821778ad0398c8790';
const MODEL_URL = `https://huggingface.co/mlc-ai/${MODEL}/resolve/${REVISION}/`;
const LIB_REVISION = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4';
const MODEL_LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`;
const send = (type, data = {}) => postMessage({ type, ...data });
const check = (value, message) => {
  if (!value) throw new Error(message);
};
const winner = (row) => row.indexOf(Math.max(...row));
const difference = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const median = (a) => {
  const sorted = [...a].sort((a, b) => a - b);
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
};
self.onmessage = async () => {
  let engine, backend;
  try {
    const tokenizer = await Tokenizer.fromJSON(
      await (await fetch(MODEL_URL + 'tokenizer.json')).arrayBuffer(),
    );
    const capture = {
      active: false,
      processLogits(logits) {
        if (this.active) {
          this.row = this.ids.map((id) => Number(logits[id]));
          this.vocabulary = this.returnVocab ? Array.from(logits) : undefined;
        }
        return logits;
      },
      processSampledToken() {},
      resetState() {},
    };
    const record = prebuiltAppConfig.model_list.find(
      (m) => m.model_id === MODEL,
    );
    engine = new MLCEngine({
      appConfig: {
        ...prebuiltAppConfig,
        cacheBackend: 'indexeddb',
        model_list: [{ ...record, model: MODEL_URL, model_lib: MODEL_LIB }],
      },
      logitProcessorRegistry: new Map([[MODEL, capture]]),
      initProgressCallback: (p) => send('progress', { message: p.text }),
      logLevel: 'WARN',
    });
    await engine.reload(MODEL, {
      context_window_size: 2048,
      max_history_size: 1,
      temperature: 0,
      top_p: 1,
      repetition_penalty: 1,
    });
    const pipeline = engine.getLLMStates('sdk-test', MODEL)[1];
    pipeline.tvm.lib.webGPUContext.device.addEventListener(
      'uncapturederror',
      (event) => send('gpu-error', { message: event.error.message }),
    );
    const ids = Array.from('ABCDEFGHI').map((c) => tokenizer.encode(c)[0]);
    const village = new Game();
    const driving = new DrivingGame();
    const cases = [];
    for (const unit of ['mira', 'aldric', 'tomas', 'nell']) {
      const choices = decisionChoices(unit);
      const prompt = buildDecisionPrompt(unit, village.contextFor(unit));
      cases.push({
        name: 'village:' + unit,
        prompt,
        ids: ids.slice(0, choices.length),
      });
    }
    for (const unit of ['nova', 'atlas', 'juno', 'milo']) {
      const context = driving.contextFor(unit);
      const choices = driverChoices(unit, context.availableActions);
      const prompt = buildDrivingPrompt(
        unit,
        context,
        undefined,
        undefined,
        choices,
      );
      cases.push({
        name: 'driving:' + unit,
        prompt,
        ids: ids.slice(0, choices.length),
      });
    }
    const originalRuns = {};
    for (const job of cases) {
      const runs = [];
      for (let trial = 0; trial < 2; trial++) {
        await engine.resetChat(false, MODEL);
        const tokens = Array.from(tokenizer.encode(job.prompt));
        capture.ids = job.ids;
        capture.row = null;
        const start = performance.now();
        for (let offset = 0; offset < tokens.length; offset += 32) {
          capture.active = offset + 32 >= tokens.length;
          await engine.forwardTokensAndSample(
            tokens.slice(offset, offset + 32),
            true,
            MODEL,
          );
          if (!capture.active)
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        runs.push({
          elapsed_ms: performance.now() - start,
          logits: [...capture.row],
        });
      }
      originalRuns[job.name] = runs;
      send('original-baseline', { name: job.name, runs });
    }
    backend = await WebLLMBackend.create({
      engine,
      model: MODEL,
      runtimeVersion: '0.2.85',
      capture,
      cacheSlots: 6,
      maxPrefixTokens: 1024,
    });
    send('backend', { name: backend.name, reason: backend.reason });
    check(
      backend.cacheSlots > 0,
      'Prefix cache backend unavailable: ' + backend.reason,
    );
    const sdk = new FiniteDecisions({ backend, tokenizer });
    const results = [];
    for (const job of cases) {
      send('testing', { name: job.name });
      const boundary = job.prompt.indexOf('<|im_start|>user\n');
      const request = {
        prompt: job.prompt,
        prefix: job.prompt.slice(0, boundary),
        cacheKey: job.name,
        candidateTokenIds: job.ids,
        chunkSize: 32,
        yieldMs: 16,
      };
      const cold = await sdk.score(request);
      const warm = await sdk.score(request);
      send('scores', {
        name: job.name,
        cold: cold.logits,
        warm: warm.logits,
        usage: warm.usage,
      });
      check(warm.usage.cache_hit, 'Expected warm cache hit');
      const trials = [
        {
          cold: cold.logits,
          warm: warm.logits,
          same_winner: winner(cold.logits) === winner(warm.logits),
        },
      ];

      const fresh = [],
        cached = [];
      for (let i = 0; i < 3; i++) {
        // Exact same prefix boundary and chunk plan for fresh and reused execution.
        await sdk.clear();
        const a = await sdk.score(request);
        const b = await sdk.score(request);
        send('repeat-scores', {
          name: job.name,
          i,
          cold: a.logits,
          warm: b.logits,
        });

        trials.push({
          cold: a.logits,
          warm: b.logits,
          same_winner: winner(a.logits) === winner(b.logits),
        });
        fresh.push(a.elapsed_ms);
        cached.push(b.elapsed_ms);
      }
      const changed = {
        ...request,
        prompt: job.prompt.replace(
          'system\n',
          'system\nUpdated strategy: be careful. ',
        ),
        prefix: request.prefix.replace(
          'system\n',
          'system\nUpdated strategy: be careful. ',
        ),
      };
      const edited = await sdk.score(changed);
      check(!edited.usage.cache_hit, 'Edited prefix reused stale state');
      const item = {
        name: job.name,
        input_tokens: cold.usage.input_tokens,
        cached_tokens: warm.usage.cached_prefix_tokens,
        processed_tokens: warm.usage.processed_tokens,
        cold_median_ms: median(fresh),
        warm_median_ms: median(cached),
        speedup: median(fresh) / median(cached),
        max_abs_logit_difference: Math.max(
          ...trials.map((t) => difference(t.cold, t.warm)),
        ),
        fresh_repeat_max_abs_difference: Math.max(
          ...trials.map((t) => difference(trials[0].cold, t.cold)),
        ),
        same_winner_trials: trials.filter((t) => t.same_winner).length,
        trials,
        original: originalRuns[job.name],
        original_median_ms: median(
          originalRuns[job.name].map((r) => r.elapsed_ms),
        ),
        prompt_edit_invalidates: true,
      };
      results.push(item);
      send('case-result', item);
    }
    // Five independent fields, with one changing observation shared by all fields.
    const sharedPrompt =
      '<|im_start|>system\nChoose a letter for the requested field. A: wait; B: move; C: defend; D: eat; E: repair. Return one letter. Do not explain.<|im_end|>\n<|im_start|>user\n' +
      JSON.stringify({
        world: village.contextFor('mira'),
        team: village.contextFor('aldric'),
      }) +
      '\n';
    const fields = ['collector', 'fighter', 'builder', 'scout', 'guard'].map(
      (key) => ({
        key,
        suffix: `Actor: ${key}. This is an isolation test. Its assigned answer is ${'ABCDE'[['collector', 'fighter', 'builder', 'scout', 'guard'].indexOf(key)]}. Reply with that exact single letter.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`,
        choices: ['wait', 'move', 'defend', 'eat', 'repair'].map(
          (value, i) => ({ label: 'ABCDE'[i], value }),
        ),
      }),
    );
    await sdk.clear();
    const shared = await sdk.scoreFields({
      sharedPrompt,
      fields,
      chunkSize: 32,
      yieldMs: 16,
    });
    const independent = await sdk.scoreFields({
      sharedPrompt,
      fields,
      chunkSize: 32,
      yieldMs: 16,
      useCache: false,
    });
    send('shared-comparison', { shared, independent });
    check(
      JSON.stringify(shared.parsed_json) ===
        JSON.stringify(independent.parsed_json),
      'Shared context changes choices',
    );
    check(
      shared.usage.cache_hits === 4,
      'Expected four prefix hits for five fields',
    );
    const reversed = await sdk.scoreFields({
      sharedPrompt,
      fields: [...fields].reverse(),
      chunkSize: 32,
      yieldMs: 16,
    });
    for (const f of fields)
      check(
        reversed.parsed_json[f.key] === shared.parsed_json[f.key],
        'Field order leaks into choices',
      );
    const adapter = await navigator.gpu.requestAdapter();
    send('report', {
      tested_at: new Date().toISOString(),
      model: MODEL,
      revision: REVISION,
      backend: backend.name,
      gpu: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
      },
      cases: results,
      shared: {
        usage: shared.usage,
        elapsed_ms: shared.elapsed_ms,
        parsed_json: shared.parsed_json,
      },
      independent: {
        usage: independent.usage,
        elapsed_ms: independent.elapsed_ms,
        parsed_json: independent.parsed_json,
      },
      field_order_independent: true,
    });
    await sdk.dispose();
    backend = null;
    await engine.unload();
  } catch (error) {
    send('error', { message: error.message, stack: error.stack });
    if (backend) await backend.restoreOriginal().catch(() => {});
    if (engine) await engine.unload().catch(() => {});
  }
};
