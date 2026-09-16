import { sameBufferCopies } from './webgpu-copy.js';
// Version-gated adapter for WebLLM 0.2.85's TVM pipeline. No dependency files
// are patched. Each fork includes *all* active KV + recurrent states.
export class WebLLMBackend {
  static async create({
    engine,
    model,
    runtimeVersion,
    cacheSlots = 6,
    maxPrefixTokens = 512,
    capture,
  }) {
    if (runtimeVersion !== '0.2.85')
      return new PublicWebLLMBackend(
        engine,
        model,
        capture,
        'Unsupported WebLLM version',
      );
    let backend;
    try {
      const [, pipeline] = engine.getLLMStates(
        'JEVfire finite decisions',
        model,
      );
      backend = new WebLLMBackend(pipeline, cacheSlots, maxPrefixTokens);
      await backend.initialize();
      return backend;
    } catch (error) {
      if (backend) await backend.restoreOriginal();
      await engine.resetChat(false, model);
      return new PublicWebLLMBackend(engine, model, capture, error.message);
    }
  }

  constructor(pipeline, cacheSlots, maxPrefixTokens) {
    if (
      !Number.isInteger(cacheSlots) ||
      cacheSlots < 1 ||
      cacheSlots > 8 ||
      !Number.isInteger(maxPrefixTokens) ||
      maxPrefixTokens < 1 ||
      maxPrefixTokens > 1024
    )
      throw new Error('Invalid cache allocation');
    this.pipeline = pipeline;
    this.tvm = pipeline.tvm;
    this.cacheSlots = cacheSlots;
    // Whole pages avoid copying a partially filled KV page on every fork.
    this.prefixAlignment = 16;
    this.maxPrefixTokens = maxPrefixTokens;
    this.name = 'webllm-0.2.85-forked-state';
    this.prefixSlots = new Set();
    this.working = false;
    this.owned = [];
  }

  async initialize() {
    const p = this.pipeline,
      tvm = this.tvm;
    if (
      p.slidingWindowSize !== -1 ||
      !p.embedAndForward ||
      !p.updateLogitsOnCPU ||
      !tvm?.scalar ||
      !p.getActiveKVStates
    )
      throw new Error('Unsupported WebLLM pipeline ABI');
    this.original = { kvCache: p.kvCache, rnnState: p.rnnState };
    this.copyAdapter = sameBufferCopies(tvm.lib.webGPUContext);
    this.gpu = tvm.lib.webGPUContext.device;
    this.onGpuError = (event) => {
      this.failure ??= new Error('WebGPU state error: ' + event.error.message);
    };
    this.gpu.addEventListener('uncapturederror', this.onGpuError);
    tvm.beginScope();
    try {
      this.fork = tvm.detachFromCurrentScope(
        tvm.getGlobalFunc('vm.builtin.kv_state_fork_sequence'),
      );
      this.owned.push(this.fork);
      if (p.kvCache) {
        const create = p.vm.getFunction('create_tir_paged_kv_cache');
        const state = tvm.detachFromCurrentScope(
          create(
            tvm.makeShapeTuple([this.cacheSlots + 1]),
            tvm.makeShapeTuple([
              p.contextWindowSize +
                this.cacheSlots * (this.maxPrefixTokens + 16),
            ]),
            tvm.makeShapeTuple([p.prefillChunkSize]),
            tvm.makeShapeTuple([16]),
            tvm.makeShapeTuple([0]),
          ),
        );
        this.owned.push(state);
        p.kvCache = state;
      }
      if (p.rnnState) {
        const create = p.vm.getFunction('create_rnn_state');
        const state = tvm.detachFromCurrentScope(
          create(
            tvm.makeShapeTuple([this.cacheSlots + 1]),
            tvm.makeShapeTuple([1]),
          ),
        );
        this.owned.push(state);
        p.rnnState = state;
      }
      this.states = p.getActiveKVStates();
      for (const state of this.states)
        p.fKVCacheAddSequence(state, tvm.scalar(0, 'int64'));
      this.working = true;
      p.filledKVCacheLength = 0;
      // Exercise both state implementations before accepting any user request.
      for (const state of this.states)
        this.copyAdapter.run(() =>
          this.fork(
            state,
            tvm.scalar(0, 'int64'),
            tvm.scalar(1, 'int64'),
            tvm.scalar(-1, 'int64'),
          ),
        );
      for (const state of this.states)
        p.fKVCacheRemoveSequence(state, tvm.scalar(1, 'int64'));
    } finally {
      tvm.endScope();
    }
    await p.device.sync();
    this.assertHealthy();
  }

  assertHealthy() {
    if (this.failure) throw this.failure;
    if (this.disposed) throw new Error('WebLLM decision backend is disposed');
  }

  scope(callback) {
    this.assertHealthy();
    this.tvm.beginScope();
    try {
      return callback();
    } catch (error) {
      this.failure = error;
      throw error;
    } finally {
      this.tvm.endScope();
    }
  }

  async resetWorking() {
    this.scope(() => {
      for (const state of this.states) {
        if (this.working)
          this.pipeline.fKVCacheRemoveSequence(
            state,
            this.tvm.scalar(0, 'int64'),
          );
        this.pipeline.fKVCacheAddSequence(state, this.tvm.scalar(0, 'int64'));
      }
      this.working = true;
      this.pipeline.filledKVCacheLength = 0;
    });
  }

  async savePrefix(slot, length) {
    if (
      slot < 1 ||
      slot > this.cacheSlots ||
      this.prefixSlots.has(slot) ||
      length > this.maxPrefixTokens
    )
      throw new Error('Invalid prefix checkpoint');
    this.scope(() => {
      for (const state of this.states)
        this.copyAdapter.run(() =>
          this.fork(
            state,
            this.tvm.scalar(0, 'int64'),
            this.tvm.scalar(slot, 'int64'),
            this.tvm.scalar(-1, 'int64'),
          ),
        );
    });
    this.prefixSlots.add(slot);
  }

  async restorePrefix(slot, length) {
    if (!this.prefixSlots.has(slot))
      throw new Error('Missing prefix checkpoint');
    this.scope(() => {
      for (const state of this.states) {
        if (this.working)
          this.pipeline.fKVCacheRemoveSequence(
            state,
            this.tvm.scalar(0, 'int64'),
          );
        this.copyAdapter.run(() =>
          this.fork(
            state,
            this.tvm.scalar(slot, 'int64'),
            this.tvm.scalar(0, 'int64'),
            this.tvm.scalar(-1, 'int64'),
          ),
        );
      }
      this.working = true;
      this.pipeline.filledKVCacheLength = length;
    });
  }

  async releasePrefix(slot) {
    if (!this.prefixSlots.has(slot)) return;
    this.scope(() => {
      for (const state of this.states)
        this.pipeline.fKVCacheRemoveSequence(
          state,
          this.tvm.scalar(slot, 'int64'),
        );
    });
    this.prefixSlots.delete(slot);
  }

  async forward(tokens, ids, { returnVocab = false } = {}) {
    this.assertHealthy();
    const p = this.pipeline;
    if (tokens.length + p.filledKVCacheLength > p.contextWindowSize)
      throw new Error('Context capacity exceeded');
    this.tvm.beginScope();
    try {
      const logits = await p.embedAndForward([tokens], tokens.length);
      const cpu = ids ? p.updateLogitsOnCPU(logits) : null;
      // No sampling, softmax or CPU vocabulary readback for intermediate chunks.
      await p.device.sync();
      this.assertHealthy();
      if (!ids) return {};
      const vocabulary = cpu.toArray();
      return {
        logits: ids.map((id) => Number(vocabulary[id])),
        vocabulary: returnVocab ? Array.from(vocabulary) : undefined,
      };
    } finally {
      this.tvm.endScope();
    }
  }

  dispose() {
    return this.restoreOriginal();
  }

  async restoreOriginal() {
    if (this.disposed) return;
    this.disposed = true;
    this.gpu?.removeEventListener('uncapturederror', this.onGpuError);
    await this.pipeline.device.sync();
    if (this.original) {
      Object.assign(this.pipeline, this.original);
      this.pipeline.resetChat();
    }
    for (const resource of this.owned.reverse()) resource.dispose();
    this.owned = [];
    await this.pipeline.device.sync();
    this.copyAdapter?.dispose();
  }
}

export class PublicWebLLMBackend {
  constructor(engine, model, capture, reason = 'Prefix forking unavailable') {
    if (!capture)
      throw new Error('Public fallback needs a registered logit capture');
    Object.assign(this, {
      engine,
      model,
      capture,
      cacheSlots: 0,
      name: 'webllm-public-independent',
      reason,
    });
  }
  dispose() {
    this.capture.active = false;
    return this.resetWorking();
  }
  resetWorking() {
    return this.engine.resetChat(false, this.model);
  }
  async forward(tokens, ids, { returnVocab = false } = {}) {
    this.capture.active = Boolean(ids);
    this.capture.ids = ids || [];
    this.capture.row = null;
    this.capture.returnVocab = returnVocab;
    await this.engine.forwardTokensAndSample(tokens, true, this.model);
    return ids
      ? { logits: this.capture.row, vocabulary: this.capture.vocabulary }
      : {};
  }
}
