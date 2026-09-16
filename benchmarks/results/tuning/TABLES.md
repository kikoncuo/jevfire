# Engine tuning measurements

Same model/precision/memory fraction and fixtures. Serial p50/p95: five repetitions per cell. Closed-loop throughput: 16 requests per cell at concurrency four, including fill/drain; not sustained saturation. GPU telemetry at 500 ms is for the whole shared GPU. Energy/request is an approximate sampled power/throughput proxy, not isolated model energy or financial cost. Runs are sequential, so temporal variation can confound small differences.

| Configuration | Requests | Exact matches | Errors | GPU peak MiB |
|---|---:|---:|---:|---:|
| b2096-c128 | 516 | 516 | 0 | 85019 |
| b2096-c128-recheck | 516 | 516 | 0 | 85019 |
| b4096-c128 | 516 | 516 | 0 | 83143 |
| b8192-c128 | 516 | 516 | 0 | 84633 |

## Serial latency: fresh_prefix

| Configuration | Case | JSON p50 ms | Scoring p50 ms | Speedup |
|---|---|---:|---:|---:|
| b2096-c128 | facts_es | 877.3 | 110.5 | 7.94× |
| b2096-c128 | scale_12 | 2237.3 | 334.9 | 6.68× |
| b2096-c128 | scale_28 | 5110.8 | 502.1 | 10.18× |
| b2096-c128 | long_context_450 | 2914.6 | 972.1 | 3.00× |
| b2096-c128 | cardinality_255 | 608.4 | 470.5 | 1.29× |
| b2096-c128-recheck | facts_es | 847.1 | 109.5 | 7.73× |
| b2096-c128-recheck | scale_12 | 2246.2 | 396.3 | 5.67× |
| b2096-c128-recheck | scale_28 | 5132.2 | 507.1 | 10.12× |
| b2096-c128-recheck | long_context_450 | 2958.5 | 1044.6 | 2.83× |
| b2096-c128-recheck | cardinality_255 | 614.0 | 479.0 | 1.28× |
| b4096-c128 | facts_es | 850.0 | 107.6 | 7.90× |
| b4096-c128 | scale_12 | 2210.1 | 327.2 | 6.75× |
| b4096-c128 | scale_28 | 5108.4 | 466.7 | 10.95× |
| b4096-c128 | long_context_450 | 2925.1 | 1016.3 | 2.88× |
| b4096-c128 | cardinality_255 | 490.3 | 467.5 | 1.05× |
| b8192-c128 | facts_es | 848.0 | 107.4 | 7.89× |
| b8192-c128 | scale_12 | 2208.8 | 312.4 | 7.07× |
| b8192-c128 | scale_28 | 5100.1 | 471.3 | 10.82× |
| b8192-c128 | long_context_450 | 2913.9 | 1019.1 | 2.86× |
| b8192-c128 | cardinality_255 | 612.8 | 477.9 | 1.28× |

## Concurrency four: fresh_prefix

| Configuration | Case | JSON req/s | Scoring req/s | Throughput ratio |
|---|---|---:|---:|---:|
| b2096-c128 | facts_es | 3.94 | 11.36 | 2.88× |
| b2096-c128 | scale_28 | 0.68 | 2.98 | 4.35× |
| b2096-c128 | long_context_450 | 0.76 | 1.19 | 1.58× |
| b2096-c128 | cardinality_255 | 2.93 | 2.25 | 0.77× |
| b2096-c128-recheck | facts_es | 3.80 | 11.92 | 3.14× |
| b2096-c128-recheck | scale_28 | 0.68 | 2.97 | 4.37× |
| b2096-c128-recheck | long_context_450 | 0.76 | 1.21 | 1.60× |
| b2096-c128-recheck | cardinality_255 | 2.96 | 2.25 | 0.76× |
| b4096-c128 | facts_es | 3.76 | 11.58 | 3.08× |
| b4096-c128 | scale_28 | 0.68 | 2.87 | 4.22× |
| b4096-c128 | long_context_450 | 0.76 | 1.24 | 1.64× |
| b4096-c128 | cardinality_255 | 3.05 | 2.34 | 0.77× |
| b8192-c128 | facts_es | 3.79 | 11.99 | 3.16× |
| b8192-c128 | scale_28 | 0.68 | 2.74 | 4.02× |
| b8192-c128 | long_context_450 | 0.76 | 1.25 | 1.64× |
| b8192-c128 | cardinality_255 | 2.96 | 2.31 | 0.78× |

## Serial latency: warm_prefix

| Configuration | Case | JSON p50 ms | Scoring p50 ms | Speedup |
|---|---|---:|---:|---:|
| b2096-c128 | facts_es | 878.1 | 106.9 | 8.21× |
| b2096-c128 | scale_12 | 2233.3 | 407.0 | 5.49× |
| b2096-c128 | scale_28 | 5109.4 | 332.2 | 15.38× |
| b2096-c128 | long_context_450 | 2208.1 | 259.0 | 8.53× |
| b2096-c128 | cardinality_255 | 437.8 | 297.2 | 1.47× |
| b2096-c128-recheck | facts_es | 851.3 | 114.4 | 7.44× |
| b2096-c128-recheck | scale_12 | 2240.0 | 393.0 | 5.70× |
| b2096-c128-recheck | scale_28 | 5134.2 | 335.6 | 15.30× |
| b2096-c128-recheck | long_context_450 | 2226.5 | 327.6 | 6.80× |
| b2096-c128-recheck | cardinality_255 | 447.1 | 302.9 | 1.48× |
| b4096-c128 | facts_es | 848.3 | 108.6 | 7.81× |
| b4096-c128 | scale_12 | 2211.1 | 342.7 | 6.45× |
| b4096-c128 | scale_28 | 5112.7 | 312.8 | 16.35× |
| b4096-c128 | long_context_450 | 2223.7 | 309.5 | 7.18× |
| b4096-c128 | cardinality_255 | 322.3 | 292.3 | 1.10× |
| b8192-c128 | facts_es | 845.5 | 108.5 | 7.79× |
| b8192-c128 | scale_12 | 2207.9 | 344.1 | 6.42× |
| b8192-c128 | scale_28 | 5103.9 | 312.5 | 16.33× |
| b8192-c128 | long_context_450 | 2225.1 | 316.1 | 7.04× |
| b8192-c128 | cardinality_255 | 449.7 | 304.9 | 1.47× |

## Concurrency four: warm_prefix

| Configuration | Case | JSON req/s | Scoring req/s | Throughput ratio |
|---|---|---:|---:|---:|
| b2096-c128 | facts_es | 3.94 | 11.01 | 2.79× |
| b2096-c128 | scale_28 | 0.68 | 4.94 | 7.21× |
| b2096-c128 | long_context_450 | 1.59 | 4.91 | 3.10× |
| b2096-c128 | cardinality_255 | 6.00 | 3.77 | 0.63× |
| b2096-c128-recheck | facts_es | 3.80 | 11.30 | 2.98× |
| b2096-c128-recheck | scale_28 | 0.68 | 4.63 | 6.83× |
| b2096-c128-recheck | long_context_450 | 1.61 | 5.69 | 3.54× |
| b2096-c128-recheck | cardinality_255 | 5.97 | 3.74 | 0.63× |
| b4096-c128 | facts_es | 3.77 | 9.59 | 2.54× |
| b4096-c128 | scale_28 | 0.68 | 4.14 | 6.08× |
| b4096-c128 | long_context_450 | 1.61 | 5.88 | 3.66× |
| b4096-c128 | cardinality_255 | 6.07 | 3.84 | 0.63× |
| b8192-c128 | facts_es | 3.80 | 9.78 | 2.57× |
| b8192-c128 | scale_28 | 0.68 | 4.21 | 6.18× |
| b8192-c128 | long_context_450 | 1.61 | 5.74 | 3.57× |
| b8192-c128 | cardinality_255 | 5.99 | 3.82 | 0.64× |
