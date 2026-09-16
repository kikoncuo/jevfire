"""Compare split and single-call scoring on the same patched vLLM engine."""

import argparse
import asyncio
import json
import random
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .benchmark import measure, summarize
from .cases import enum


async def main(args):
    rng = random.Random(20260916)
    cases = []
    for count, winners in [(129, [0, 127, 128]), (255, [0, 127, 128, 173, 254])]:
        for winner in winners:
            cases.append(
                {
                    "id": f"choices_{count}_winner_{winner}",
                    "context": f"The approved inventory category is exactly CATALOG-{winner:03d}. Choose that exact category.",
                    "schema": {
                        "category": enum(
                            "Select the approved inventory category explicitly named in the context.",
                            [f"CATALOG-{i:03d}" for i in range(count)],
                        )
                    },
                    "expected": {"category": f"CATALOG-{winner:03d}"},
                }
            )
    endpoints = {"cap128": args.endpoint128, "cap256": args.endpoint256}
    rows = []
    score_comparisons = []
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        for method, endpoint in endpoints.items():
            health = (await client.get(endpoint + "/health")).json()
            assert health["max_score_tokens"] == int(method[3:]), health
        with output.with_suffix(".jsonl").open("w") as stream:
            for case in cases:
                for cache in ["fresh_prefix", "warm_prefix"]:
                    salts = {m: str(uuid.uuid4()) for m in endpoints}
                    for method, endpoint in endpoints.items():
                        options = argparse.Namespace(
                            endpoint=endpoint,
                            vllm_url=args.vllm_url,
                            model=args.model,
                        )
                        warmup = await measure(
                            client, options, case, "auto", "warmup", salts[method], -1
                        )
                        if not warmup["exact_match"]:
                            raise RuntimeError(str(warmup))
                    for repeat in range(args.repeats):
                        order = list(endpoints)
                        rng.shuffle(order)
                        for method in order:
                            options = argparse.Namespace(
                                endpoint=endpoints[method],
                                vllm_url=args.vllm_url,
                                model=args.model,
                            )
                            row = await measure(
                                client,
                                options,
                                case,
                                "auto",
                                cache,
                                salts[method]
                                if cache == "warm_prefix"
                                else str(uuid.uuid4()),
                                repeat,
                            )
                            row["method"] = method
                            rows.append(row)
                            stream.write(json.dumps(row) + "\n")
                            stream.flush()
                    # Compare every raw candidate score, not only the winning label.
                    responses = []
                    for endpoint in endpoints.values():
                        response = await client.post(
                            endpoint + "/v1/decisions",
                            json={"context": case["context"], "schema": case["schema"]},
                        )
                        response.raise_for_status()
                        responses.append(
                            response.json()["fields"]["category"]["candidates"]
                        )
                    assert len(responses[0]) == len(responses[1])
                    assert all(
                        a["value"] == b["value"]
                        for a, b in zip(*responses, strict=True)
                    )
                    score_comparisons.append(
                        {
                            "case": case["id"],
                            "cache": cache,
                            "candidate_count": len(responses[0]),
                            "max_absolute_logprob_difference": max(
                                abs(a["logprob"] - b["logprob"])
                                for a, b in zip(*responses, strict=True)
                            ),
                        }
                    )
                    print(case["id"], cache, "complete", flush=True)  # noqa: T201
    output.write_text(
        json.dumps(
            {
                "created_at": datetime.now(UTC).isoformat(),
                "repeats": args.repeats,
                "methodology": "Identical patched engine and prompts, two sidecar endpoints differing only in candidate-score chunk width. Randomized order, unique fresh-prefix salts, separately primed warm salts. Synthetic exact catalog selection at chunk boundaries and final choice. Raw-score comparisons are extra untimed probes.",
                "cases": cases,
                "summary": summarize(rows),
                "score_comparisons": score_comparisons,
                "rows": rows,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint128", default="http://127.0.0.1:8010")
    parser.add_argument("--endpoint256", default="http://127.0.0.1:8011")
    parser.add_argument("--vllm-url", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--output", required=True)
    asyncio.run(main(parser.parse_args()))
