"""Derive the Mario report from real browser runs and paired cache probes."""

import gzip
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).parent


def load(name):
    path = ROOT / name
    if path.exists():
        return json.loads(path.read_text())
    return json.loads(
        gzip.decompress(path.with_suffix(path.suffix + ".gz").read_bytes())
    )


def stats(values):
    values = sorted(values)
    return {
        "count": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "p95": values[math.ceil(len(values) * 0.95) - 1],
        "max": max(values),
    }


ablation = load("mario-cache-ablation-result.json")
runs = [load(f"mario-fast-run-{i}.json") for i in range(1, 5)]
result = {
    "model": "Qwen3.5-0.8B-q4f16_1-MLC",
    "model_revision": "0ec138972555613c1d7812a821778ad0398c8790",
    "runtime": "WebLLM 0.2.85",
    "environment": load("mario-fast-environment.json"),
    "note": "Qwen selects physics-filtered maneuvers; these are hybrid-controller results on one authored level, not unaided model skill or a general success guarantee.",
    "worker_sha256": "dcec81709f718e8e03aace2acc0d82fb54e131211158ca187cb0271a073e28a3",
    "ablation": {},
    "runs": [],
}
for group, modes in [
    ("raw", ["independent", "shared", "layered"]),
    ("maneuvers", ["uncached", "cached"]),
]:
    result["ablation"][group] = {}
    for mode in modes:
        rows = [pair[mode] for pair in ablation[group]]
        for row in rows:
            usage = row["usage"]
            assert (
                usage["processed_tokens"] + usage["cached_prefix_tokens"]
                == usage["input_tokens"]
            )
        result["ablation"][group][mode] = {
            "worker_ms": stats([row["elapsed_ms"] for row in rows]),
            "input_tokens": sum(row["usage"]["input_tokens"] for row in rows),
            "processed_tokens": sum(row["usage"]["processed_tokens"] for row in rows),
            "cached_tokens": sum(row["usage"]["cached_prefix_tokens"] for row in rows),
            "forward_calls": sum(row["usage"]["forward_calls"] for row in rows),
        }
result["ablation"]["raw_agreement"] = sum(
    pair["same_controls"] for pair in ablation["raw"]
)
result["ablation"]["maneuver_agreement"] = sum(
    pair["same_choice"] for pair in ablation["maneuvers"]
)
all_decisions = []
for index, run in enumerate(runs, 1):
    final = run["final"]
    decisions = run["decisions"]
    assert len(decisions) == final["metrics"]["total_decisions"], (
        "Incomplete decision capture"
    )
    assert not run["errors"]
    assert final["controller"] == "maneuvers" and final["timing"] == "live"
    assert all(
        row["parsed_json"]["maneuver"]
        in [option["id"] for option in row["observedContext"]["options"]]
        for row in decisions
    )
    all_decisions.extend(decisions)
    result["runs"].append(
        {
            "run": index,
            "won": final["won"],
            "sim_seconds": final["time"],
            "wall_seconds": run["wall_seconds"],
            "accepted_choices": len(decisions),
            "choices_per_wall_second": len(decisions) / run["wall_seconds"],
            "worker_ms": stats([row["elapsed_ms"] for row in decisions]),
            "roundtrip_ms": stats([row["roundtrip_ms"] for row in decisions]),
            "cold_first_choice_ms": decisions[0]["elapsed_ms"]
            if not decisions[0]["usage"]["cache_hits"]
            else None,
            "guard": final["executor"],
            "planning": final["planning"],
            "inference": final["inference"],
            "fps_snapshots": stats(
                [
                    sample["frames"]["fps"]
                    for sample in run["samples"]
                    if sample["frames"]["fps"] > 0
                ]
            ),
            "worst_frame_ms": max(
                sample["frames"]["frame_max_ms"] for sample in run["samples"]
            ),
            "raw": f"mario-fast-run-{index}.json.gz",
        }
    )
result["totals"] = {
    "completions": sum(row["won"] for row in result["runs"]),
    "attempts": len(runs),
    "accepted_choices": len(all_decisions),
    "worker_ms": stats([row["elapsed_ms"] for row in all_decisions]),
    "roundtrip_ms": stats([row["roundtrip_ms"] for row in all_decisions]),
    "choices_per_wall_second": len(all_decisions)
    / sum(row["wall_seconds"] for row in result["runs"]),
    "mean_completion_sim_seconds": statistics.mean(
        row["sim_seconds"] for row in result["runs"]
    ),
    "single_option_selections": sum(
        row["guard"]["forcedSelections"] for row in result["runs"]
    ),
    "stale_rejections": sum(
        row["guard"]["rejectedSelections"] for row in result["runs"]
    ),
    "waiting_stops": sum(row["guard"]["waitingStops"] for row in result["runs"]),
}
(ROOT / "mario-fast-results.json").write_text(json.dumps(result, indent=2) + "\n")
print(
    json.dumps({"ablation": result["ablation"], "totals": result["totals"]}, indent=2)
)
