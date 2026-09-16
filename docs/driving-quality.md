# Does faster scoring change the drivers?

The final optimized scorer matched the published implementation's choices in
**24/24 comparisons across 12 scenes, each repeated twice**. It approximately
halved scoring time in the paired SDK test. That is evidence about this small
regression set, not evidence of good driving: **only 2/12 distinct scenes met
the independently written policy rubric**, and none of the six initially held-out
scenes passed. In two complete races, the optimized version applied **56% more
decisions per second but had worse outcomes**: seven finishes across eight
starts versus eight, more contacts and spins, and slower winners. Frozen-choice
agreement does not establish absence of a driving regression.

## What we compared

All runs used **Qwen3.5-0.8B-q4f16_1-MLC**, model revision
`0ec138972555613c1d7812a821778ad0398c8790`, through **WebLLM 0.2.85**, in the same
local Chrome 152 WebGPU environment on macOS. The browser also rendered the
race; these are local measurements on a shared GPU.

| Path                   | Prompt and execution                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published release      | Exact [`f2ce886`](https://github.com/kikoncuo/jevfire/commit/f2ce8867a1b329d19b3cc228af152c9fafdc2028) build; balanced 32-token submissions, independent prefill and the original worker. |
| Current SDK, uncached  | Published prompt preserved; cache disabled, 32-token submissions with 16 ms inter-chunk yields.                                                                                           |
| Current SDK, optimized | Same prompt bytes and options; exact prefix reuse, 128-token submissions with no artificial yield.                                                                                        |

Both current SDK modes skip intermediate sampling/readback. Their paired
comparison changes **cache plus submission size and yielding**; it does not
isolate the speedup caused by caching alone. The published worker additionally
uses its older execution path. Cross-version timings were collected in separate
sessions, not randomized across implementations.

The [fixture harness](../web/qa/driving-quality.js) contains twelve bounded
observations and the four frozen default driver policies. Six scene shapes
were adapted from earlier development probes; six were newly held out from
that prompt development. The candidate results then informed the prompt restoration,
so the final rerun is a regression retest, not untouched held-out validation.
Cases cover clear-road speed rules, blocked overtakes,
wet-corner braking, pit thresholds, scarce boost, fast rear traffic and the
final-lap strategy. Each case specifies acceptable actions and a written reason
before inference. The rubric is independent of the scripted driving controller.

Every paired request used the same context, policy, offered actions and final
prompt. Four reported warmups preceded 48 scored calls: twelve scenes, two
repetitions, two modes. Driver order was interleaved, scene order reversed in
the second round, and each scene received each mode first once. Warmups are
excluded from quality and timing totals. Changing the available-label header
can invalidate a driver's cache, even when its policy is unchanged.

The [legacy harness](../web/qa/driving-legacy-quality.js) replayed the exact same
fixture objects twice on the published build. It checked the pinned model,
32-token execution and the original labels-before-policy prompt layout. All
24 final optimized prompts matched the corresponding published prompt bytes.
Probes ran while paused, never applied controls, and verified that race state
and accepted-decision counts were unchanged.

## Fixed-scene results

| Measurement                          | Published release | Current SDK, uncached | Current SDK, optimized |
| ------------------------------------ | ----------------: | --------------------: | ---------------------: |
| Rubric matches, 24 calls             |              4/24 |                  4/24 |                   4/24 |
| Distinct scenes passing both repeats |              2/12 |                  2/12 |                   2/12 |
| Initially held-out scenes passing    |               0/6 |                   0/6 |                    0/6 |
| Median scorer time                   |          1,280 ms |              1,233 ms |                 620 ms |
| Median browser round-trip time       |          1,286 ms |              1,270 ms |                 643 ms |
| Agreement with published choices     |         Reference |                 23/24 |                  24/24 |

The median paired uncached/optimized scorer ratio was **2.00×**. The optimized
path recorded **14/24 cache hits**, avoided **1,312 of 14,096 input-token
evaluations (9.31%)**, and used **108 forward calls versus 456**. These counts
explain why the complete speedup should not be attributed to token reuse alone.

The two SDK modes agreed in **23/24 paired calls**. In the wet-boundary Milo
scene, the uncached scorer selected `hold` on its first repeat and `accelerate`
on its second; the optimized scorer selected `hold` both times. Those two
options were nearly tied, and both missed the expected `brake`. Maximum paired
logit difference was 0.1783; the largest candidate-score difference was 0.0217.
This is not bit-identical inference, and nearly tied options can change rank.

The successful cases were Nova accelerating on a clear straight and Atlas
requesting service with severe damage and worn tyres. Failures included Atlas
accelerating while already too fast in a wet bend, Juno requesting a pit stop
while healthy and inside the requested cruising band, and Milo accelerating
above his early-lap speed target. Valid typed output does not imply policy
adherence. Restricted softmax values are relative option scores, not calibrated
probabilities of a safe or correct action.

## A rejected prompt change

An earlier candidate moved the available-label header after the driver policy
to preserve more cache hits. Its cached and uncached modes agreed in 24/24
paired calls, yet it agreed with the published release in only **22/24**.
Both changed calls were repeats of the same Milo wet-boundary scene:
`hold` became `accelerate`, where the rubric required `brake`.

Both actions failed the binary rubric, so aggregate accuracy stayed at 16.7%.
That unchanged score concealed a consequential change: acceleration into an
already over-speed wet corner was a worse response to the stated hazard.
The prompt reorder was removed, the published text restored byte for byte,
and the final fixed-scene experiment rerun. Candidate results are retained
rather than replacing them with the more favorable final comparison.

The candidate also waited for a complete fleet response before applying its
answers. The final scheduler applies each car's answer as soon as it arrives.
Its later cars still wait for earlier GPU work because execution is serial.

## Complete races and decision age

The race harness runs the actual application with default policies, following
assist enabled, simulation speed 1× and seeds **7 and 19**, once per version.
It polls diagnostics every 250 ms, checks coverage against the authoritative
accepted count, and records finish times, contacts, spins, service stops,
observations and frame telemetry. Published runs use balanced pace; candidate
and final runs use the optimized pace. The seed fixes the starting arrangement
and weather, but wall-time inference changes future observations and trajectories.
These are two paired race conditions, not a win-rate study or proof of equivalent
driving quality. Following assist and pit control remain explicit game rules.

The [saved aggregate](../web/qa/driving-quality-comparison.json) reports:

| Across seeds 7 and 19                     | Published release | Rejected candidate | Final optimized |
| ----------------------------------------- | ----------------: | -----------------: | --------------: |
| Accepted decisions / wall seconds         |      110 / 173.99 |       220 / 201.17 |    197 / 199.59 |
| Accepted decisions/sec                    |             0.632 |              1.094 |           0.987 |
| Finishes across eight starts              |               8/8 |                8/8 |             7/8 |
| Contacts                                  |                 0 |                  3 |               2 |
| Spins                                     |                 4 |                  5 |               6 |
| Pit stops                                 |                 2 |                 10 |              12 |
| Mean winner time, simulation seconds      |             74.68 |              80.31 |           85.38 |
| Mean observation age, simulation seconds  |              1.27 |               1.16 |            1.02 |
| Worst observation age, simulation seconds |              1.48 |               2.97 |            3.00 |

The final version increased accepted decision throughput by **56.1%**, but its
mean winner took **14.3% longer**, one car did not finish, and more contacts,
spins and pit stops occurred. Mean observation age improved while its worst
case approximately doubled. These runs do not isolate which scheduling or
numerical change caused each outcome, and two seeds cannot establish a general
effect. They do provide adverse evidence that must accompany the speed results.

All 110 published and 197 final accepted decisions were captured, with no
polling gaps, driver/policy mismatches or actions outside their offered options.
The failure was therefore not an invented JSON field; legal actions and changed
decision timing can still produce worse driving.

The **nine captured final rounds containing four cars** had a mean complete
inference time of **2,780 ms**, or approximately **695 ms/car amortized**.
A smaller average across all fleet rounds would hide that most rounds had
fewer eligible cars. The four-car result does not meet one fresh decision per
car per second.

A **fleet round** contains currently eligible cars, not necessarily all four.
Pit phases, spins, finishing and retirement can remove cars from decision
eligibility; changed race behavior also changes the eligible population.
Reporting every round as four decisions would inflate throughput.

**Scorer latency** measures inference for one frozen request. **Amortized ms/car**
divides total fleet inference work by scored choices; it is not an individual
car's response time. **Observation age** measures simulated time from the saved
snapshot to application of its answer, including earlier cars' work. **Accepted
decisions/sec** divides choices actually applied by elapsed wall time. More
choices per second can improve responsiveness while also applying a bad policy
more often; race outcomes and decision age must be examined separately.

Prefix reuse is an inference optimization. A fleet request is an application
scheduling unit. This WebLLM engine evaluates driver prompts sequentially and
does **not** perform parallel GPU inference across the four cars. CUDA/server
parallel-field measurements are separate experiments.

## Reproduce and inspect

Load Qwen in `/driving.html`, pause and drain inference, then run
[`driving-quality.js`](../web/qa/driving-quality.js) through a Playwright
`run-code` callback. The complete or partial report remains at
`window.slipstreamQualityReport`. Serve the exact published release separately
and run [`driving-legacy-quality.js`](../web/qa/driving-legacy-quality.js);
its report is `window.slipstreamLegacyQualityReport`.
[`driving-race-quality.js`](../web/qa/driving-race-quality.js) runs live races
through the normal UI. See the [QA instructions](../web/qa/README.md).

Raw records retain fixture rubrics, prompts, candidate logits, probabilities,
cache counters and timings:

- [Final fixed-scene results](../web/qa/driving-quality-result.json)
- [Published-release fixed-scene results](../web/qa/driving-legacy-quality-result.json)
- [Rejected candidate fixed-scene results](../web/qa/driving-quality-candidate.json)
- Published races: [seed 7](../web/qa/driving-race-legacy-7.json.gz), [seed 19](../web/qa/driving-race-legacy-19.json.gz)
- Candidate races: [seed 7](../web/qa/driving-race-candidate-7.json.gz), [seed 19](../web/qa/driving-race-candidate-19.json.gz)
- Final races: [seed 7](../web/qa/driving-race-optimized-7.json.gz), [seed 19](../web/qa/driving-race-optimized-19.json.gz)

The [aggregation script](../web/qa/summarize-driving-quality.py) derives the
comparison from saved records and fails if a required run is missing. Repeated
scenes and overlapping rolling FPS snapshots are not independent samples;
none of these results establish general absence of quality loss.
