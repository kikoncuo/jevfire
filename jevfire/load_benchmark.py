"""Measure closed-loop concurrent request batches, separately for each method."""

import argparse
import asyncio
import json
import random
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .benchmark import measure, summarize
from .cases import benchmark_cases


async def main(args):
    if args.concurrency < 1 or args.requests < args.concurrency:
        raise ValueError("Require requests >= concurrency >= 1")
    cases = [c for c in benchmark_cases() if c["id"] in args.cases.split(",")]
    if not cases:
        raise ValueError("No matching cases")
    methods = args.methods.split(",")
    run_id = str(uuid.uuid4())
    rng = random.Random(20260916)
    rows, groups = [], []
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        with output.with_suffix(".jsonl").open("w") as stream:
            for case in cases:
                for cache in ("fresh_prefix", "warm_prefix"):
                    order = methods.copy()
                    rng.shuffle(order)
                    for method in order:
                        shared_salt = run_id + case["id"] + method + cache
                        warmup = await measure(
                            client, args, case, method, "warmup", shared_salt, -1
                        )
                        if not warmup["exact_match"]:
                            raise RuntimeError(f"Warmup failed: {warmup}")
                        semaphore = asyncio.Semaphore(args.concurrency)

                        async def worker(i):
                            async with semaphore:
                                salt = (
                                    shared_salt
                                    if cache == "warm_prefix"
                                    else str(uuid.uuid4())
                                )
                                row = await measure(
                                    client, args, case, method, cache, salt, i
                                )
                                row["concurrency"] = args.concurrency
                                stream.write(json.dumps(row) + "\n")
                                stream.flush()
                                return row

                        started_at = datetime.now(UTC).isoformat()
                        started = time.perf_counter()
                        batch = await asyncio.gather(
                            *(worker(i) for i in range(args.requests))
                        )
                        seconds = time.perf_counter() - started
                        group = summarize(batch)[0]
                        group.update(
                            started_at=started_at,
                            ended_at=datetime.now(UTC).isoformat(),
                            concurrency=args.concurrency,
                            wall_seconds=seconds,
                            completed_requests_per_second=(
                                args.requests - group["errors"]
                            )
                            / seconds,
                            correct_requests_per_second=group["exact_matches"]
                            / seconds,
                        )
                        rows.extend(batch)
                        groups.append(group)
                        print(json.dumps(group), flush=True)  # noqa: T201
    output.write_text(
        json.dumps(
            {
                "created_at": datetime.now(UTC).isoformat(),
                "run_id": run_id,
                "model": args.model,
                "requests_per_group": args.requests,
                "concurrency": args.concurrency,
                "methodology": "Closed-loop finite batches; one method at a time; per-case randomized method order. Fresh prefixes use unique salts per request; warm prefixes share a separately primed salt. End-to-end latency starts when a worker acquires its client slot. Throughput includes initial fill and final drain. Shared GPU, synthetic fixtures; not a sustained saturation or financial-cost estimate.",
                "groups": groups,
                "rows": rows,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8010")
    parser.add_argument("--vllm-url", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--requests", type=int, default=16)
    parser.add_argument(
        "--cases", default="facts_es,scale_28,long_context_450,cardinality_255"
    )
    parser.add_argument("--methods", default="json_schema,auto")
    parser.add_argument("--output", required=True)
    asyncio.run(main(parser.parse_args()))
