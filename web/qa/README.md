# Browser QA and policy experiments

This directory keeps development evidence for the browser demo. It separates
structural/UI checks, scripted simulation balance, and real-model policy
experiments. A passing structural test does not mean a villager chose a useful
action. A legal action can still leave the village hungry or undefended.

The shipped controller uses the lightweight Qwen 3.5 0.8B build. The prompt
experiments below did not establish an optimal policy or a reliable survival
improvement.
They make no browser inference speedup claim and do not reproduce the CUDA
sidecar benchmarks.

## What each artifact establishes

| Artifact                                                     | Scope and limits                                                                                                                                                                                                                        |
| :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [policy-fixtures.json](policy-fixtures.json)                 | Twelve hand-authored scenes and their expected allowed actions, with reasons. Used during prompt development.                                                                                                                           |
| [policy-heldout-fixtures.json](policy-heldout-fixtures.json) | Twelve additional hand-authored scenes. Originally set aside; subsequently inspected and used for model/prompt comparisons. The filename is historical: this is now another development/regression set, not untouched holdout evidence. |
| [make-policy-fixtures.js](make-policy-fixtures.js)           | Generates the first scene set and CPU scripted balance runs from the current game code. Running it rewrites those artifacts; it does not invoke an LLM.                                                                                 |
| [balance-results.json](balance-results.json)                 | Four seeded runs using an explicit scripted controller. Useful for checking that the simulation can sustain several minutes of play; not model performance.                                                                             |
| [policy-check.js](policy-check.js)                           | Compares the initial and more explicitly prioritized role instructions through real browser inference while the game is paused.                                                                                                         |
| [policy-current.js](policy-current.js)                       | Runs the currently loaded model/prompt configuration against both scene sets. Returns aggregate results and failures; its in-page report also contains full rows.                                                                       |
| [policy-fewshot.js](policy-fewshot.js)                       | Compares the current role instructions with added hand-authored A/B/C examples. These are prompt examples, not action overrides.                                                                                                        |
| [probe-instructions.js](probe-instructions.js)               | Small explicit-instruction diagnostic. It is not a policy accuracy or survival evaluation.                                                                                                                                              |
| [browser-smoke.js](browser-smoke.js)                         | Full-game checks for real inference, fixed output contracts, scheduling, stale-result isolation, controls, and layout. Tactics are not graded. A script's presence is not a successful execution record.                                |
| [signal-run-smoke-result.json](signal-run-smoke-result.json) | Historical results for the earlier three-unit Signal Run demo. It does not validate the six-villager Last Hearth game.                                                                                                                  |
| [survival-baseline.json](survival-baseline.json)             | One early real-model game run. It is a development observation, not a controlled model comparison.                                                                                                                                      |

## Recorded exploratory scene results

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
decision per simulated second. Their recorded durations are 283.1, 301.2,
286.1, and 286.1 simulated seconds. No model inference or wall-clock latency
measurement is involved.

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

To regenerate the scripted fixtures and balance artifact explicitly:

```bash
node qa/make-policy-fixtures.js
```

For browser checks, start the dev server, open it in the isolated browser
session, explicitly load the real model, and pause gameplay before a policy
probe. Check the loaded model and prompt configuration before interpreting
any result. Only one test should use the inference worker at a time.

```bash
npm run dev
# In another terminal, from web/:
playwright-cli -s=cowork open http://127.0.0.1:5173 --persistent --headed
# Load the real model in the UI, then pause before running a policy probe.
playwright-cli -s=cowork run-code --filename=qa/policy-current.js
# Full-game structural/UI checks are a separate run:
playwright-cli -s=cowork run-code --filename=qa/browser-smoke.js
```

The policy probe stores its full report in `window.jevfirePolicyCurrent`;
the smoke script stores a successful report in `window.jevfireSmokeReport`.
Save those reports with the actual configuration metadata. The smoke script
temporarily disables browser networking after assets/model load to check local
inference and restores networking in `finally`. It also resets and exercises
the game; use a disposable development session.

## Final configuration and results

The shipped configuration uses Qwen3.5-0.8B-q4f16_1-MLC, the original natural-language role policies, factual prose observations, and A/B/C labels. The [complete policy report](policy-result.json) includes every scenario result, policies, raw scores, GPU/browser details, pinned model/library revisions, and SHA-256 hashes of the prompt, simulator, scorer, and fixture sources.

It matched **7/12** development scenes and **4/12** additional scenes. This is weak policy performance: missed meals, training, and construction remain real limitations. The extra set was reused during development; neither count estimates general accuracy. The larger 2B download and tested prompt rewrites did not establish a reliable gameplay advantage, so the smaller download remains the default. No policy-optimality claim is made.

The final production [smoke report](smoke-result.json) passed real offline inference for all six NPCs, finite role contracts, injection resistance for unknown fields, stale-result rejection, pause/scripted throughput isolation, and mobile layout. Its first completed roster round measured **1.87 accepted AI decisions/sec**, **0.31 rounds/sec**, and **102 render FPS** on the reported Apple WebGPU adapter. This is a short 3.22-second warmup sample, not a sustained benchmark or a device-independent promise.

[The survival recorder](survival-run.js) starts one real-model game at seed 7341 and 2× simulation speed and stores read-only samples in `window.jevfireSurvivalReport`. Keep the tab visible and inspect its `final` property when the game ends. Simulation seconds and wall-clock throughput are separate measurements.

The [recorded release run](survival-result.json) ended when the hall fell at **192.6 simulated seconds**, with **373 accepted model decisions**, six kills, and one villager still alive. It averaged **1.83 accepted decisions per wall-clock second** over **204.0 wall seconds**. Browser frame-time clamping can make the selected 2× speed diverge from twice wall time under load. This one run is similar in duration to the early baseline and does not demonstrate a survival improvement.
