# Decision API

`POST /v1/decisions` takes a context and a **JEVfire field schema**. The `schema`
property is a mapping of field names to definitions; it is not standard JSON Schema.
The [racing request](../examples/racing-request.json) is a complete example.

| Parameter | Default | Contract |
|:--|:--|:--|
| `context` | required | Nonempty string, at most 100,000 characters; rendered prompt must fit backend token limit |
| `schema` | required | 1–64 independent fields |
| `strategy` | `auto` | `auto`, `batch`, `prefill_then_batch`, `aligned_prefill` |
| `score_temperature` | `1.0` | 0.05–10; rescales label logprobs, not generation temperature |
| `min_probability` | unset | Relative-score abstention threshold from 0–1 |
| `cache_salt` | unset | Nonempty string, at most 256 chars; passed to vLLM |

Boolean field: `{"type":"boolean","description":"Is boost explicitly charged?"}`.
Enum field: `{"type":"enum","description":"Choose a lane.","choices":["left","hold","right"]}`.
Enums need 2–255 distinct, nonblank strings; each is at most 1,000 characters.
Descriptions are 1–4,000 characters; names are 1–128 characters without controls.
Additional properties are rejected.

## Response

The response includes:

| Property | Meaning |
|:--|:--|
| `parsed_json` | Field names mapped to booleans/strings, or `null` on abstention |
| `fields` | Per-field winner, original candidate scores and normalized probabilities |
| `scores_are_calibrated` | Always `false` |
| `abstained_fields` | Fields below the requested relative-score threshold |
| `strategy`, `requested_strategy` | Resolved strategy and caller selection |
| `backend_requests` | Number of native vLLM completion calls |
| `elapsed_ms` | Service-side elapsed time; client latency includes transport |
| `usage` | Logical prompt/output token usage, including cached tokens and padding |
| `max_prompt_tokens`, `cache_block_tokens` | Prompt length and configured cache boundary |

Each entry of `fields` includes `value`, `selected_value`, `probability`,
`abstained`, `candidate_probability_mass`, and a `candidates` list containing
`value`, `label`, `probability`, and `logprob`. `selected_value` remains visible
when `value` is `null`; do not execute it as though abstention succeeded.

The winning probability is normalized **only over that field's candidate labels**.
It is not calibrated correctness. The model may assign little vocabulary mass
to all offered labels. Label mapping and order can influence outcomes.

## Strategies

- `batch`: score all field prompts together.
- `prefill_then_batch`: finish the first field, then submit the remaining fields.
- `aligned_prefill`: align the common prefix to the configured cache boundary,
  finish the first field, then submit the remainder. Requires a positive verified
  `DECISION_CACHE_BLOCK_TOKENS`.
- `auto`: use alignment for at least 16 fields, or at least four fields with
  context at least one cache block long; otherwise batch. With no configured
  cache block, always batch.

Each field includes its full label-to-value mapping in every score chunk. For
more choices than the score cap, raw logprobs from identical prompt chunks are
combined before normalization. The generated token itself is not used.

## Failures

| HTTP | Meaning |
|:--|:--|
| 422 | Invalid schema, unsupported strategy configuration, or overlong prompt |
| 502 | Backend error or missing/nonfinite requested scores |
| 503 | `/health` could not reach a healthy backend |
| 504 | Backend scoring timed out |

There is no fabricated first-choice answer or external-provider fallback.

## Nested objects and arrays

The inference contract is flat. Your application can deterministically compose
known nested structure after scoring, as in [tool_router.py](../examples/tool_router.py):

```python
decision = response["parsed_json"]
command = {
    "routing": {"tool": decision["tool"], "priority": decision["priority"]},
    "checks": [{"name": "confirmation", "required": decision["confirmation"]}],
}
```

This does not infer array length, free-text arguments, sibling dependencies, or
arbitrary nested objects. For dependent decisions, use sequential stages or a
single enum of valid joint actions. Validate action permissions in your own app.
