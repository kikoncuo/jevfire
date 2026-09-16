"""Record host telemetry while running latency and concurrent batch benchmarks."""

import argparse
import json
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx


def main(args):
    with httpx.Client(timeout=5, trust_env=False) as client:
        for attempt in range(30):
            try:
                client.get(args.endpoint + "/health").raise_for_status()
                break
            except httpx.HTTPError:
                if attempt == 29:
                    raise
                time.sleep(2)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    gpu = subprocess.Popen(
        [
            "nvidia-smi",
            "--query-gpu=utilization.gpu,memory.used,power.draw",
            "--format=csv,noheader,nounits",
            "-lms",
            "500",
        ],
        stdout=subprocess.PIPE,
        text=True,
    )

    def record():
        with (output / "gpu.jsonl").open("w") as stream:
            for line in gpu.stdout:
                values = line.strip().split(", ")
                stream.write(
                    json.dumps({"at": datetime.now(UTC).isoformat(), "gpu": values})
                    + "\n"
                )
                stream.flush()

    thread = threading.Thread(target=record, daemon=True)
    thread.start()
    common = [
        "--endpoint",
        args.endpoint,
        "--vllm-url",
        args.vllm_url,
        "--model",
        args.model,
    ]
    if args.cases:
        common.extend(["--cases", args.cases])
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "jevfire.benchmark",
                "--repeats",
                str(args.repeats),
                "--output",
                str(output / "latency.json"),
                *common,
            ],
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "jevfire.load_benchmark",
                "--requests",
                str(args.requests),
                "--output",
                str(output / "load.json"),
                *common,
            ],
            check=True,
        )
    finally:
        gpu.terminate()
        gpu.wait(timeout=10)
        thread.join(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8010")
    parser.add_argument("--vllm-url", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--requests", type=int, default=16)
    parser.add_argument("--cases")
    main(parser.parse_args())
