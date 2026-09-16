import { FiniteDecisions, WebLLMBackend } from './sdk/index.js';
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
import { buildDrivingPromptParts } from './driving/prompt.js';
import { buildMarioPromptParts } from './mario/prompt.js';
import { validateControl } from './mario/contract.js';

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
  scorer,
  backend,
  scoredFieldObserver = null;
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
    this.vocabulary = this.returnVocab ? Array.from(logits) : undefined;
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
  backend = await WebLLMBackend.create({
    engine,
    model: MODEL,
    runtimeVersion: '0.2.85',
    capture,
    cacheSlots: 6,
    maxPrefixTokens: 512,
  });
  const forward = backend.forward.bind(backend);
  backend.forward = async (...args) => {
    const result = await forward(...args);
    if (args[1]) scoredFieldObserver?.(performance.now());
    return result;
  };
  scorer = new FiniteDecisions({ backend, tokenizer, maxCachedPrefixes: 6 });
  send('ready', {
    sdk_backend: backend.name,
    prefix_cache_slots: backend.cacheSlots,
    cache_fallback_reason: backend.reason,
    model: MODEL,
    revision: REVISION,
    runtime: 'WebLLM 0.2.85',
    label_ids: labelIds,
    driving_semantic_labels: semanticLabels,
    execution: 'single-working-state-sequential',
    gpu_batch_size: 1,
  });
}

async function decide(message, { emit = true } = {}) {
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
  const prepared = (driving ? buildDrivingPromptParts : buildDecisionPrompt)(
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
  const prompt = driving ? prepared.prompt : prepared;
  const tokens = Array.from(tokenizer.encode(prompt));
  const promptTokens = tokens.length;
  if (promptTokens > 1800)
    throw new Error(
      `Observation and policy exceed the 1,800-token input limit (${promptTokens} tokens). Shorten the role policy.`,
    );
  const ids = driving
    ? scoreLabels.map(singleTokenId)
    : labelIds[unit.role].slice(0, choices.length);
  if (ids.some((id) => id === null))
    throw new Error('Driving label is not a single token');
  const throughput = message.pace === 'fast' || message.pace === 'throughput';
  const chunkSize = throughput ? 128 : 32;
  const yieldMs = throughput ? 0 : 16;
  const boundary = prompt.indexOf('<|im_start|>user\n');
  const score = await scorer.score({
    prompt,
    prefix: driving
      ? prepared.prefix
      : boundary < 0
        ? ''
        : prompt.slice(0, boundary),
    cacheKey: `${driving ? 'driving' : 'village'}:${unit.id}`,
    candidateTokenIds: ids,
    chunkSize,
    yieldMs,
    useCache: message.cache !== false,
    returnVocab: message.testOnly === true,
  });
  const row = score.logits;
  const elapsed = score.elapsed_ms;
  let diagnostic;
  if (message.testOnly && score.vocabulary) {
    const top = [];
    const ranks = row.map(() => 1);
    for (let id = 0; id < score.vocabulary.length; id++) {
      const value = score.vocabulary[id];
      row.forEach((candidate, index) => {
        if (value > candidate) ranks[index]++;
      });
      if (top.length < 12 || value > top[top.length - 1].score) {
        top.push({ id, score: value });
        top.sort((a, b) => b.score - a.score);
        if (top.length > 12) top.pop();
      }
    }
    diagnostic = { ranks, top };
  }
  let comparison;
  if (message.testOnly && message.compareWithWhole) {
    await scorer.clear();
    capture.ids = ids;
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
  const payload = {
    type: 'decision',
    ...(diagnostic
      ? {
          prompt,
          diagnostic: {
            ...diagnostic,
            sampled_text: null,
            sampling: 'none',
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
    prefill_chunks: score.usage.forward_calls,
    cache: score.usage,
    fields_scored: 1,
    backend_requests: 1,
    forward_calls: score.usage.forward_calls,
    prompt_tokens: promptTokens,
    scheduling: 'round-robin',
    usage: {
      ...score.usage,
      prompt_tokens: promptTokens,
      scored_positions: 1,
      processed_tokens: score.usage.processed_tokens,
      cached_prefix_tokens: score.usage.cached_prefix_tokens,
    },
  };
  if (emit) send('decision', payload);
  return payload;
}

export function drivingBatchRequests(message) {
  if (
    !Array.isArray(message.requests) ||
    !message.requests.length ||
    message.requests.length > DRIVERS.length
  )
    throw new Error('A driving batch needs 1–4 driver requests');
  const ids = new Set();
  return message.requests.map((request) => {
    if (!request || ids.has(request.unitId))
      throw new Error('Duplicate or missing driver request');
    const actions = driverChoices(
      request.unitId,
      request.actions === undefined
        ? request.context?.availableActions
        : request.actions,
    );
    if (request.context?.self?.id !== request.unitId)
      throw new Error('Driver context identity does not match request');
    ids.add(request.unitId);
    return {
      ...structuredClone(request),
      type: 'decide',
      scenario: 'driving',
      id: message.id,
      epoch: message.epoch,
      mission: message.mission ?? '',
      actions,
      pace: message.pace ?? 'fast',
      cache: message.cache !== false,
      testOnly: message.testOnly === true,
      labelMode: message.labelMode,
    };
  });
}

export function aggregateDecisionUsage(decisions) {
  const sum = (name) =>
    decisions.reduce(
      (total, item) =>
        total + (Number.isFinite(item.usage?.[name]) ? item.usage[name] : 0),
      0,
    );
  return {
    input_tokens: sum('input_tokens'),
    prompt_tokens: sum('prompt_tokens'),
    processed_tokens: sum('processed_tokens'),
    cached_prefix_tokens: sum('cached_prefix_tokens'),
    forward_calls: sum('forward_calls'),
    yield_ms: sum('yield_ms'),
    scored_positions: decisions.length,
    cache_hits: decisions.filter((item) => item.usage?.cache_hit).length,
    execution: 'sequential-driver-jobs',
    gpu_batch_size: 1,
  };
}

async function decideDrivingBatch(message) {
  if (!engine) throw new Error('Load the model first');
  const requests = drivingBatchRequests(message);
  const start = performance.now();
  const decisions = [];
  // One immutable world snapshot, one shared engine owner. SDK checkpoints keep
  // each driver's policy isolated; the runtime exposes sequential suffix work,
  // not a multi-sequence GPU forward. No timers separate these driver jobs.
  for (const [index, request] of requests.entries()) {
    const decision = {
      ...(await decide(request, { emit: false })),
      scheduling: 'fleet',
    };
    decisions.push(decision);
    // The first car can act while the remaining independent fields are scored.
    // The fleet summary still reports all completed work exactly once.
    send('drivingField', {
      id: message.id,
      epoch: message.epoch,
      scenario: 'driving',
      unitId: request.unitId,
      decision,
      batch_size: requests.length,
      index,
      fleet_age_ms: performance.now() - start,
    });
  }
  const usage = aggregateDecisionUsage(decisions);
  send('drivingBatch', {
    id: message.id,
    epoch: message.epoch,
    scenario: 'driving',
    decisions,
    parsed_json: Object.assign(
      {},
      ...decisions.map((item) => item.parsed_json),
    ),
    fields: Object.assign({}, ...decisions.map((item) => item.fields)),
    fields_scored: decisions.length,
    scores_are_calibrated: false,
    elapsed_ms: performance.now() - start,
    per_field_elapsed_ms: Object.fromEntries(
      decisions.map((item) => [item.unitId, item.elapsed_ms]),
    ),
    usage,
    execution: usage.execution,
    gpu_batch_size: 1,
    sdk_backend: backend.name,
    cache_fallback_reason: backend.reason ?? null,
  });
}

async function decideMario(message) {
  if (!engine) throw new Error('Load the model first');
  const labels = ['A', 'B', 'C'];
  const spaced = labels.map((label) => ` ${label}`);
  const leadingSpace = spaced.every((label) => singleTokenId(label) !== null);
  const prepared = buildMarioPromptParts(
    message.context,
    message.mission ?? '',
    message.rolePrompt,
    {
      labels,
      scoreLabels: leadingSpace ? spaced : labels,
      assistantPrefix: leadingSpace ? 'Action:' : 'Action:\n',
    },
  );
  const throughput = message.pace !== 'balanced';
  const start = performance.now();
  let lastField = start;
  const fieldTimes = [];
  scoredFieldObserver = (now) => {
    fieldTimes.push(now - lastField);
    lastField = now;
  };
  let result;
  try {
    result = await scorer.scoreFields({
      ...prepared,
      cacheKey: 'mario:controls',
      useCache: message.cache !== false,
      chunkSize: throughput ? 128 : 32,
      yieldMs: throughput ? 0 : 16,
    });
  } finally {
    scoredFieldObserver = null;
  }
  validateControl(result.parsed_json);
  send('marioDecision', {
    ...result,
    id: message.id,
    epoch: message.epoch,
    scenario: 'mario',
    model: MODEL,
    model_revision: REVISION,
    testOnly: message.testOnly === true,
    elapsed_ms: performance.now() - start,
    fields_scored: prepared.fields.length,
    per_field_elapsed_ms: Object.fromEntries(
      prepared.fields.map((field, index) => [
        field.key,
        fieldTimes[index] ?? null,
      ]),
    ),
    execution: result.usage.execution,
    gpu_batch_size: 1,
    sdk_backend: backend.name,
    cache_fallback_reason: backend.reason ?? null,
    ...(message.testOnly
      ? {
          shared_prompt: prepared.sharedPrompt,
          field_suffixes: Object.fromEntries(
            prepared.fields.map((field) => [field.key, field.suffix]),
          ),
        }
      : {}),
  });
}

// FIFO snapshots protect the one engine owner. Every request either responds or
// reports its own id/epoch; requests arriving during a batch are never dropped.
export function createWorkerQueue(handle, reportError) {
  let tail = Promise.resolve();
  return (data) => {
    let snapshot;
    try {
      snapshot = structuredClone(data);
    } catch (error) {
      reportError(error, data);
      return Promise.resolve();
    }
    const result = tail.then(() => handle(snapshot));
    tail = result.catch((error) => reportError(error, snapshot));
    return tail;
  };
}

const enqueue = createWorkerQueue(
  async (data) => {
    if (!data || typeof data !== 'object')
      throw new Error('Invalid worker message');
    if (data.type === 'load') await load();
    else if (data.type === 'decide') await decide(data);
    else if (data.type === 'decideDrivingBatch') await decideDrivingBatch(data);
    else if (data.type === 'decideMario') await decideMario(data);
    else throw new Error('Unknown worker operation');
  },
  (error, data) => {
    send('error', {
      message: error.message || String(error),
      epoch: data?.epoch,
      id: data?.id,
      operation: data?.type,
    });
  },
);

if (typeof self !== 'undefined') self.onmessage = ({ data }) => enqueue(data);
