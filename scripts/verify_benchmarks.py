"""Verify published headline numbers and request counts against measured rows."""

import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "benchmarks" / "results"


def main():
    reports = [ROOT / "benchmark.json"]
    for name in [
        "b2096-c128",
        "b4096-c128",
        "b8192-c128",
        "b2096-c128-recheck",
        "scorecap-128",
        "scorecap-256",
    ]:
        reports.extend(
            ROOT / "tuning" / name / file for file in ["latency.json", "load.json"]
        )
    reports.extend(
        ROOT / "tuning" / name
        for name in [
            "cache-strategies.json",
            "score-caps.json",
            "final-regression.json",
        ]
    )
    total = 0
    for path in reports:
        data = json.loads(path.read_text())
        rows = data["rows"]
        total += len(rows)
        assert all(
            r["error"] is None and r["exact_match"] and r["schema_valid"] for r in rows
        ), path
        assert all(
            math.isfinite(r["latency_ms"]) and r["latency_ms"] > 0 for r in rows
        ), path
        for summary in data.get("summary", data.get("groups", [])):
            group = [
                r
                for r in rows
                if all(r[k] == summary[k] for k in ["case", "cache", "method"])
            ]
            assert len(group) == summary["n"], (path, summary)
            assert (
                round(statistics.median(r["latency_ms"] for r in group), 2)
                == summary["p50_ms"]
            ), (path, summary)
    assert total == 2882, total
    initial = json.loads(reports[0].read_text())
    assert len(initial["rows"]) == 260
    assert total - len(initial["rows"]) == 2622
    index = {(s["case"], s["cache"], s["method"]): s for s in initial["summary"]}
    speedup = (
        index["scale_28", "fresh_prefix", "json_schema"]["p50_ms"]
        / index["scale_28", "fresh_prefix", "auto"]["p50_ms"]
    )
    assert round(speedup, 1) == 10.3
    assert round(speedup, 2) == 10.29
    scores = json.loads((ROOT / "tuning/score-caps.json").read_text())
    assert len(scores["score_comparisons"]) == 16
    assert all(
        p["max_absolute_logprob_difference"] == 0 for p in scores["score_comparisons"]
    )
    print(
        f"Verified {total:,} measured rows, 2,622 tuning requests, 10.3× headline, and 16 identical-score probes."
    )


if __name__ == "__main__":
    main()
