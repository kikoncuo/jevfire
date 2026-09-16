"""Opt-in live checks: DECISION_TEST_URL=http://127.0.0.1:8010 pytest this file."""

import asyncio
import os

import httpx
import pytest

URL = os.environ.get("DECISION_TEST_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not URL, reason="Set DECISION_TEST_URL to run live inference"),
]


def payload():
    return {
        "context": "The user asks: resume toda la historia clínica. No medication is mentioned.",
        "schema": {
            "intent": {
                "type": "enum",
                "description": "User intent",
                "choices": ["patient_summary", "medication_question", "other"],
            },
            "medication_mentioned": {
                "type": "boolean",
                "description": "Whether a specific medication is named",
            },
        },
        "strategy": "batch",
    }


def test_health_and_openapi():
    with httpx.Client(base_url=URL, timeout=30, trust_env=False) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert "/v1/decisions" in client.get("/openapi.json").json()["paths"]


def test_typed_results_and_probabilities():
    with httpx.Client(base_url=URL, timeout=120, trust_env=False) as client:
        response = client.post("/v1/decisions", json=payload())
    response.raise_for_status()
    result = response.json()
    assert result["parsed_json"] == {
        "intent": "patient_summary",
        "medication_mentioned": False,
    }
    assert result["scores_are_calibrated"] is False
    for field in result["fields"].values():
        assert sum(c["probability"] for c in field["candidates"]) == pytest.approx(1)
        assert 0 <= field["candidate_probability_mass"] <= 1.00001


@pytest.mark.parametrize(
    "schema",
    [
        {},
        {"x": {"type": "string", "description": "Unsupported free text"}},
        {
            "x": {
                "type": "enum",
                "description": "Invalid duplicates",
                "choices": ["a", "a"],
            }
        },
    ],
)
def test_invalid_schemas_fail_before_gpu(schema):
    with httpx.Client(base_url=URL, timeout=30, trust_env=False) as client:
        assert (
            client.post(
                "/v1/decisions", json={**payload(), "schema": schema}
            ).status_code
            == 422
        )


@pytest.mark.asyncio
async def test_concurrent_requests_are_independent():
    async with httpx.AsyncClient(base_url=URL, timeout=120, trust_env=False) as client:
        requests = []
        for i in range(4):
            requests.append(
                client.post(
                    "/v1/decisions",
                    json={
                        "context": f"The approved value is ITEM-{i}.",
                        "schema": {
                            "value": {
                                "type": "enum",
                                "description": "Exact approved value",
                                "choices": [f"ITEM-{j}" for j in range(4)],
                            }
                        },
                    },
                )
            )
        responses = await asyncio.gather(*requests)
    for i, response in enumerate(responses):
        response.raise_for_status()
        assert response.json()["parsed_json"]["value"] == f"ITEM-{i}"


def test_large_candidate_sets_and_mixed_batch_rows():
    choices = [f"CATALOG-{i:03d}" for i in range(255)]
    schema = {
        name: {
            "type": "enum",
            "description": f"Select the exact approved category for {name}.",
            "choices": choices,
        }
        for name in ("first", "second")
    }
    schema["approved"] = {"type": "boolean", "description": "Is approval explicit?"}
    with httpx.Client(base_url=URL, timeout=120, trust_env=False) as client:
        cap = client.get("/health").json()["max_score_tokens"]
        response = client.post(
            "/v1/decisions",
            json={
                "context": "Approval is explicit. The approved category for first is exactly CATALOG-254. The approved category for second is exactly CATALOG-128.",
                "schema": schema,
                "strategy": "batch",
            },
        )
    response.raise_for_status()
    body = response.json()
    assert body["parsed_json"] == {
        "first": "CATALOG-254",
        "second": "CATALOG-128",
        "approved": True,
    }
    assert body["backend_requests"] == (1 if cap >= 255 else 2)
    for name in ("first", "second"):
        candidates = body["fields"][name]["candidates"]
        assert len(candidates) == 255
        assert sum(c["probability"] for c in candidates) == pytest.approx(1)
