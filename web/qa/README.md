# Browser QA and policy experiments

This directory keeps development evidence for the browser demo. It separates
structural/UI checks, scripted simulation balance, and real-model policy
experiments. A passing structural test does not mean a villager chose a useful
action. A legal action can still leave the village hungry or undefended.

The current game uses Qwen 3.5 0.8B with six distinct characters, dynamic job
availability, personal stamina thresholds, visible automatic hunger care, and food-funded builder healing.
Builders have four possible role actions; an individual request scores only the
currently useful subset. Healthy, fed, rested villagers cannot choose ineffective rest while useful work exists. Selected fatigue breaks continue until the character recovers to their rest target. Automatic meals and a rule-only choice when only one
action remains are not model inference and must not increase AI throughput.

**The policy and survival records below predate these mechanics.** Their old
hunger scenes required the model to select `relax` to eat; that expectation no
longer describes automatic hunger care. They remain historical development
evidence, not current policy validation. The experiments did not establish an
optimal policy or reliable model-driven survival improvement, and make no
browser inference speedup claim or comparison with the CUDA sidecar.

## What each artifact establishes

| Artifact                                                     | Scope and limits                                                                                                                                                                                                                        |
| :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [policy-fixtures.json](policy-fixtures.json)                 | Twelve hand-authored scenes and their expected allowed actions, with reasons. Used during prompt development.                                                                                                                           |
| [policy-heldout-fixtures.json](policy-heldout-fixtures.json) | Twelve additional hand-authored scenes. Originally set aside; subsequently inspected and used for model/prompt comparisons. The filename is historical: this is now another development/regression set, not untouched holdout evidence. |
| [make-policy-fixtures.js](make-policy-fixtures.js)           | Historical generator for the old policy scenes. Its expected hunger actions predate automatic needs. Do not use it to regenerate current-policy evidence; it also overwrites the balance artifact.                                      |
| [balance-results.json](balance-results.json)                 | Four seeded runs using an explicit scripted controller. Useful for checking that the simulation can sustain several minutes of play; not model performance.                                                                             |
| [policy-check.js](policy-check.js)                           | Compares the initial and more explicitly prioritized role instructions through real browser inference while the game is paused.                                                                                                         |
| [policy-current.js](policy-current.js)                       | Runs the currently loaded model/prompt configuration against both scene sets. Returns aggregate results and failures; its in-page report also contains full rows.                                                                       |
| [policy-fewshot.js](policy-fewshot.js)                       | Compares the current role instructions with added hand-authored A/B/C examples. These are prompt examples, not action overrides.                                                                                                        |
| [probe-instructions.js](probe-instructions.js)               | Small explicit-instruction diagnostic. It is not a policy accuracy or survival evaluation.                                                                                                                                              |
| [browser-smoke.js](browser-smoke.js)                         | Full-game checks for real inference, fixed output contracts, scheduling, stale-result isolation, controls, and layout. Tactics are not graded. A script's presence is not a successful execution record.                                |
| [signal-run-smoke-result.json](signal-run-smoke-result.json) | Historical results for the earlier three-unit Signal Run demo. It does not validate the six-villager Last Hearth game.                                                                                                                  |
| [survival-baseline.json](survival-baseline.json)             | One early real-model game run. It is a development observation, not a controlled model comparison.                                                                                                                                      |

Current checks added for the revised mechanics:

- [needs-jobs-check.js](needs-jobs-check.js) runs controlled scripted fixtures
  inside the browser using isolated instances of the real `Game` module. It
  checks meal activity and attribution, resuming a requested job, personal stamina breaks, starvation without supplies,
  healing costs/caps, useful candidate subsets, rule attribution, and persistent
  personalities. It never substitutes a model response or changes the live stage.
- [scripted-balance.js](scripted-balance.js) regenerates only the current
  [balance-results.json](balance-results.json), preserving historical policy
  fixtures. The previous mechanical results are retained in
  [balance-results-v1.json](balance-results-v1.json).
- [browser-smoke.js](browser-smoke.js) now checks each returned candidate subset,
  including builders' `heal` action, instead of assuming three logits everywhere.
  It still requires real loaded WebLLM inference. Paused probes score all six characters without touching live counters. Live play requires real collector decisions and visible progression of rule-only training/building jobs; it no longer claims all six characters required an AI decision. The current [execution report](smoke-current.json) records a successful real-model
  run; [mechanical results](needs-jobs-result.json) record all seven browser fixtures.

## Historical exploratory scene results

A match means the chosen finite action appears in a scene author's `expected`
list. The choices were scored by the model; expected answers were used only for
evaluation. These custom examples are small, policy-dependent, and repeatedly
inspected. Counts below are descriptive, not population accuracy estimates.

| Experiment                                                          | First 12 scenes | Additional 12 scenes | Evidence                                              |
| :------------------------------------------------------------------ | --------------: | -------------------: | :---------------------------------------------------- |
| Qwen 3.5 0.8B, JSON observations, initial policy, A/B/C labels      |            7/12 |         Not recorded | [Initial comparison](policy-check-initial.json)       |
| Qwen 3.5 0.8B, JSON observations, prioritized policy, A/B/C labels  |            5/12 |         Not recorded | [Initial comparison](policy-check-initial.json)       |
| Qwen 3.5 0.8B, prose observations, initial policy, A/B/C labels     |            7/12 |         Not recorded | [Prose comparison](policy-prose.json)                 |
| Qwen 3.5 0.8B, prose observations, prioritized policy, A/B/C labels |            6/12 |         Not recorded | [Prose comparison](policy-prose.json)                 |
| Qwen 3.5 0.8B, A/B/C comparison without / with added examples       |     7/12 / 7/12 |         Not recorded | [Few-shot comparison](policy-fewshot.json)            |
| Qwen 3.5 0.8B, semantic action labels, previous assignment included |            5/12 |                 4/12 | [Semantic comparison](policy-semantic.json)           |
| Qwen 3.5 0.8B, semantic action labels, previous assignment omitted  |            5/12 |                 5/12 | [No-assignment comparison](policy-no-assignment.json) |
| Qwen 3.5 2B, semantic-label comparison                              |            7/12 |                 9/12 | [2B comparison](policy-2b.json)                       |

The tested few-shot addition did not improve its scene-match count. The 2B
semantic-label run matched more of the additional scenes, but still selected
`relax` in several scenes requiring food collection, training, or construction.
For example, its first-set failures include ordinary safe foraging, an empty
pantry, peacetime training, and building in a healthy village. A better aggregate
count did not establish that the model would keep working or survive longer.

Other exploratory outputs are retained in
[policy-2b-priority.json](policy-2b-priority.json),
[policy-2b-near-policy.json](policy-2b-near-policy.json), and
[instruction-probe.json](instruction-probe.json). They are diagnostic
records, not additional independent validation datasets. Rerunning their
scripts against today's source may use a different prompt or label mapping.

Semantic labels identify actions with words such as `safe`, `bold`, `rest`,
`train`, `fight`, `fix`, and `build`, instead of A/B/C. They still map into the
same finite action contract. Neither representation guarantees sound choices.
Raw candidate logits and their within-choice softmax scores are not calibrated
probabilities that an action is correct.

## Provenance and reproducibility limits

Some exploratory JSON files contain only aggregate totals and failed rows.
They omit passing rows, exact full prompts, model/weight/library revisions,
hardware information, and/or timestamps. The table's variant descriptions
reflect the development run context; the files are not self-contained
reproduction manifests. Do not infer missing metadata from whichever model or
source code happens to be checked out now.

In particular, some diagnostic scripts contain a hard-coded 0.8B model label
even though they were also used while evaluating a 2B model. Their label alone
does not identify the loaded weights. The additional set's old “heldout” name
and comments do not restore its independence after comparison results have
informed development.

For a final reproducible report, record the actual loaded model and revisions,
runtime, browser/GPU, game revision, exact prompts and label mapping, both
fixture revisions, every result row, timing definition, and test date. A new
untouched evaluation set and repeated seeded game runs would be needed before
making a generalization or survival-improvement claim.

## Scripted balance and the early model run

The CPU game test in [game.test.js](../test/game.test.js) requires the explicit
scripted reference controller to survive **more than three simulated minutes**
and less than eight across four fixed seeds. The recorded balance runs use
seeds 1, 2, 3, and 7341, a one-second simulation step, and one full living-roster
decision per simulated second. With the current rules, their recorded durations
are **294.9, 330.6, 322.6, and 323.1 simulated seconds**. They reached waves 9–11,
completed 22–31 healing treatments, and consumed 36–39 real meals. No model
inference or wall-clock latency measurement is involved. The earlier values
283.1, 301.2, 286.1, and 286.1 are preserved in `balance-results-v1.json`; changes
to game mechanics prevent interpreting this difference as a model improvement.
The automatic-needs/healing revision before stamina is separately preserved in
[balance-results-v2.json](balance-results-v2.json).

The early [real-model baseline](survival-baseline.json), using Qwen 3.5 0.8B,
initial JSON observations, and the initial role policy, lasted **190.9856
simulated seconds**, with **385 decisions**, seed **7341**, and simulation speed
**2×**. This is one development run. Its decision schedule, asynchronous model
latency, and execution conditions differ from the scripted balance harness.
These records do not establish a causal model/policy improvement, and their
simulated durations must not be presented as inference latency or throughput.

## Re-run checks

From `web/`, run the CPU tests:

```bash
npm test
```

To regenerate current scripted balance without overwriting historical scenes:

```bash
node qa/scripted-balance.js
```

Do not regenerate the old policy fixtures with `make-policy-fixtures.js` and
interpret the old expected actions as current-policy correctness: urgent eating
is now an explicit game rule, and builders have a fourth action.

For browser checks, start the dev server, open it in the isolated browser
session, explicitly load the real model, and pause gameplay before a policy
probe. Check the loaded model and prompt configuration before interpreting
any result. Only one test should use the inference worker at a time.

```bash
npm run dev
# In another terminal, from web/:
playwright-cli -s=cowork open http://127.0.0.1:5173 --persistent --headed
# Current mechanics: no model download required; dev server only.
playwright-cli -s=cowork run-code --filename=qa/needs-jobs-check.js
# Then explicitly load the real model in the UI for structural/UI checks:
playwright-cli -s=cowork run-code --filename=qa/browser-smoke.js
# Historical policy probes require revised scenes before current-rule evaluation.
```

The policy probe stores its full report in `window.jevfirePolicyCurrent`;
the smoke script stores a successful report in `window.jevfireSmokeReport`.
The controlled mechanics script stores its report in
`window.jevfireNeedsJobsReport`. Its isolated scenarios use scripted commands and
report zero model requests. It imports the source module from the Vite dev
server; it is not designed for a production build that omits source modules.
Save those reports with the actual configuration metadata. The smoke script
temporarily disables browser networking after assets/model load to check local
inference and restores networking in `finally`. It also resets and exercises
the game; use a disposable development session.

## Historical release configuration and results

The previous release used Qwen3.5-0.8B-q4f16_1-MLC, the original natural-language role policies, factual prose observations, and A/B/C labels. These records predate automatic needs, character policies, healing, dynamic action subsets, and the current inference pacing. The [complete policy report](policy-result.json) includes every scenario result, policies, raw scores, GPU/browser details, pinned model/library revisions, and SHA-256 hashes of the prompt, simulator, scorer, and fixture sources.

It matched **7/12** development scenes and **4/12** additional scenes. This is weak policy performance: missed meals, training, and construction remain real limitations. The extra set was reused during development; neither count estimates general accuracy. The larger 2B download and tested prompt rewrites did not establish a reliable gameplay advantage, so the smaller download remains the default. No policy-optimality claim is made.

The previous release's production [smoke report](smoke-result.json) passed real offline inference for all six NPCs, finite role contracts, injection resistance for unknown fields, stale-result rejection, pause/scripted throughput isolation, and mobile layout. Its first completed roster round measured **1.87 accepted AI decisions/sec** and **0.31 rounds/sec**; its obsolete FPS estimator displayed 102 FPS on the reported Apple WebGPU adapter. This is a short 3.22-second warmup sample, not a sustained benchmark or a device-independent promise. The old FPS value is not comparable to the corrected wall-clock draw counter.

[The survival recorder](survival-run.js) starts one real-model game at seed 7341 and 2× simulation speed and stores read-only samples in `window.jevfireSurvivalReport`. Keep the tab visible and inspect its `final` property when the game ends. Simulation seconds and wall-clock throughput are separate measurements.

The [historical release run](survival-result.json) ended when the hall fell at **192.6 simulated seconds**, with **373 accepted model decisions**, six kills, and one villager still alive. It averaged **1.83 accepted decisions per wall-clock second** over **204.0 wall seconds**. Browser frame-time clamping can make the selected 2× speed diverge from twice wall time under load. This one run is similar in duration to the early baseline and does not demonstrate a survival improvement.

## Frame pacing experiment (September 16, 2026)

The old FPS readout averaged reciprocal frame times and hid long GPU stalls.
The new readout divides actual draws by elapsed wall time and reports animation
frame p99 separately. Renderer draws are capped near 60 FPS.

Same Apple metal-3 adapter, Chrome 152, 1440 × 1000 viewport, 12 seconds per phase:

| Configuration       | Animation callbacks/sec |    Draws/sec | Frame p99 | Max gap | Accepted AI decisions/sec |
| :------------------ | ----------------------: | -----------: | --------: | ------: | ------------------------: |
| Previous release    |                    48.7 | Not recorded |    400 ms |  492 ms |                      1.83 |
| Balanced, first run |                   106.8 |         50.5 |    9.4 ms |  525 ms |                      0.67 |
| Balanced, warmed    |                   119.9 |         57.8 |    9.3 ms |  9.4 ms |                      0.83 |
| Maximum             |                    93.2 |         45.1 |     91 ms |  125 ms |                      1.50 |

The first balanced run still had startup stalls; the warmed run had none above
50 ms. No long main-thread tasks were recorded. This points to GPU contention
or initialization, rather than a main-thread JavaScript freeze. Balanced trades
inference throughput for responsiveness. These short development measurements
precede the final stamina and compact-label adjustments; they are scheduling
evidence, not a controlled survival or accuracy comparison.

Raw records: [before](frame-before.json), [first balanced](frame-balanced-cold.json),
[warm balanced](frame-balanced-warm.json), [maximum](frame-fast.json). Re-run
[frame-profile.js](frame-profile.js) with the real model loaded. Animation callback
rate may exceed draw rate on a high-refresh display.

[Prefill checks](prefill-check-result.json) compare four actual prompts using
ordinary versus chunked WebLLM prefill. All four kept the same winning candidate;
maximum raw-score differences ranged from 0.052 to 0.142. This is agreement for
four examples, not a promise of identical scores or winners for every prompt.
[Reproduction script](prefill-check.js).

[Priority probes](priority-probe-result.json) recorded excessive resting under
both existing and shorter priority instructions. Stamina/availability rules
address that behavior explicitly; they do not demonstrate improved model
reasoning. Meals, forced sole jobs, and simulation updates never count as AI ticks.

## Current release checks

[Source hashes and pins](current-validation.json) identify the tested code.
All **41 CPU tests** passed, along with formatting and a production build.
The [real-model smoke run](smoke-current.json) passed six paused offline role
probes, live dynamic candidate scoring, rule-job progression, fixed-field
injection resistance, stale-result rejection, pause/scripted throughput isolation,
and mobile overflow checks. Its short first eligible round displayed 58 rendered
FPS; this is a smoke observation, not a sustained benchmark.

The [browser mechanics run](needs-jobs-result.json) passed seven isolated,
explicitly scripted cases using the real simulation module. These cover actual
food consumption, resuming work, starvation without supplies, healing costs and
caps, legal jobs, personalities, stamina breaks, and zero added AI ticks.

The [current real-model run](survival-current.json) ended when the hall fell at
**268.3 simulated seconds** (seed 7341, 2× simulation speed, balanced inference).
It recorded **24 meals, 17 healing treatments, 17 kills, and 86 accepted model
decisions** over **135.0 wall seconds**. The final five-second window drew 58
FPS with a 9.3 ms animation-frame p99. These are observed outcomes from one run;
changed rules and frame cadence prevent treating its duration as an improvement
in model reasoning over the historical release.
