"""Summarize recorded GPU probes and races; never invent missing runs."""

import gzip
import json
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


def stats(rows):
    if not rows:
        return None
    return {
        "mean": statistics.mean(rows),
        "median": statistics.median(rows),
        "count": len(rows),
    }


legacy = load("driving-legacy-quality-result.json")
final = load("driving-quality-result.json")
lookup = {(r["scene"], r["round"]): r for r in legacy["rows"]}
optimized = [r for r in final["rows"] if r["variant"] == "optimized"]
comparisons = [
    {
        "scene": r["scene"],
        "round": r["round"],
        "expected": r["expected"],
        "legacy": lookup[r["scene"], r["round"]]["action"],
        "optimized": r["action"],
        "legacy_accepted": lookup[r["scene"], r["round"]]["accepted"],
        "optimized_accepted": r["accepted"],
    }
    for r in optimized
]
result = {
    "source_release": "f2ce8867a1b329d19b3cc228af152c9fafdc2028",
    "model": "Qwen3.5-0.8B-q4f16_1-MLC",
    "model_revision": "0ec138972555613c1d7812a821778ad0398c8790",
    "runtime": "WebLLM 0.2.85",
    "environment": final["environment"],
    "note": "12 handcrafted scenes repeated twice and two paired race seeds; not an external policy benchmark or statistical proof of equivalent driving.",
    "fixed_scenes": {
        "scenes": 12,
        "repeats": 2,
        "same_prompt_cache_chunk_summary": final["summary"],
        "published_release_summary": legacy["summary"],
        "published_vs_optimized_agreement": sum(
            r["legacy"] == r["optimized"] for r in comparisons
        ),
        "comparisons": comparisons,
        "optimized_scorer_ms": stats([r["output"]["elapsed_ms"] for r in optimized]),
        "legacy_scorer_ms": stats([r["output"]["elapsed_ms"] for r in legacy["rows"]]),
    },
    "races": [],
}
for variant in ["legacy", "candidate", "optimized"]:
    for seed in [7, 19]:
        filename = f"driving-race-{variant}-{seed}.json"
        r = load(filename)
        result["races"].append(
            {
                "variant": variant,
                "seed": seed,
                "status": r["status"],
                "raw": filename + ".gz",
                "settings": r["settings"],
                "race_wall_seconds": r["race_wall_seconds"],
                "coverage": r["coverage"],
                "integrity": r["integrity"],
                "quality": {
                    k: v
                    for k, v in r["quality"].items()
                    if k != "captured_fleet_batches"
                },
            }
        )
result["race_totals"] = {}
for variant in ["legacy", "candidate", "optimized"]:
    rows = [r for r in result["races"] if r["variant"] == variant]

    def total(key):
        return sum(r["quality"][key] for r in rows)

    accepted = sum(r["coverage"]["accepted_decisions_authoritative"] for r in rows)
    wall = sum(r["race_wall_seconds"] for r in rows)
    result["race_totals"][variant] = {
        "races": len(rows),
        "finishers": total("finishers"),
        "dnfs": total("dnfs"),
        "contacts": total("contacts"),
        "spins": total("spins"),
        "pit_stops": total("pit_stops"),
        "accepted_decisions": accepted,
        "wall_seconds": wall,
        "decisions_per_second": accepted / wall,
        "winner_time_mean_sim_seconds": statistics.mean(
            r["quality"]["winner_time_sim_seconds"] for r in rows
        ),
        "all_finish_time_mean_sim_seconds": statistics.mean(
            car["finish_time_sim_seconds"]
            for r in rows
            for car in r["quality"]["per_car"]
            if car["finished"]
        ),
        "race_time_mean_sim_seconds": statistics.mean(
            r["quality"]["simulation_seconds"] for r in rows
        ),
        "mean_observation_age_sim_seconds": sum(
            r["quality"]["observation_age_sim_seconds"]["mean"]
            * r["quality"]["observation_age_sim_seconds"]["count"]
            for r in rows
        )
        / sum(r["quality"]["observation_age_sim_seconds"]["count"] for r in rows),
        "worst_observation_age_sim_seconds": max(
            r["quality"]["observation_age_sim_seconds"]["max"] for r in rows
        ),
    }
path = ROOT / "driving-quality-comparison.json"
path.write_text(json.dumps(result, indent=2) + "\n")
print(
    json.dumps(
        {
            "fixed_scenes": {
                k: v for k, v in result["fixed_scenes"].items() if k != "comparisons"
            },
            "race_totals": result["race_totals"],
        },
        indent=2,
    )
)
