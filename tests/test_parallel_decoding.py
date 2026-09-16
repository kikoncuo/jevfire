"""Exercise classification boundaries and native vLLM score handling."""

import json
import math

import httpx
import pytest
from pydantic import ValidationError

from jevfire.benchmark import check_result, summarize
from jevfire.core import (
    BackendError,
    DecisionEngine,
    Label,
    build_prompts,
    decode_choice,
    make_labels,
    normalize_scores,
)
from jevfire.models import DecisionField, DecisionRequest


class FakeTokenizer:
    all_special_ids = []

    def __init__(self):
        self.tokens = {}

    def encode(self, text, **kwargs):
        self.tokens.setdefault(text, len(self.tokens) + 1)
        return [self.tokens[text]]

    def decode(self, ids):
        return next(text for text, token in self.tokens.items() if token == ids[0])

    def apply_chat_template(self, messages, **kwargs):
        assert kwargs["enable_thinking"] is False
        assert kwargs["tokenize"] is False
        return json.dumps(messages)


class CharacterTokenizer:
    def encode(self, text, **kwargs):
        return [ord(c) for c in text]

    def decode(self, ids):
        return "".join(chr(i) for i in ids)

    def apply_chat_template(self, messages, **kwargs):
        return (
            "<system>"
            + messages[0]["content"]
            + "<user>"
            + messages[1]["content"]
            + "<assistant>"
        )


def test_cache_alignment_preserves_context_and_complete_field_definitions():
    tokenizer = CharacterTokenizer()
    req = request(strategy="aligned_prefill")
    prompts = build_prompts(req, tokenizer, [Label("A", 1), Label("B", 2)], 32)
    texts = [tokenizer.decode(p) for p in prompts]
    prefix_lengths = [t.index("Selected field definition:") for t in texts]
    assert prefix_lengths[0] == prefix_lengths[1]
    assert prefix_lengths[0] % 32 == 0
    assert texts[0][: prefix_lengths[0]] == texts[1][: prefix_lengths[1]]
    assert '"context": "synthetic test"' in texts[0]
    assert '"A":true,"B":false' in texts[0]
    assert '"A":"same prefix one","B":"same prefix two"' in texts[1]
    assert texts[0].endswith("<assistant>")


def test_alignment_requires_known_cache_configuration():
    with pytest.raises(ValueError, match="DECISION_CACHE_BLOCK_TOKENS"):
        build_prompts(request(strategy="aligned_prefill"), CharacterTokenizer(), [], 0)


def request(**overrides):
    return DecisionRequest.model_validate(
        {
            "context": "synthetic test",
            "schema": {
                "first": {"type": "boolean", "description": "first decision"},
                "second": {
                    "type": "enum",
                    "description": "second decision",
                    "choices": ["same prefix one", "same prefix two"],
                },
            },
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "field",
    [
        {"type": "enum", "description": "x", "choices": ["a", "a"]},
        {"type": "enum", "description": "x"},
        {"type": "array", "description": "x"},
        {"type": "boolean", "description": "x", "choices": ["true", "false"]},
        {"type": "enum", "description": "x", "choices": [True, False]},
        {"type": "enum", "description": "x", "choices": ["", "a"]},
    ],
)
def test_reject_unsupported_or_ambiguous_fields(field):
    with pytest.raises(ValidationError):
        DecisionField.model_validate(field)


def test_empty_schema_and_nan_rejected():
    with pytest.raises(ValidationError):
        request(schema={})
    with pytest.raises(ValidationError):
        request(score_temperature=float("nan"))


def test_labels_roundtrip_and_are_unique():
    tokenizer = FakeTokenizer()
    labels = make_labels(tokenizer)
    assert len(labels) == len({label.token_id for label in labels}) == 255
    assert all(tokenizer.decode([label.token_id]) == label.text for label in labels)


def test_stable_softmax_and_invalid_scores():
    assert normalize_scores([-10001, -10000], 1) == pytest.approx(
        [0.268941, 0.731059], abs=1e-6
    )
    for invalid in [[], [float("nan")], [float("-inf")]]:
        with pytest.raises(BackendError):
            normalize_scores(invalid, 1)


def test_missing_candidates_never_fall_back_to_first():
    req = request()
    with pytest.raises(BackendError):
        decode_choice(
            {"logprobs": {"top_logprobs": [{"token_id:1": -1}]}},
            req.fields["first"],
            [Label("A", 1), Label("B", 2)],
            req,
        )


def test_abstention_and_booleans_preserve_types():
    req = request(min_probability=0.9)
    data = {"logprobs": {"top_logprobs": [{"token_id:1": -2, "token_id:2": -1.9}]}}
    result = decode_choice(
        data, req.fields["first"], [Label("A", 1), Label("B", 2)], req
    )
    assert result["value"] is None and result["abstained"]
    assert result["selected_value"] is False
    assert result["probability"] < 0.75  # no artificial confidence floor
    assert result["candidate_probability_mass"] == pytest.approx(
        math.exp(-2) + math.exp(-1.9)
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "strategy,expected_calls", [("batch", 1), ("prefill_then_batch", 2)]
)
async def test_native_scoring_contract_and_result_order(strategy, expected_calls):
    calls = []

    def handle(req):
        payload = json.loads(req.content)
        calls.append(payload)
        ids = payload["logprob_token_ids"]
        assert payload["max_tokens"] == 1
        assert payload["logprobs"] == 0
        assert (
            "allowed_token_ids" not in payload
        )  # raw likelihoods, no masked-score artefact
        assert payload["cache_salt"] == "test-isolation"
        choices = [
            {
                "index": i,
                "logprobs": {
                    "top_logprobs": [
                        {f"token_id:{ids[0]}": -8, f"token_id:{ids[1]}": -0.01}
                    ]
                },
            }
            for i in range(len(payload["prompt"]))
        ]
        return httpx.Response(
            200,
            json={
                "choices": choices[::-1],
                "usage": {"completion_tokens": len(choices)},
            },
        )

    async with httpx.AsyncClient(
        base_url="http://backend", transport=httpx.MockTransport(handle)
    ) as client:
        engine = DecisionEngine(client, FakeTokenizer(), "test", 16000)
        result = await engine.classify(
            request(strategy=strategy, cache_salt="test-isolation")
        )
    assert len(calls) == expected_calls
    assert result["parsed_json"] == {"first": False, "second": "same prefix two"}
    assert result["scores_are_calibrated"] is False
    assert result["usage"]["completion_tokens"] == 2


@pytest.mark.asyncio
async def test_context_overflow_is_rejected_before_inference():
    async with httpx.AsyncClient() as client:
        engine = DecisionEngine(client, FakeTokenizer(), "test", 1)
        with pytest.raises(ValueError, match="context window"):
            await engine.classify(request())


@pytest.mark.asyncio
@pytest.mark.parametrize("score_limit,expected_calls", [(128, 2), (256, 1)])
async def test_large_category_set_scores_all_chunks_before_normalizing(
    score_limit, expected_calls
):
    calls = []
    tokenizer = FakeTokenizer()
    labels = make_labels(tokenizer)
    winner = labels[173].token_id

    def handle(req):
        payload = json.loads(req.content)
        calls.append(payload)
        ids = payload["logprob_token_ids"]
        assert len(ids) <= score_limit
        scores = {f"token_id:{tid}": (-0.01 if tid == winner else -20) for tid in ids}
        return httpx.Response(
            200,
            json={
                "choices": [{"index": 0, "logprobs": {"top_logprobs": [scores]}}],
                "usage": {"completion_tokens": 1},
            },
        )

    async with httpx.AsyncClient(
        base_url="http://backend", transport=httpx.MockTransport(handle)
    ) as client:
        engine = DecisionEngine(
            client, tokenizer, "test", 16000, max_score_tokens=score_limit
        )
        req = request(
            schema={
                "category": {
                    "type": "enum",
                    "description": "Which category?",
                    "choices": [f"CATEGORY-{i}" for i in range(255)],
                }
            }
        )
        result = await engine.classify(req)
    assert result["parsed_json"] == {"category": "CATEGORY-173"}
    assert len(calls) == result["backend_requests"] == expected_calls
    assert result["usage"]["completion_tokens"] == expected_calls
    if expected_calls == 2:
        assert calls[0]["prompt"] == calls[1]["prompt"]
    candidates = result["fields"]["category"]["candidates"]
    assert len(candidates) == 255
    assert sum(c["probability"] for c in candidates) == pytest.approx(1)


@pytest.mark.asyncio
async def test_duplicate_backend_indices_rejected():
    def handle(req):
        return httpx.Response(200, json={"choices": [{"index": 0}, {"index": 0}]})

    async with httpx.AsyncClient(
        base_url="http://backend", transport=httpx.MockTransport(handle)
    ) as client:
        engine = DecisionEngine(client, FakeTokenizer(), "test", 16000)
        with pytest.raises(BackendError, match="duplicate"):
            await engine.classify(request(strategy="batch"))


def test_benchmark_does_not_count_string_booleans_as_valid():
    case = {"schema": {"flag": {"type": "boolean"}}, "expected": {"flag": False}}
    assert check_result(case, {"flag": "false"}) == (False, 0, 1)
    assert check_result(case, {"flag": False}) == (True, 1, 1)


def test_benchmark_failures_remain_in_denominator():
    rows = [
        {
            "case": "c",
            "cache": "fresh_prefix",
            "method": "batch",
            "field_count": 1,
            "latency_ms": 100,
            "error": None,
            "schema_valid": True,
            "exact_match": True,
            "correct_fields": 1,
            "total_fields": 1,
        },
        {
            "case": "c",
            "cache": "fresh_prefix",
            "method": "batch",
            "field_count": 1,
            "latency_ms": 300,
            "error": "failure",
            "schema_valid": False,
            "exact_match": False,
            "correct_fields": 0,
            "total_fields": 1,
        },
    ]
    summary = summarize(rows)[0]
    assert summary["n"] == 2
    assert summary["errors"] == 1
    assert summary["field_accuracy"] == 0.5
