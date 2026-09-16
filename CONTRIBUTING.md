# Contributing

Install with `python -m pip install -e '.[dev]'`, then run:

```bash
ruff format .
ruff check .
pytest -q
python scripts/verify_benchmarks.py
```

GPU tests are opt-in: set `DECISION_TEST_URL=http://127.0.0.1:8010` before
running `pytest tests/test_parallel_decoding_live.py`. They are written for the
tested Qwen deployment; exact semantic outputs are not guaranteed on every model.

For performance changes, include raw measurements, hardware/model/engine versions,
the cache regime, correctness results, and a compact constrained-JSON baseline.
Randomize method order, preserve the current prompts, and record any prompt change.
Do not treat repeated fixture runs as a general accuracy evaluation.

New models need verified label tokenization, the correct chat template, complete
candidate scores, option-order sensitivity checks, and representative task data.
Please keep server credentials, logs with real user contexts, and model weights
out of issues and commits.
