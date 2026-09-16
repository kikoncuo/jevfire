"""Render a deterministic SVG directly from measured initial benchmark medians."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    report = json.loads((ROOT / "benchmarks/results/benchmark.json").read_text())
    index = {(s["case"], s["cache"], s["method"]): s for s in report["summary"]}
    cases = [
        ("facts_es", "04 fields", "Short context"),
        ("scale_12", "12 fields", "Short context"),
        ("scale_28", "28 fields", "Short context"),
        ("long_context_450", "12 fields", "Long context"),
    ]
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="610" viewBox="0 0 1200 610" role="img" aria-labelledby="title desc">',
        '<title id="title">JEVfire versus constrained JSON: fresh-prefix latency</title>',
        '<desc id="desc">Median milliseconds from five trials per cell. Lower is better. Same 27B FP8 model and GPU. Data from benchmarks/results/benchmark.json.</desc>',
        '<rect width="1200" height="610" rx="22" fill="#111416"/>',
        "<style>text{font-family:ui-sans-serif,system-ui,Arial,sans-serif;fill:#f5f1e7}.muted{fill:#a5aaa9}.small{font-size:16px}.value{font-size:18px;font-weight:600}</style>",
        '<text x="44" y="49" font-size="13" fill="#f4aa42" letter-spacing="3">MEASURED ON CUDA</text>',
        '<text x="44" y="88" font-size="30" font-weight="750">More decisions. Less waiting.</text>',
        '<text x="44" y="119" class="muted small">Fresh-prefix median latency · lower is better · five trials per cell</text>',
        '<rect x="763" y="65" width="14" height="14" rx="3" fill="#737d88"/>',
        '<text x="787" y="78" class="small">Constrained JSON</text>',
        '<rect x="998" y="65" width="14" height="14" rx="3" fill="#f4aa42"/>',
        '<text x="1022" y="78" class="small">JEVfire</text>',
    ]
    for i, (case, title, subtitle) in enumerate(cases):
        y = 170 + i * 93
        baseline = index[case, "fresh_prefix", "json_schema"]["p50_ms"]
        scoring = index[case, "fresh_prefix", "auto"]["p50_ms"]
        svg += [
            f'<text x="44" y="{y + 19}" font-size="21" font-weight="650">{title}</text>',
            f'<text x="44" y="{y + 43}" class="small muted">{subtitle}</text>',
        ]
        for value, color, offset in [
            (baseline, "#737d88", 0),
            (scoring, "#f4aa42", 32),
        ]:
            width = value / 5500 * 650
            svg += [
                f'<rect x="225" y="{y + offset}" width="{width:.2f}" height="22" rx="5" fill="{color}"/>',
                f'<text x="{235 + width:.2f}" y="{y + offset + 17}" class="value">{value:,.1f} ms</text>',
            ]
        svg += [
            f'<text x="1070" y="{y + 30}" text-anchor="middle" font-size="28" font-weight="750">{baseline / scoring:.2f}×</text>'
        ]
    svg += [
        '<path d="M44 557H1156" stroke="#303536"/>',
        '<text x="44" y="586" class="small muted">Qwen3.8-27B-FP8 · RTX PRO 6000 Blackwell · vLLM 0.29.0 · synthetic fixtures</text>',
        "</svg>",
    ]
    (ROOT / "assets/benchmark.svg").write_text("\n".join(svg) + "\n")


if __name__ == "__main__":
    main()
