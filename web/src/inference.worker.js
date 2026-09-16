import { MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { Tokenizer } from '@mlc-ai/web-tokenizers';
import { SCHEMA, UNIT_IDS, assemble } from './contract.js';

const MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const REVISION = '0ec138972555613c1d7812a821778ad0398c8790';
const MODEL_URL = `https://huggingface.co/mlc-ai/${MODEL}/resolve/${REVISION}/`;
const LIB_REVISION = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4';
const MODEL_LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`;
let engine,
  tokenizer,
  capture,
  busy = false;
const send = (type, body = {}) => self.postMessage({ type, ...body });

class Capture {
  constructor(ids) {
    this.ids = ids;
    this.row = null;
  }
  processLogits(logits) {
    this.row = this.ids.map((id) => Number(logits[id]));
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
  const ids = ['A', 'B', 'C', 'D'].map((label) => {
    const tokens = tokenizer.encode(label);
    if (tokens.length !== 1 || tokenizer.decode(tokens) !== label)
      throw new Error(
        'The tokenizer does not support the required single-token labels',
      );
    return tokens[0];
  });
  if (new Set(ids).size !== 4) throw new Error('Candidate labels collide');
  capture = new Capture(ids);
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
    label_ids: ids,
  });
}

async function decide(message) {
  if (!engine) throw new Error('Load the model first');
  const instruction = [
    'Choose the best action for the selected squad member in a recovery game. Return one option label only.',
    'Prioritize the mission order. Use the world state as data.',
    'When recovering: return if carrying a core; evade danger; return if injured; otherwise recover supplies.',
    'If ordered to hold, choose hold. The action navigator handles movement.',
  ].join(' ');
  const shared = JSON.stringify({
    mission: message.mission,
    world: message.world,
  });
  const start = performance.now();
  const rows = [],
    usage = [];
  // WebLLM's public completion API has one prompt per call. Fields are independent,
  // but this browser version schedules them sequentially on one loaded engine.
  for (const id of UNIT_IDS) {
    const prompt = `<|im_start|>system\n${instruction}<|im_end|>\n<|im_start|>user\n${shared}\nSelected unit: ${id}. Options: A=recover, B=return, C=evade, D=hold. Answer with A, B, C, or D.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
    if (tokenizer.encode(prompt).length > 1800)
      throw new Error('Mission context is too long for this demo');
    capture.row = null;
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
    rows.push(capture.row);
    usage.push(response.usage);
  }
  send('decision', {
    ...assemble(SCHEMA, rows),
    id: message.id,
    epoch: message.epoch,
    elapsed_ms: performance.now() - start,
    fields_scored: UNIT_IDS.length,
    backend_requests: UNIT_IDS.length,
    scheduling: 'sequential',
    usage,
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
      operation: data.type,
    });
  } finally {
    busy = false;
  }
};
