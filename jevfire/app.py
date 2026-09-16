"""Serve categorical decisions beside a CUDA vLLM deployment."""

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException

from .core import BackendError, DecisionEngine
from .models import DecisionRequest


@asynccontextmanager
async def lifespan(app: FastAPI):
    from transformers import AutoTokenizer

    model = os.environ.get("DECISION_MODEL", "qwen3.8-27b")
    tokenizer_path = os.environ.get("DECISION_TOKENIZER", "Qwen/Qwen3.8-27B-FP8")
    tokenizer = AutoTokenizer.from_pretrained(
        tokenizer_path,
        revision=os.environ.get("DECISION_TOKENIZER_REVISION"),
        local_files_only=os.environ.get("DECISION_LOCAL_FILES_ONLY", "0") == "1",
    )
    headers = {}
    if os.environ.get("DECISION_VLLM_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["DECISION_VLLM_API_KEY"]
    async with httpx.AsyncClient(
        base_url=os.environ.get("DECISION_VLLM_URL", "http://127.0.0.1:8000"),
        timeout=httpx.Timeout(120, connect=5),
        headers=headers,
        trust_env=False,
    ) as client:
        response = await client.get("/v1/models")
        response.raise_for_status()
        entry = next(
            (item for item in response.json()["data"] if item["id"] == model), None
        )
        if entry is None:
            raise RuntimeError(f"Configured model {model!r} is not served by vLLM")
        app.state.engine = DecisionEngine(
            client,
            tokenizer,
            model,
            entry["max_model_len"],
            max_score_tokens=int(os.environ.get("DECISION_MAX_SCORE_TOKENS", "128")),
            cache_block_tokens=int(os.environ.get("DECISION_CACHE_BLOCK_TOKENS", "0")),
        )
        if app.state.engine.max_score_tokens > 128:
            # Fail startup against a stock backend rather than advertise a
            # working endpoint that fails on large category sets.
            await app.state.engine._score(
                [tokenizer.encode("Choose A.", add_special_tokens=False)],
                [label.token_id for label in app.state.engine.labels],
                None,
            )
        yield


app = FastAPI(
    title="JEVfire",
    version="0.1.0",
    description=(
        "CUDA inference through vLLM batched selected-token scoring. Flat boolean/enum "
        "fields only. Probabilities are relative candidate scores, not calibrated confidence. "
        "Serve on loopback or behind an authenticated gateway."
    ),
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    engine = app.state.engine
    try:
        response = await engine.client.get("/health")
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(503, "vLLM backend is unavailable") from exc
    return {
        "status": "ok",
        "model": engine.model,
        "max_choices": len(engine.labels),
        "max_score_tokens": engine.max_score_tokens,
    }


@app.post("/v1/decisions")
async def decisions(request: DecisionRequest):
    try:
        return await app.state.engine.classify(request)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "vLLM scoring timed out") from exc
    except (BackendError, httpx.HTTPError) as exc:
        raise HTTPException(
            502, "vLLM scoring failed; no decision was substituted"
        ) from exc
