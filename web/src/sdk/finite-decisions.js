// Game-independent finite-choice scoring. The backend owns model execution;
// this layer owns exact-token cache identity, isolation and typed assignment.
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const aborted = (signal) => {
  if (signal?.aborted)
    throw new DOMException('Scoring cancelled', 'AbortError');
};
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${label}`);
  return value;
};

export function probabilities(logits) {
  if (
    !Array.isArray(logits) ||
    !logits.length ||
    !logits.every(Number.isFinite)
  )
    throw new Error('Backend returned invalid candidate scores');
  const maximum = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - maximum));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / sum);
}

export class FiniteDecisions {
  constructor({
    backend,
    tokenizer,
    maxCachedPrefixes = 6,
    maxInputTokens = 1800,
  }) {
    this.backend = backend;
    this.tokenizer = tokenizer;
    this.capacity = Math.min(
      positive(maxCachedPrefixes, 'cache capacity'),
      backend.cacheSlots ?? 0,
    );
    this.maxInputTokens = positive(maxInputTokens, 'input limit');
    this.prefixes = new Map();
    this.nextSlot = 1;
    this.freeSlots = [];
    this.tail = Promise.resolve();
  }

  exclusive(callback) {
    const result = this.tail.then(() => {
      if (this.disposed) throw new Error('Decision SDK is disposed');
      return callback();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  tokens(prompt) {
    if (typeof prompt !== 'string' || !prompt.length)
      throw new Error('Prompt is empty');
    const tokens = Array.from(this.tokenizer.encode(prompt));
    if (!tokens.length || tokens.length > this.maxInputTokens)
      throw new Error(
        `Prompt exceeds the ${this.maxInputTokens}-token input limit (${tokens.length})`,
      );
    return tokens;
  }

  // Encode the complete prompt first. The boundary token can merge with suffix
  // text; never assume encode(prefix)+encode(suffix) equals encode(fullPrompt).
  prefixTokens(prefix, prompt, fullTokens) {
    if (typeof prefix !== 'string' || !prompt.startsWith(prefix))
      throw new Error('Cache prefix must be an exact prompt prefix');
    const candidate = Array.from(this.tokenizer.encode(prefix));
    let length = 0;
    const limit = Math.min(
      candidate.length,
      fullTokens.length - 1,
      this.backend.maxPrefixTokens ?? Infinity,
    );
    while (length < limit && candidate[length] === fullTokens[length]) length++;
    const alignment = this.backend.prefixAlignment ?? 1;
    length -= length % alignment;
    return fullTokens.slice(0, length);
  }

  async evict(key) {
    const entry = this.prefixes.get(key);
    if (!entry) return;
    await this.backend.releasePrefix(entry.slot);
    this.prefixes.delete(key);
    this.freeSlots.push(entry.slot);
  }

  async cache(key, tokens) {
    if (!this.capacity || !tokens.length || !key) return null;
    if (this.prefixes.has(key)) await this.evict(key);
    if (this.prefixes.size >= this.capacity)
      await this.evict(this.prefixes.keys().next().value);
    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    try {
      await this.backend.savePrefix(slot, tokens.length);
    } catch (error) {
      this.freeSlots.push(slot);
      throw error;
    }
    const entry = { slot, tokens: [...tokens] };
    this.prefixes.set(key, entry);
    return entry;
  }

  validateIds(ids) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 0)
    )
      throw new Error(
        'Candidate token IDs must be distinct nonnegative integers',
      );
  }

  score(request) {
    // Snapshot mutable caller data before the request joins the queue.
    const snapshot = {
      ...request,
      candidateTokenIds: [...(request.candidateTokenIds || [])],
    };
    return this.exclusive(() => this.scoreUnlocked(snapshot));
  }

  async scoreUnlocked({
    prompt,
    prefix = '',
    cacheKey = '',
    candidateTokenIds,
    chunkSize = 32,
    yieldMs = 16,
    signal,
    returnVocab = false,
    useCache = true,
    prefixTokens: explicitPrefix,
  }) {
    aborted(signal);
    this.validateIds(candidateTokenIds);
    positive(chunkSize, 'chunk size');
    if (!Number.isFinite(yieldMs) || yieldMs < 0 || yieldMs > 1000)
      throw new Error('Invalid yield duration');
    if (typeof cacheKey !== 'string')
      throw new Error('Cache key must be a string');
    const tokens = this.tokens(prompt);
    const prefixTokens =
      explicitPrefix ?? this.prefixTokens(prefix, prompt, tokens);
    if (
      explicitPrefix &&
      (!Array.isArray(explicitPrefix) ||
        explicitPrefix.length >= tokens.length ||
        explicitPrefix.length > (this.backend.maxPrefixTokens ?? Infinity) ||
        !same(explicitPrefix, tokens.slice(0, explicitPrefix.length)))
    )
      throw new Error('Invalid token prefix');
    const cacheEnabled =
      useCache && this.capacity && prefixTokens.length > 0 && cacheKey;
    const began = performance.now();
    const usage = {
      input_tokens: tokens.length,
      processed_tokens: 0,
      cached_prefix_tokens: 0,
      forward_calls: 0,
      yield_ms: 0,
      scored_positions: 1,
      cache_hit: false,
      backend: this.backend.name,
    };
    let entry = cacheEnabled ? this.prefixes.get(cacheKey) : null;
    if (entry && !same(entry.tokens, prefixTokens)) {
      await this.evict(cacheKey);
      entry = null;
    }
    if (entry) {
      await this.backend.restorePrefix(entry.slot, entry.tokens.length);
      this.prefixes.delete(cacheKey);
      this.prefixes.set(cacheKey, entry);
      usage.cached_prefix_tokens = entry.tokens.length;
      usage.cache_hit = true;
    } else await this.backend.resetWorking();
    let offset = entry?.tokens.length || 0;
    let scores, vocabulary;
    try {
      while (offset < tokens.length) {
        aborted(signal);
        // Cold prefix is checkpointed exactly at its boundary, never by popping
        // a recurrent state back after processing a suffix.
        const boundary =
          !entry && offset < prefixTokens.length
            ? prefixTokens.length
            : tokens.length;
        const end = Math.min(offset + chunkSize, boundary);
        const final = end === tokens.length;
        const result = await this.backend.forward(
          tokens.slice(offset, end),
          final ? candidateTokenIds : null,
          { returnVocab: final && returnVocab },
        );
        usage.processed_tokens += end - offset;
        usage.forward_calls++;
        offset = end;
        if (cacheEnabled && !entry && offset === prefixTokens.length)
          entry = await this.cache(cacheKey, prefixTokens);
        if (final) {
          scores = result.logits;
          vocabulary = result.vocabulary;
        } else if (yieldMs) {
          await new Promise((resolve) => setTimeout(resolve, yieldMs));
          usage.yield_ms += yieldMs;
        }
      }
      aborted(signal);
      if (scores?.length !== candidateTokenIds.length)
        throw new Error('Backend score count mismatch');
      probabilities(scores); // Finite values are required before exposing a result.
      return {
        logits: scores,
        vocabulary,
        elapsed_ms: performance.now() - began,
        usage,
      };
    } catch (error) {
      // A partial execution must never become the next caller's starting state.
      await this.backend.resetWorking();
      throw error;
    }
  }

  scoreFields({ sharedPrompt, fields, cacheKey = 'shared', ...options }) {
    if (!Array.isArray(fields) || !fields.length || fields.length > 64)
      return Promise.reject(new Error('Provide 1–64 fields'));
    const requests = fields.map((field) => ({
      ...field,
      choices: structuredClone(field.choices),
    }));
    return this.exclusive(async () => {
      if (typeof sharedPrompt !== 'string' || !sharedPrompt.length)
        throw new Error('Shared prompt is empty');
      const names = new Set();
      const jobs = requests.map((field) => {
        if (
          typeof field.key !== 'string' ||
          !field.key.length ||
          names.has(field.key)
        )
          throw new Error('Field keys must be unique');
        names.add(field.key);
        if (
          typeof field.suffix !== 'string' ||
          !field.suffix.length ||
          !Array.isArray(field.choices) ||
          !field.choices.length ||
          field.choices.length > 26
        )
          throw new Error('Invalid field definition');
        const ids = field.choices.map(({ label, value }) => {
          if (
            typeof label !== 'string' ||
            !label.length ||
            value === undefined ||
            (!['string', 'number', 'boolean'].includes(typeof value) &&
              value !== null) ||
            (typeof value === 'number' && !Number.isFinite(value))
          )
            throw new Error('Invalid typed option');
          const tokens = Array.from(this.tokenizer.encode(label));
          if (
            tokens.length !== 1 ||
            this.tokenizer.decode(new Int32Array(tokens)) !== label
          )
            throw new Error('Candidate labels must round-trip as one token');
          return tokens[0];
        });
        this.validateIds(ids);
        const prompt = sharedPrompt + field.suffix;
        const tokens = this.tokens(prompt);
        return {
          ...field,
          ids,
          prompt,
          prefix: this.prefixTokens(sharedPrompt, prompt, tokens),
        };
      });
      // One exact-token prefix must work for every suffix, including BPE merges.
      let common = jobs[0].prefix;
      for (const job of jobs.slice(1)) {
        let i = 0;
        while (
          i < common.length &&
          i < job.prefix.length &&
          common[i] === job.prefix[i]
        )
          i++;
        common = common.slice(0, i);
      }
      const values = [],
        details = [],
        results = [];
      for (const job of jobs) {
        const result = await this.scoreUnlocked({
          ...options,
          prompt: job.prompt,
          prefixTokens: common,
          cacheKey,
          candidateTokenIds: job.ids,
        });
        const scores = probabilities(result.logits);
        const index = scores.indexOf(Math.max(...scores));
        values.push([job.key, job.choices[index].value]);
        details.push([
          job.key,
          {
            value: job.choices[index].value,
            probabilities: scores,
            logits: result.logits,
            options: job.choices.map((choice) => choice.value),
          },
        ]);
        results.push(result);
      }
      return {
        parsed_json: Object.fromEntries(values),
        fields: Object.fromEntries(details),
        scores_are_calibrated: false,
        usage: {
          input_tokens: results.reduce(
            (sum, result) => sum + result.usage.input_tokens,
            0,
          ),
          processed_tokens: results.reduce(
            (sum, result) => sum + result.usage.processed_tokens,
            0,
          ),
          cached_prefix_tokens: results.reduce(
            (sum, result) => sum + result.usage.cached_prefix_tokens,
            0,
          ),
          forward_calls: results.reduce(
            (sum, result) => sum + result.usage.forward_calls,
            0,
          ),
          scored_positions: jobs.length,
          cache_hits: results.filter((result) => result.usage.cache_hit).length,
          execution:
            this.capacity && options.useCache !== false && common.length
              ? 'shared-prefix-sequential-suffixes'
              : 'independent-prefills',
        },
        elapsed_ms: results.reduce((sum, result) => sum + result.elapsed_ms, 0),
      };
    });
  }

  dispose() {
    return this.exclusive(async () => {
      this.disposed = true;
      this.prefixes.clear();
      this.freeSlots = [];
      if (this.backend.dispose) await this.backend.dispose();
      else await this.backend.resetWorking();
    });
  }

  clear() {
    return this.exclusive(async () => {
      for (const key of [...this.prefixes.keys()]) await this.evict(key);
      await this.backend.resetWorking();
    });
  }
}
