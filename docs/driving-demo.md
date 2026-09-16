# Slipstream: four cars, four prompts

[Open Slipstream](https://kikoncuo.github.io/jevfire/driving.html). Four racing
drivers share one Qwen 3.5 0.8B model running locally through WebLLM/WebGPU. Each
driver has its own editable strategy and observation; JEVfire scores a finite
set of maneuvers and assigns the winning enum to that driver's field.

The simulation keeps moving between decisions. Three laps, traffic, a wet bend,
tyre wear, damage, boost and pit stops create consequences for the chosen
actions. This is an arcade racing experiment for inspecting model behavior.

## Run an experiment

1. Load Qwen, then start the race. The pinned model downloads on first use and
   its files are cached locally. WebGPU with `shader-f16` is required for this
   model build.
2. Select a car, its number tag, or its driver card. Inspect its current state,
   latest accepted model choice, candidate scores and saved observation.
3. Edit that driver's strategy and apply it. Prompts are limited to 1,000
   characters and retained in browser storage when available. Applying an edit
   invalidates an older pending decision.
4. Compare results with the same race seed, simulation speed and assistance
   settings. The seed determines the wet bend, its grip and starting-slot
   rotation. Live inference timing can still change the race outcome.

The scripted mode provides a separate, explicitly labeled demonstration of the
race mechanics. Its hand-written policies do not read the editable prompts and
do not count as AI decisions. Model errors pause model mode; the application
does not silently substitute scripted choices.

## The four strategies

The defaults in [contract.js](../web/src/driving/contract.js) deliberately ask
for different tradeoffs. These are instructions to evaluate, not guarantees
that a small model will follow them consistently.

| Car | Driver | Default strategy                                                                                               |
| :-- | :----- | :------------------------------------------------------------------------------------------------------------- |
| 01  | Nova   | Win or wreck: prioritize overtaking traffic through tighter gaps; accelerate or boost when clear.             |
| 02  | Atlas  | Finish intact: brake early, leave generous gaps and service the car before its condition becomes severe.       |
| 03  | Juno   | Resource strategist: preserve tyres, maintain a smooth pace and weigh pit time against the final lap.          |
| 04  | Milo   | Patient late charge: conserve resources early, then spend boost and accept a calculated risk when behind late. |

For example, replace one driver's strategy with:

```text
Protect the car until the final lap. Enter wet bends below the recommended
speed. Avoid risky overtakes. Keep a useful pace on clear straights, and save
boost for a final-lap pass. Pit if damage or worn tyres threaten finishing.
```

The shared race instruction still asks every driver to finish three laps ahead
of the other drivers. All cars use the same model weights; the individual
strategy text and current state supply the differences.

## Actions and consequences

The three-lane circuit is approximately 439 metres long. Four competitors start
from two grid rows and race to a common finish line after three laps. Six grey
traffic cars circulate under deterministic following rules. The race records
finish order and retires unfinished competitors at the 180-second simulation
time limit.

| Allowed action              | Meaning in the simulation                                                                                   |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `accelerate`                | Raise the cruise target by 4 m/s, or 14.4 km/h, up to the normal maximum of 111.6 km/h.                     |
| `brake`                     | Lower the target by 6 m/s, or 21.6 km/h, and cancel boost.                                                  |
| `hold`                      | Keep the current cruise target; the car continues moving.                                                   |
| `left`, `right`             | Move one lane when the larger normal traffic-gap checks permit it.                                          |
| `boost`                     | Spend energy on a burst lasting up to 2.5 seconds, with a nominal maximum of 140.4 km/h.                    |
| `risky_left`, `risky_right` | Take a tighter gap with a faster lane change and temporarily suppress the following assist.                 |
| `pit`                       | Commit to the outside pit entry, stop for six seconds, restore tyres and boost, repair damage, then rejoin. |

Tyre condition, vehicle damage, lane radius and the wet sector affect corner
grip. Sustained excess corner speed causes a spin, time loss, tyre wear and
damage. Boost consumes energy and increases wear; damage also reduces power.
Contacts cause damage and slow the involved cars. Damage reaching 100 retires
a competitor. These consequences are computed by the simulation, with visible
boost trails, skid marks, smoke and a race-event log.

Available choices change with the state. Edge lanes remove impossible turns;
traffic-gap checks distinguish ordinary from risky merges. Spinning, servicing,
finished and retired cars are not offered ordinary driving decisions. A pit
request commits the car to a deterministic entry/service/exit controller.

**Following assist is a separate rule.** When enabled, it can brake for a car
ahead. It does not protect corner entry speeds, and a risky overtake suppresses
it for 2.2 seconds. The interface reports interventions separately from the
model's selected maneuver. Physics, pit servicing and automatic traffic are
also application rules, not hidden AI decisions.

## What each driver sees

[game.js](../web/src/driving/game.js) builds a structured snapshot for one
driver. [prompt.js](../web/src/driving/prompt.js) turns the relevant facts into
a compact textual observation alongside that driver's strategy and available
options. The 3D renderer is visual feedback; model control uses the simulation
state.

| Context        | Information supplied to the driving prompt                                                                                                      |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| Race           | Position, laps and distance remaining, gap to the leader, and the nearest competitors ahead and behind in race progress.                        |
| Own car        | Lane and lane-change state, actual and target speed, tyres, damage, boost energy and remaining boost duration.                                  |
| Corners        | Whether the car is in a bend, current and upcoming wetness, recommended corner speed, distance to the next bend and estimated braking distance. |
| Traffic        | Nearest front and rear car in each lane, bumper gap, speed, closing speed, time to contact, and ordinary/risky lane-entry availability.         |
| Pit and assist | Distance to pit entry, pit phase and service time, following-assist status and remaining risky-override time.                                   |

The observation includes traffic up to **140 m ahead and 80 m behind**, measured
along each lane. Accounting for the longer outside arc avoids confusing cars
on opposite sides of the circuit with nearby hazards. Cars occupying a lane
during a merge are included in the traffic checks.

Speeds in the model-facing prose are **km/h**; closing speeds are explicitly
**m/s**. Gaps and braking distances are **metres**, and durations/TTC are
**seconds**. Positive closing speed means the bumper gap is shrinking. A null
TTC means the observed pair is not closing at a meaningful rate. The saved
structured snapshot retains explicitly named `speedMps` and `speedKph` fields;
resource levels run from 0–100, with lower damage being better.

The inspector saves the observation used for the latest accepted result. This
lets you compare the state the model received with the state after inference
completed. The application checks the request identity and run/prompt version,
then checks action availability again before applying a result. An unavailable
result is discarded and a later request reads fresh state. That check does not
prove an action is strategically good: an allowed speed change can still be
wrong for the approaching bend.

## One scored position, one assigned value

For each request, the worker maps the current candidate actions to distinct
labels that the pinned tokenizer verifies as single tokens. It prefills the
driver's prompt through the pretrained model and captures the label logits at
the final output position. The application normalizes those scores over the
available candidates, selects the maximum, and maps the label back to the
declared action enum.

The model's sampled text is ignored. JavaScript constructs a result such as:

```json
{ "nova": "brake" }
```

The shipped driving prompt uses compact observations and a fixed `Action:`
assistant prefix before scoring letter labels. This improved a small set of
development scenes, but the model still missed braking instructions. The
[full probe results](../web/qa/README.md#slipstream-driving-demo) include those
failures; intended personalities are not guaranteed race behavior.

The driver key comes from the application's request, and `brake` must come
from its allowed options. Generated text cannot introduce a new key such as
`teleport` or an undeclared maneuver. The completed object is validated before
use. This structural guarantee does **not** mean the decision is sensible,
that prompts cannot influence it, or that the model is hallucination-free.

The displayed percentages are **relative option scores, not calibrated
confidence**. Softmax makes the selected candidates sum to one; it does not
estimate the chance of a safe maneuver or a race win. Label wording, option
ordering and prompt wording can affect the result. The panel displays actual
scores and action history, not a generated explanation of the model's reasoning.

See [fixed fields and finite values](guarantees.md) and
[how JEVfire works](how-it-works.md) for the underlying contract.

## Browser scheduling and performance

All eligible drivers enter one fleet request from the same frozen world snapshot.
One WebLLM engine scores their independent prompts **sequentially**, reusing each
driver's unchanged system-prompt checkpoint. The model build does not expose physical
multi-sequence GPU execution; sending four concurrent promises would still queue
on the same engine. The next fleet request starts immediately after completion.
Each car's answer is applied as soon as it is ready, without waiting for the other
cars. There is no inter-request pause and maximum mode uses 128-token submissions with
zero artificial yield delay. Lane reservations and available actions are checked
again before applying results, so outdated or conflicting maneuvers are discarded.

Cached policies are separate from downloaded model files. A changed policy or available-label header
invalidates its exact token prefix; changing traffic is always processed afresh.
The SDK skips intermediate sampling/readback on its optimized path and reports
actual processed and cached token counts. [Browser SDK](browser-sdk.md).

| Measurement | Meaning |
| --- | --- |
| Fleet decisions/sec | Accepted car choices per elapsed wall second |
| Fleet rounds/sec | Completed requests, each covering all currently eligible cars |
| Mean fleet inference | Worker time for a complete fleet request |
| Per-car updates/sec | Accepted choices for that specific car per wall second |
| Amortized ms/car | Total fleet inference time divided by scored car choices; not individual response latency |
| Prompt work reused | Cached token evaluations divided by logical input-token evaluations |
| Render FPS | Submitted scene draws per wall second |

Four cars receiving one update per second mean four decisions/sec and one fleet
round/sec. A serial implementation would need an amortized budget of 250 ms/car
including overhead; a true parallel batch could take up to one second for the
whole fleet. `1×` controls simulation speed, not AI frequency. The current UI never
labels a fleet request as one car decision or treats four fields as four GPU
batches. Applied and discarded counts remain distinct. Rates use ten-second rolling windows (five seconds for frames); means and cache
savings cover the current run and remain visible after pausing. Paused rates are
zero. The UI also shows how many cars are eligible and the mean cars per round.

The previous recorded race averaged **1,451 ms per accepted single-car inference**
and produced **44 applied choices in 78.366 wall seconds (0.56/sec)**, using the
old balanced path with a 200 ms inter-request pause. These are historical numbers,
not measurements of the new cache/maximum-throughput path. The
[recorded race](../web/qa/driving-race-current.json) retains its original settings.

The [driving quality study](driving-quality.md) compares the published worker,
the optimized scorer and complete live races. It reports both faster scoring
and weak policy accuracy, including the effect of older observations.

Inference and rendering share the GPU. Removing idle time prioritizes decisions
and can increase render contention. The renderer batches geometry, caps pixel
ratio at 1.25 and avoids dynamic shadows; no hardware-independent FPS or inference
latency is promised. CUDA speedups and village measurements are separate results.

## Implementation map

| File                                                  | Responsibility                                                                          |
| :---------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| [contract.js](../web/src/driving/contract.js)         | Fixed driver IDs, prompts, actions and candidate-label configuration.                   |
| [game.js](../web/src/driving/game.js)                 | Race physics, observations, allowed actions, deterministic rules, outcomes and ranking. |
| [track.js](../web/src/driving/track.js)               | Lane geometry, distances, pit markers and seeded wet sector.                            |
| [prompt.js](../web/src/driving/prompt.js)             | Compact per-driver model prompt with explicit units and action meanings.                |
| [inference.worker.js](../web/src/inference.worker.js) | Shared browser model loading, chunked prefill, score capture and typed assembly.        |
| [main.js](../web/src/driving/main.js)                 | Driver scheduling, stale-result checks, prompt editing, telemetry and inspector.        |
| [renderer.js](../web/src/driving/renderer.js)         | Procedural circuit/cars, selection and lightweight racing effects.                      |

Run locally using the [browser development instructions](../web/README.md),
then open `/driving.html`. Artwork provenance is recorded in
[ASSETS.md](../web/ASSETS.md).
