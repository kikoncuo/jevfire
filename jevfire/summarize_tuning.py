"""Summarize comparable tuning runs and coarse whole-GPU telemetry."""

import argparse
import json
import statistics
from datetime import datetime
from pathlib import Path


def summarize_directory(root):
    runs = []
    for directory in sorted(root.glob("b*-c*")):
        if not (directory / "load.json").exists():
            continue
        latency = json.loads((directory / "latency.json").read_text())
        load = json.loads((directory / "load.json").read_text())
        samples = [
            json.loads(line)
            for line in (directory / "gpu.jsonl").read_text().splitlines()
        ]
        for sample in samples:
            sample["timestamp"] = datetime.fromisoformat(sample["at"]).timestamp()
        for group in load["groups"]:
            start = datetime.fromisoformat(group["started_at"]).timestamp()
            end = datetime.fromisoformat(group["ended_at"]).timestamp()
            window = [s for s in samples if start <= s["timestamp"] <= end]
            if window:
                group["gpu_samples"] = len(window)
                group["mean_gpu_utilization_percent"] = statistics.mean(
                    float(s["gpu"][0]) for s in window
                )
                group["mean_whole_gpu_watts"] = statistics.mean(
                    float(s["gpu"][2]) for s in window
                )
                group["approx_whole_gpu_joules_per_completed_request"] = (
                    group["mean_whole_gpu_watts"]
                    / group["completed_requests_per_second"]
                    if group["completed_requests_per_second"] > 0
                    else None
                )
        rows = latency["rows"] + load["rows"]
        runs.append(
            {
                "configuration": directory.name,
                "requests": len(rows),
                "errors": sum(r["error"] is not None for r in rows),
                "exact_matches": sum(r["exact_match"] for r in rows),
                "correct_fields": sum(r["correct_fields"] for r in rows),
                "total_fields": sum(r["total_fields"] for r in rows),
                "peak_whole_gpu_memory_mib": max(float(s["gpu"][1]) for s in samples),
                "latency": latency["summary"],
                "load": load["groups"],
            }
        )
    return runs


def main(args):
    root = Path(args.root)
    runs = summarize_directory(root)
    result = {
        "methodology": "Same model/precision/memory fraction and fixtures. Serial p50/p95: five repetitions per cell. Closed-loop throughput: 16 requests per cell at concurrency four, including fill/drain; not sustained saturation. GPU telemetry at 500 ms is for the whole shared GPU. Energy/request is an approximate sampled power/throughput proxy, not isolated model energy or financial cost. Runs are sequential, so temporal variation can confound small differences.",
        "runs": runs,
    }
    (root / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    lines = ["# Engine tuning measurements", "", result["methodology"], ""]
    lines += [
        "| Configuration | Requests | Exact matches | Errors | GPU peak MiB |",
        "|---|---:|---:|---:|---:|",
    ]
    for run in runs:
        lines.append(
            f"| {run['configuration']} | {run['requests']} | {run['exact_matches']} | {run['errors']} | {run['peak_whole_gpu_memory_mib']:.0f} |"
        )
    selected = [
        "facts_es",
        "scale_12",
        "scale_28",
        "long_context_450",
        "cardinality_255",
    ]
    for cache in ["fresh_prefix", "warm_prefix"]:
        lines += [
            "",
            f"## Serial latency: {cache}",
            "",
            "| Configuration | Case | JSON p50 ms | Scoring p50 ms | Speedup |",
            "|---|---|---:|---:|---:|",
        ]
        for run in runs:
            indexed = {(r["case"], r["cache"], r["method"]): r for r in run["latency"]}
            for case in selected:
                baseline = indexed[case, cache, "json_schema"]["p50_ms"]
                scoring = indexed[case, cache, "auto"]["p50_ms"]
                lines.append(
                    f"| {run['configuration']} | {case} | {baseline:.1f} | {scoring:.1f} | {baseline / scoring:.2f}× |"
                )
        lines += [
            "",
            f"## Concurrency four: {cache}",
            "",
            "| Configuration | Case | JSON req/s | Scoring req/s | Throughput ratio |",
            "|---|---|---:|---:|---:|",
        ]
        for run in runs:
            indexed = {(r["case"], r["cache"], r["method"]): r for r in run["load"]}
            for case in [c for c in selected if c != "scale_12"]:
                baseline = indexed[case, cache, "json_schema"][
                    "completed_requests_per_second"
                ]
                scoring = indexed[case, cache, "auto"]["completed_requests_per_second"]
                lines.append(
                    f"| {run['configuration']} | {case} | {baseline:.2f} | {scoring:.2f} | {scoring / baseline:.2f}× |"
                )
    (root / "TABLES.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="benchmarks/results/tuning")
    main(parser.parse_args())
