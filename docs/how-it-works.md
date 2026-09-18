# How JEVfire works

JEVfire turns independent, finite decisions into typed variable assignments.
It asks an existing language model to score choices, then constructs the output
object in Python. The implementation lives in [core.py](../jevfire/core.py);
the [API reference](api.md) defines its flat boolean/enum schema.

## From context to values

For each field, JEVfire maps the allowed values to labels that its tokenizer
verifies are distinct, round-tripping single tokens. For example, `maneuver`
could map `A → "brake"`, `B → "coast"`, and `C → "accelerate"`; a boolean maps
labels to actual `true`/`false` values. Labels are scoring handles, not the
returned values.

Every field gets its own prompt:

```text
Shared system instructions
Shared user context
Selected field definition: name, description, label → value options
Assistant response prefix supplied by the model's chat template
```

The shared prefix contains instructions and context. JEVfire does **not** put
the entire schema in that prefix: each suffix contains only its selected field.
Fields do not see one another's selected answers. Consequently, this approach
does not enforce dependencies between fields; use application checks or staged
requests when decisions depend on earlier results.

JEVfire submits the tokenized prompts to vLLM's `/v1/completions` endpoint with
`max_tokens: 1` and `logprob_token_ids` identifying the labels to score. vLLM
runs the pretrained model on CUDA and returns their next-token log probabilities.
The normal decoder stack and existing language-model output head perform this
work: scoring one output position does **not** mean running only one layer,
adding classifier heads, or training a new model. Selecting a few token scores
also does not imply that the engine computes only those vocabulary logits.

## What is shared, and what is parallel

vLLM owns model weights, scheduling, and cached model state. Its prefix cache
can reuse eligible completed blocks for matching token prefixes; cache settings,
model architecture, block alignment, availability, and eviction affect reuse.
It does not reuse arbitrary similar text. See the primary
[vLLM prefix-cache design](https://docs.vllm.ai/en/latest/design/prefix_caching/)
and this repository's [deployment settings](deployment.md).

- `batch` submits the field prompts together. A cold batch can still duplicate
  common-prefix work before reusable state is available.
- `prefill_then_batch` completes one real field first, then submits the others
  so they can reuse completed prefix blocks.
- `aligned_prefill` additionally pads the shared prefix to the deployment's
  verified block boundary. Padding changes token positions, so check decision
  quality as well as latency. `auto` selects alignment only when configured and
  its field-count/context-length conditions are met.

Batching lets the engine execute independent fields in parallel when scheduling
permits. It guarantees neither one GPU forward pass nor a single backend call.
Long prompts can require multiple scheduling steps, and large label sets are
scored in request-sized chunks. Each chunk retains the same full-option prompt;
raw scores are combined before normalization. `backend_requests` counts HTTP
calls, not GPU forward passes.

## Scores and JSON

For a field's returned label log probabilities `s[i]`, Python computes
`p[i] = softmax(s[i] / score_temperature)` over **that field's candidates**.
It picks the largest `p[i]` and looks up the associated typed value. Positive
temperature and softmax preserve the argmax of the scores; they change the
reported distribution, not which label wins, apart from numerical ties.
Log probabilities also preserve the raw logits' ranking because their vocabulary
normalization subtracts the same constant from every score at that position.
The optional probability threshold can instead make the result `null`.

These relative probabilities are not calibrated correctness estimates.
`candidate_probability_mass` separately reports how much of the full vocabulary
probability belonged to the allowed labels. Missing or nonfinite requested
scores fail the request rather than silently selecting a default.

The generated completion text is ignored. Python assembles declared keys and
mapped values into `parsed_json`, and the API serializes it. That guarantees
structure and allowed types/values for successful responses, including optional
abstention; it cannot make an incorrect choice true or a game action sensible.
See [guarantees and limits](guarantees.md).

## Relationship to JEV / RLCD

**Naming matters:** the source comparison below refers to the community
`harshatheg/Qwen-2.5-1B-RLCD` demo, not TypeSafe's proprietary Jev model.
TypeSafe expands RLCD as **Reinforcement Learning for Calibrated Decisions**.
JEVfire does not implement that training. Some similarly named open models use
supervised fine-tuning; the related RLCR research actually uses reinforcement
learning. [Model examples and training recipes](decision-models.md).

[The interactive field guide](https://kikoncuo.github.io/jevfire/learn.html)
animates score normalization, cache reuse, and constrained decoding as an
alternative. Restricting tokens and training a model are separate choices.

The shared objective is to score finite fields using common context and assemble
structured output without autoregressively spelling out the whole JSON object.
Both implementations use an existing pretrained model and its language-model
head. JEVfire is an independent integration with a serving engine, not a claim
to reproduce the exact algorithm, scores, or accuracy of the original demo.

The comparison below refers to the original repository at commit
`2af86848be75847ccb3553b0941cc51d6ef7e4e9`, rather than relying on its name or
headline claims:

| Mechanism | Original JEV / RLCD source | JEVfire |
|:--|:--|:--|
| Shared prompt | Context and a compact catalog of field names/descriptions | Instructions/context; selected field definition in each suffix |
| Cache handling | Directly copies/repeats KV state across batched field suffixes | Delegates prefix-block reuse and scheduling to vLLM |
| Candidate representation | Boolean tokens or first tokens after an enum's common prefix | Verified distinct single-token labels mapped to full typed values |
| Execution | Direct model calls through MLX or Transformers/PyTorch | HTTP sidecar using an already running CUDA/vLLM server |
| Output | Builds a Python result object | Builds a Python result object |

The original MLX path also has a short continuation/fallback path for colliding
enum tokens; its PyTorch path does not implement that same resolution. Surrogate
labels avoid that particular token-prefix ambiguity, but their phrasing and
ordering can still affect model decisions.

Primary sources: the original
[schema compiler](https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD/blob/2af86848be75847ccb3553b0941cc51d6ef7e4e9/core/schema.py),
[MLX engine](https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD/blob/2af86848be75847ccb3553b0941cc51d6ef7e4e9/core/engine_mlx.py),
and [PyTorch engine](https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD/blob/2af86848be75847ccb3553b0941cc51d6ef7e4e9/core/engine_torch.py).
[Attribution and licenses](../THIRD_PARTY_NOTICES.md) explain the relationship.

## The browser demos

Last Hearth, Slipstream and World 1-1 apply the finite-choice idea through
WebLLM/WebGPU. The browser SDK caches exact instruction prefixes across actor
updates and can restore one shared context for multiple independent field
suffixes. It preserves both attention KV state and Qwen3.5 recurrent state.
The pinned WebLLM build executes these suffixes sequentially, not as a physical
multi-sequence GPU batch. Downloaded model caching and prompt-state caching are
different mechanisms. The server's CUDA benchmark does not describe browser
performance. See the [browser SDK](browser-sdk.md), [World 1-1](mario-demo.md)
and [browser implementation](../web/README.md).
