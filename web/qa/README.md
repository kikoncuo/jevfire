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

## Stamina and frame-pacing release checks

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

## Character inspector checks

[inspector-check.js](inspector-check.js) exercises actual body/nameplate clicks,
camera drag rejection, work-earned XP, per-character scripted history, the mobile
details panel, and reset. It uses the ordinary game controls and does not inject
model responses or mutate simulation state.

[inspector-model-check.js](inspector-model-check.js) loads the real browser model
and checks the selected character's applied choice, candidate scores, timestamp,
and saved input observation. It also checks that a builder's sole available job
is identified as a game rule and does not display a neighbour's AI scores.

Run these sequentially against a fresh production preview with WebGPU enabled:

```bash
npm run build
npm run preview -- --port 5173
# In another terminal, from web/:
playwright-cli -s=cowork open http://127.0.0.1:5173 --persistent --headed
playwright-cli -s=cowork run-code --filename=qa/inspector-check.js
playwright-cli -s=cowork run-code --filename=qa/inspector-model-check.js
```

The execution records are [UI and progression](inspector-result.json) and
[real model](inspector-model-result.json), with [source hashes and model
pins](inspector-validation.json). These establish inspector behavior, not policy
quality or an inference speedup. Levels are work milestones and add no stat
multiplier; training still increases the separately displayed attack value.

## Slipstream driving demo

The driving demo has its own simulation, finite action contract and per-car
prompts. It shares the pinned WebLLM worker and Qwen 3.5 0.8B files with Last
Hearth. Village survival results do not measure driving policy quality.

The driving checks distinguish three kinds of evidence:

- `driving-game.test.js` and `driving-contract.test.js` cover real physics,
  finite resources, safe/risky lane availability, contact, grip, spins, damage,
  physical pit service, race outcomes, observations and typed assignments.
- [driving-balance.js](driving-balance.js) records three deterministic **scripted**
  races in [driving-balance.json](driving-balance.json). With seeds 7, 8 and 9,
  Atlas, Milo and Juno won respectively; each race had three finishers and one
  DNF. These used **zero model requests**. They show mechanics and balance,
  not prompt following or inference speed.
- [driving-policy-probe.js](driving-policy-probe.js) submits hand-authored scenes
  to the actual loaded WebLLM worker while paused. It never applies its output
  to the race or adds AI ticks. The scenes were repeatedly inspected and used
  to select a prompt format; they are development evidence, not an untouched
  accuracy benchmark.

The [initial comparison](driving-policy-initial.json) found that ordinary
letter labels matched none of six scene expectations, while rotated/semantic
labels and semantic examples matched one each. The model often preferred to
start an explanatory sentence with “Based” or “To”; restricting that distribution
to finite labels still yields a valid object, but can amplify irrelevant token
preferences. This is a concrete limitation of using a pretrained model as a
one-position classifier without task training.

[Answer-prefix and compact-prompt probes](driving-policy-suffix.json) improved
this small development set: compact observations with a fixed `Action:`
assistant prefix and letter labels matched four of six scenes. It distinguished
pushing, steady pace, passing blocked traffic and servicing damage, but still
missed both braking scenes. The other suffix variants matched only one or two.
Whitespace-prefixed labels are verified as single tokens before scoring.
A [final paired comparison](driving-policy-final.json) reproduced those four
matches. Adding explicit speed differences and repeating the policy matched
three of six and still missed braking, so production retains the compact
format. These counts neither establish reliable racing behavior nor general accuracy. Full per-case prompts, labels, logits and outputs are retained.

A separate [whole-versus-chunked comparison](driving-engine-comparison.json)
used an explicit brake instruction. Both methods selected the same wrong
acceleration action; the largest candidate-logit difference was about 0.54.
This single diagnostic rules out a chunk-specific winner change for that input,
not numerical differences or bugs for all possible prompts.

[driving-smoke.js](driving-smoke.js) exercises real body/tag selection, mobile
layout, scripted counter isolation, offline real-model scoring, per-driver
prompts and saved observations, edit isolation and stale-result rejection.
[driving-race.js](driving-race.js) records one complete real-model race using
normal UI controls, including accepted decisions, events, frame measurements
and standings. A script's presence alone is not proof it passed; release
execution records and source hashes are recorded separately.

To reproduce, start a production preview and open `/driving.html` in the isolated
browser. Tests may reset the race and restore driver prompts; use a disposable
session. The policy and race scripts require Qwen to be loaded first and the
race paused. Run one GPU check at a time:

```bash
npm test
node qa/driving-balance.js
npm run build
npm run preview -- --port 5173
# In another terminal, from web/:
playwright-cli -s=cowork open http://127.0.0.1:5173/driving.html --persistent --headed
playwright-cli -s=cowork run-code --filename=qa/driving-smoke.js
playwright-cli -s=cowork run-code --filename=qa/driving-policy-probe.js
playwright-cli -s=cowork run-code --filename=qa/driving-race.js
```

Browser reports are stored as `window.slipstreamSmokeReport`,
`window.slipstreamPolicyReport` and `window.slipstreamRaceReport`. AI rates use
accepted decisions per wall-clock second; simulated race time, script updates,
frame counts and forced pit routing do not create AI ticks. Seeded physics is
repeatable, but asynchronous model timings and browser cadence can change a
live race. The browser makes no claim to the server benchmark's CUDA speedup.

The first [complete real-model race](driving-race-result.json), using the longer
initial driver policies, finished in 92.24 wall seconds with 56 accepted model
decisions. Atlas won at 75.00 simulated seconds; all four finished. There were
four overtakes, one completed pit stop and no spins or contact. Median sampled
rendering was 54.2 FPS on the recorded Apple Metal adapter. This single run is
not a device-independent benchmark or a controlled strategy comparison.
Its actions exposed a practical failure: Nova repeatedly boosted/accelerated
behind traffic; Juno chose hold throughout. The output contract remained valid.

A [recorded-state overtaking probe](driving-overtake-probe.json) then compared
four shorter instructions on an actual blocked Nova observation. Three selected
`risky_left`, while one still selected acceleration. The current Nova default
uses the tested instruction to prioritize passing a car within 30 metres.
The other strategies were also shortened. This is prompt tuning on observed
failures, not independent validation or hard-coded driving behavior.

The [current real-model race](driving-race-current.json), with the shorter
policies, recorded **13 overtakes, two spins and 44 accepted AI decisions**.
Juno won in **70.56 simulated seconds**; Nova chose three risky passes, spun,
and finished third with **61.2% damage**. Milo also spun. All four finished;
this run had no contacts or completed pit service. It took **78.37 wall
seconds**, with a median of **54.0 sampled rendered FPS** on the same recorded
Apple WebGPU adapter. These are observed outcomes from one development run,
not a controlled causal comparison: asynchronous inference timing also differs.
The model still used early boost despite conservation instructions. Different
prompts influence scores but do not reliably enforce every intended strategy.

The release [smoke report](driving-smoke-result.json) passed all eight body/tag
selections, mobile bounds/overflow, offline real scoring for all drivers,
per-car observations and scores, prompt-edit isolation and in-flight reset
rejection. The [village regression](driving-village-regression.json) also passed
real Mira/Bram score attribution and Nell's rule-only inspector with the shared
worker. Normal navigation to Last Hearth and Back returned a working circuit
without reporting a terminated model worker as loaded.

[Release source hashes and pins](driving-validation.json) identify the checked
code and artifacts. All **85 CPU tests**, formatting and the production build
passed. The full race preceded only the final Back/forward-cache lifecycle guard;
its physics, inference prompt and shipped driver policies are unchanged in the
release. UI and navigation were tested again after that guard was added.
