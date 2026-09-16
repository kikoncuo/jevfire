import { MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { Tokenizer } from '@mlc-ai/web-tokenizers';
import { UNIT_DEFINITIONS, assemble } from './contract.js';
import {
  buildDecisionPrompt,
  ROLE_LABELS,
  decisionChoices,
} from './decision-prompt.js';
import {
  DRIVERS,
  ACTIONS as DRIVING_ACTIONS,
  CHOICE_LABELS,
  DRIVING_LABEL_MODE,
  DRIVING_LABEL_MODES,
  SEMANTIC_LABEL_CANDIDATES,
  driverChoices,
} from './driving/contract.js';
import { buildDrivingPrompt } from './driving/prompt.js';

const MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
const REVISION = '0ec138972555613c1d7812a821778ad0398c8790';
const MODEL_URL = `https://huggingface.co/mlc-ai/${MODEL}/resolve/${REVISION}/`;
const LIB_REVISION = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4';
const MODEL_LIB = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`;
let engine,
  tokenizer,
  capture,
  labelIds,
  semanticLabels,
  busy = false;
const send = (type, body = {}) => self.postMessage({ type, ...body });

function singleTokenId(label) {
  const tokens = tokenizer.encode(label);
  return tokens.length === 1 && tokenizer.decode(tokens) === label
    ? tokens[0]
    : null;
}

class Capture {
  constructor(ids) {
    this.ids = ids;
    this.row = null;
  }
  processLogits(logits) {
    if (!this.active) return logits;
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
    Object.entries({ ...ROLE_LABELS, driving: CHOICE_LABELS }).map(
      ([role, labels]) => [
        role,
        labels.map((label) => {
          const tokens = tokenizer.encode(label);
          if (tokens.length !== 1 || tokenizer.decode(tokens) !== label)
            throw new Error(
              'The tokenizer does not support the required single-token labels',
            );
          return tokens[0];
        }),
      ],
    ),
  );
  for (const ids of Object.values(labelIds))
    if (new Set(ids).size !== ids.length)
      throw new Error('Candidate labels collide');
  // Resolve semantic probe labels deterministically against the actual pinned
  // tokenizer. Fall back to the verified letter for any unsupported word.
  const usedSemantic = new Set();
  semanticLabels = Object.fromEntries(
    DRIVING_ACTIONS.map((action, index) => {
      const text = [
        ...SEMANTIC_LABEL_CANDIDATES[action],
        CHOICE_LABELS[index],
      ].find((label) => {
        const id = singleTokenId(label);
        return id !== null && !usedSemantic.has(id);
      });
      if (!text) throw new Error('No unique single-token driving label');
      usedSemantic.add(singleTokenId(text));
      return [action, text];
    }),
  );
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
      temperature: 0,
      top_p: 1,
      repetition_penalty: 1,
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
    driving_semantic_labels: semanticLabels,
  });
}

async function decide(message) {
  if (!engine) throw new Error('Load the model first');
  if (
    message.scenario !== undefined &&
    !['village', 'driving'].includes(message.scenario)
  )
    throw new Error('Unknown inference scenario');
  const driving = message.scenario === 'driving';
  const unit = (driving ? DRIVERS : UNIT_DEFINITIONS).find(
    (unit) => unit.id === message.unitId,
  );
  if (!unit) throw new Error(driving ? 'Unknown driver' : 'Unknown villager');
  const choices = driving
    ? driverChoices(
        unit.id,
        message.actions === undefined
          ? message.context?.availableActions
          : message.actions,
      )
    : decisionChoices(unit.id, message.actions);
  const labelMode = driving
    ? message.testOnly === true
      ? (message.labelMode ?? DRIVING_LABEL_MODE)
      : DRIVING_LABEL_MODE
    : null;
  if (driving && !DRIVING_LABEL_MODES.includes(labelMode))
    throw new Error('Unknown driving label mode');
  const drivingLabels = !driving
    ? null
    : labelMode.startsWith('letters')
      ? CHOICE_LABELS.slice(0, choices.length)
      : labelMode === 'rotated'
        ? choices.map((_, index) => CHOICE_LABELS[(index + 1) % choices.length])
        : choices.map((action) => semanticLabels[action]);
  const suffix =
    driving &&
    (labelMode.endsWith('_suffix') ||
      labelMode.endsWith('_compact') ||
      labelMode === 'letters_focused');
  const spacedLabels = drivingLabels?.map((label) => ` ${label}`);
  const useLeadingSpace =
    suffix && spacedLabels.every((label) => singleTokenId(label) !== null);
  const scoreLabels = useLeadingSpace ? spacedLabels : drivingLabels;
  const assistantPrefix = suffix
    ? useLeadingSpace
      ? 'Action:'
      : 'Action:\n'
    : '';
  const prompt = (driving ? buildDrivingPrompt : buildDecisionPrompt)(
    unit.id,
    message.context,
    message.mission,
    message.rolePrompt,
    choices,
    ...(driving
      ? [
          {
            labels: drivingLabels,
            examples: labelMode === 'semantic_examples',
            assistantPrefix,
            compact:
              labelMode.endsWith('_compact') || labelMode === 'letters_focused',
            focused: labelMode === 'letters_focused',
          },
        ]
      : []),
  );
  const tokens = Array.from(tokenizer.encode(prompt));
  const promptTokens = tokens.length;
  if (promptTokens > 1800)
    throw new Error(
      `Observation and policy exceed the 1,800-token input limit (${promptTokens} tokens). Shorten the role policy.`,
    );
  const start = performance.now();
  capture.ids = driving
    ? scoreLabels.map(singleTokenId)
    : labelIds[unit.role].slice(0, choices.length);
  if (capture.ids.some((id) => id === null))
    throw new Error('Driving label is not a single token');
  capture.row = null;
  capture.inspect = message.testOnly === true;
  capture.diagnostic = null;
  // Split prefill into small GPU submissions, yielding between them so the
  // compositor can draw. The worker alone cannot isolate a shared GPU.
  // WebLLM's public low-level API updates KV/recurrent state with input tokens
  // only; intermediate samples are ignored and never fed back into the model.
  const chunkSize = message.pace === 'fast' ? 128 : 32;
  const yieldMs = message.pace === 'fast' ? 4 : 16;
  await engine.resetChat(false, MODEL);
  let sampled;
  for (let offset = 0; offset < tokens.length; offset += chunkSize) {
    const chunk = tokens.slice(offset, offset + chunkSize);
    capture.active = offset + chunk.length === tokens.length;
    sampled = await engine.forwardTokensAndSample(chunk, true, MODEL);
    if (!capture.active)
      await new Promise((resolve) => setTimeout(resolve, yieldMs));
  }
  if (!capture.row)
    throw new Error('WebLLM did not expose the requested candidate scores');
  const row = [...capture.row];
  const diagnostic = capture.diagnostic;
  const elapsed = performance.now() - start;
  let comparison;
  if (message.testOnly && message.compareWithWhole) {
    capture.active = true;
    await engine.resetChat(false, MODEL);
    await engine.completions.create({
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
    const whole = [...capture.row];
    comparison = {
      whole_logits: whole,
      chunked_logits: row,
      max_abs_difference: Math.max(
        ...whole.map((v, i) => Math.abs(v - row[i])),
      ),
      same_winner:
        whole.indexOf(Math.max(...whole)) === row.indexOf(Math.max(...row)),
    };
  }
  const result = assemble({ [unit.id]: choices }, [row]);
  result.fields[unit.id].options = choices;
  send('decision', {
    ...(capture.inspect
      ? {
          prompt,
          diagnostic: {
            ...diagnostic,
            sampled_text: tokenizer.decode(new Int32Array([sampled])),
            comparison,
            top: diagnostic.top.map((item) => {
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
    ...result,
    ...(driving
      ? {
          scenario: 'driving',
          label_mode: labelMode,
          assistant_prefix: assistantPrefix,
          label_spacing: useLeadingSpace ? 'leading-space' : 'bare',
          label_mapping: Object.fromEntries(
            scoreLabels.map((label, index) => [label, choices[index]]),
          ),
        }
      : {}),
    model: MODEL,
    model_revision: REVISION,
    id: message.id,
    epoch: message.epoch,
    unitId: unit.id,
    testOnly: message.testOnly === true,
    elapsed_ms: elapsed,
    prefill_chunk_tokens: chunkSize,
    prefill_chunks: Math.ceil(tokens.length / chunkSize),
    fields_scored: 1,
    backend_requests: 1,
    forward_calls: Math.ceil(tokens.length / chunkSize),
    prompt_tokens: promptTokens,
    scheduling: 'round-robin',
    usage: { prompt_tokens: promptTokens, scored_positions: 1 },
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
