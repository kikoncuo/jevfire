import { MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { Tokenizer } from '@mlc-ai/web-tokenizers';
import { UNIT_DEFINITIONS, schemaFor, assemble } from './contract.js';
import { buildDecisionPrompt, ROLE_LABELS } from './decision-prompt.js';

const MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const REVISION = '0ec138972555613c1d7812a821778ad0398c8790';
const MODEL_URL = `https://huggingface.co/mlc-ai/${MODEL}/resolve/${REVISION}/`;
const LIB_REVISION = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4';
const MODEL_LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`;
let engine,
  tokenizer,
  capture,
  labelIds,
  busy = false;
const send = (type, body = {}) => self.postMessage({ type, ...body });

class Capture {
  constructor(ids) {
    this.ids = ids;
    this.row = null;
  }
  processLogits(logits) {
    this.row = this.ids.map((id) => Number(logits[id]));
    if (this.inspect) {
      const top = [];
      const ranks = this.row.map(() => 1);
      for (let id = 0; id < logits.length; id++) {
        const score = Number(logits[id]);
        this.row.forEach((value, index) => {
          if (score > value) ranks[index]++;
        });
        if (top.length < 12 || score > top[top.length - 1].score) {
          top.push({ id, score });
          top.sort((a, b) => b.score - a.score);
          if (top.length > 12) top.pop();
        }
      }
      this.diagnostic = { ranks, top };
    }
    return logits; // Observe raw scores without masking or altering sampling.
  }
  processSampledToken() {} // The sampled token is not the decision.
  resetState() {} // Each field explicitly clears row before requesting scores.
}

async function load() {
  if (engine) {
    send('ready');
    return;
  }
  if (!self.navigator.gpu)
    throw new Error(
      'This browser does not expose WebGPU. Try a current desktop Chrome or Edge.',
    );
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter)
    throw new Error(
      'No WebGPU adapter is available. Enable hardware acceleration or try another device.',
    );
  if (!adapter.features.has('shader-f16'))
    throw new Error(
      'This Qwen build requires WebGPU shader-f16. Try a recent desktop browser/GPU.',
    );
  send('progress', {
    message: 'Loading the matching MLC tokenizer…',
    progress: 0,
  });
  const response = await fetch(MODEL_URL + 'tokenizer.json');
  if (!response.ok)
    throw new Error(`Tokenizer download failed (${response.status})`);
  tokenizer = await Tokenizer.fromJSON(await response.arrayBuffer());
  labelIds = Object.fromEntries(
    Object.entries(ROLE_LABELS).map(([role, labels]) => [
      role,
      labels.map((label) => {
        const tokens = tokenizer.encode(label);
        if (tokens.length !== 1 || tokenizer.decode(tokens) !== label)
          throw new Error(
            'The tokenizer does not support the required single-token labels',
          );
        return tokens[0];
      }),
    ]),
  );
  for (const ids of Object.values(labelIds))
    if (new Set(ids).size !== 3) throw new Error('Candidate labels collide');
  capture = new Capture(labelIds.collector);
  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === MODEL);
  if (!record)
    throw new Error('Pinned WebLLM runtime does not include this Qwen build');
  engine = new MLCEngine({
    appConfig: {
      ...prebuiltAppConfig,
      cacheBackend: 'indexeddb',
      model_list: [{ ...record, model: MODEL_URL, model_lib: MODEL_LIB }],
    },
    logitProcessorRegistry: new Map([[MODEL, capture]]),
    initProgressCallback: (p) =>
      send('progress', { progress: p.progress * 100, message: p.text }),
    logLevel: 'WARN',
  });
  try {
    await engine.reload(MODEL, {
      context_window_size: 2048,
      max_history_size: 1,
    });
  } catch (error) {
    await engine.unload().catch(() => {});
    engine = null;
    throw error;
  }
  send('ready', {
    model: MODEL,
    revision: REVISION,
    runtime: 'WebLLM 0.2.85',
    label_ids: labelIds,
  });
}

async function decide(message) {
  if (!engine) throw new Error('Load the model first');
  const unit = UNIT_DEFINITIONS.find((unit) => unit.id === message.unitId);
  if (!unit) throw new Error('Unknown villager');
  const prompt = buildDecisionPrompt(
    unit.id,
    message.context,
    message.mission,
    message.rolePrompt,
  );
  const promptTokens = tokenizer.encode(prompt).length;
  if (promptTokens > 1800)
    throw new Error(
      `Observation and policy exceed the 1,800-token input limit (${promptTokens} tokens). Shorten the role policy.`,
    );
  const start = performance.now();
  // A fresh local observation is taken for each actor, in a fair round-robin.
  // One engine scores one output position; generated text is never used.
  capture.ids = labelIds[unit.role];
  capture.row = null;
  capture.inspect = message.testOnly === true;
  capture.diagnostic = null;
  const response = await engine.completions.create({
    model: MODEL,
    prompt,
    max_tokens: 1,
    temperature: 0,
    top_p: 1,
    repetition_penalty: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    ignore_eos: true,
  });
  if (!capture.row)
    throw new Error('WebLLM did not expose the requested candidate scores');
  send('decision', {
    ...(capture.inspect
      ? {
          diagnostic: {
            ...capture.diagnostic,
            sampled_text: response.choices?.[0]?.text,
            top: capture.diagnostic.top.map((item) => {
              let token;
              try {
                token = tokenizer.decode(new Int32Array([item.id]));
              } catch {
                token = '[padding]';
              }
              return { ...item, token };
            }),
          },
        }
      : {}),
    ...assemble(schemaFor([unit]), [capture.row]),
    model: MODEL,
    model_revision: REVISION,
    id: message.id,
    epoch: message.epoch,
    unitId: unit.id,
    testOnly: message.testOnly === true,
    elapsed_ms: performance.now() - start,
    fields_scored: 1,
    backend_requests: 1,
    prompt_tokens: promptTokens,
    scheduling: 'round-robin',
    usage: response.usage,
  });
}

self.onmessage = async ({ data }) => {
  if (busy) {
    send('error', {
      message: 'Inference is already running',
      epoch: data.epoch,
    });
    return;
  }
  busy = true;
  try {
    if (data.type === 'load') await load();
    else if (data.type === 'decide') await decide(data);
  } catch (error) {
    send('error', {
      message: error.message || String(error),
      epoch: data.epoch,
      id: data.id,
      operation: data.type,
    });
  } finally {
    busy = false;
  }
};
