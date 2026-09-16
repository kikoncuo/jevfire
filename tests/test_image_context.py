"""Mock HTTP boundaries; these checks do not evaluate a vision model's accuracy."""

import base64
import json

import httpx
import pytest
from pydantic import ValidationError

from examples.image_context import api_base, image_url, run_image_decisions
from jevfire.models import DecisionRequest


def test_local_image_becomes_data_url(tmp_path):
    path = tmp_path / "frame.png"
    content = b"\x89PNG\r\n\x1a\nexample-bytes"
    path.write_bytes(content)
    encoded = image_url(str(path))
    assert encoded.startswith("data:image/png;base64,")
    assert base64.b64decode(encoded.split(",", 1)[1]) == content


@pytest.mark.parametrize(
    "source",
    ["https://example.org/frame.png", "data:image/png;base64,aW1hZ2U="],
)
def test_image_references_are_preserved(source):
    assert image_url(source) == source


@pytest.mark.parametrize(
    "source", ["data:image/png;base64,%%%", "data:image/png,no", "file:///frame.png"]
)
def test_invalid_references_are_rejected(source):
    with pytest.raises(ValueError):
        image_url(source)


def run_mock_pipeline(vision_choice, decision_result=None):
    requests = []

    def handle(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if request.url.path == "/v1/chat/completions":
            assert payload["messages"][1]["content"][1] == {
                "type": "image_url",
                "image_url": {"url": "https://example.org/frame.png"},
            }
            return httpx.Response(200, json={"choices": [vision_choice]})
        assert request.url.path == "/v1/decisions"
        validated = DecisionRequest.model_validate(payload)
        assert "outdoor scene with readable signs" in validated.context
        assert "image_url" not in json.dumps(payload)
        assert "https://example.org/frame.png" not in validated.context
        return httpx.Response(200, json=decision_result)

    with httpx.Client(
        transport=httpx.MockTransport(handle), base_url="http://local/v1/"
    ) as client:
        result = run_image_decisions(
            client,
            client,
            source="https://example.org/frame.png",
            context="Classify the screenshot.",
            model="vision",
        )
    return result, requests


VISION_CHOICE = {
    "finish_reason": "stop",
    "message": {"content": "An outdoor scene with readable signs."},
}
DECISION_RESULT = {
    "abstained_fields": [],
    "parsed_json": {
        "scene": "outdoor",
        "readable_text": "present",
        "needs_review": False,
    },
}


def test_image_and_text_stages_obey_separate_contracts():
    result, requests = run_mock_pipeline(VISION_CHOICE, DECISION_RESULT)
    assert len(requests) == 2
    assert result["parsed_json"] == DECISION_RESULT["parsed_json"]
    assert result["mode"] == "vision_observation_then_text_decisions"
    assert result["elapsed_ms"]["total"] >= 0


@pytest.mark.parametrize(
    "choice",
    [
        {"finish_reason": "length", "message": {"content": "Truncated observation"}},
        {"finish_reason": "stop", "message": {"content": "  "}},
        {"finish_reason": "stop", "message": {"content": None}},
    ],
)
def test_bad_vision_response_stops_before_scoring(choice):
    with pytest.raises(RuntimeError, match="no decision scored"):
        run_mock_pipeline(choice)


def test_abstention_is_not_accepted():
    with pytest.raises(RuntimeError, match="abstained"):
        run_mock_pipeline(VISION_CHOICE, {"abstained_fields": ["scene"]})


def test_out_of_schema_decision_is_not_accepted():
    invalid = {
        **DECISION_RESULT,
        "parsed_json": {**DECISION_RESULT["parsed_json"], "scene": "invented"},
    }
    with pytest.raises(ValidationError):
        run_mock_pipeline(VISION_CHOICE, invalid)


@pytest.mark.parametrize("endpoint", ["http://local", "http://local/v1/"])
def test_server_origin_and_api_base_are_equivalent(endpoint):
    assert api_base(endpoint) == "http://local/v1/"
