# JEVfire browser demos

[World 1-1](https://kikoncuo.github.io/jevfire/mario.html) adds a third game: original
Canvas2D art, playable keyboard/touch controls, a scripted baseline and local Qwen
choosing three typed controls with shared-context SDK reuse. [Game notes](../docs/mario-demo.md).

**[Slipstream: four racing strategies →](https://kikoncuo.github.io/jevfire/driving.html)** ·
**[Last Hearth: six villagers →](https://kikoncuo.github.io/jevfire/)**

All three demos run Qwen 3.5 0.8B locally through WebLLM and WebGPU. The same pinned
model files can be reused from the browser cache; each page creates its own
worker and engine. Neither requires an inference server or API key.

## Slipstream

Open `driving.html`, load Qwen, and start a three-lap race. Four cars receive
separate editable prompts. Click a numbered car or its roster card to inspect
its speed, race position, resources, current maneuver, last model choice and
saved input. Apply a prompt edit to use it for that car's next decision.

Nine finite actions cover acceleration, braking, holding pace, left/right lane
changes, boost, risky left/right overtakes, and pit service. Only currently
available actions are scored. Worn tyres and wet corners lower grip; excessive
speed causes spins and damage, with retirement at 100 damage. Pitting involves
driving to the entry and a six-second stopped service. Three laps decide the
winner; unfinished cars retire at the 180-second simulation cutoff.

Following assistance brakes for close traffic, never for corners. A risky pass
briefly disables it. Lane tracking and pit routing are simulation rules.
**Try scripted drive** uses a separately labeled controller with no inference.
Boost, spins, contact, overtakes, pit visits and finishes appear in Race control.

Observations include actual/target speed, position and rival gaps, nearby traffic
in all three lanes, closing speeds and time to contact, the next corner's safe
speed and braking distance, tyres, damage, boost, and pit distance. Read the
[full design and context contract](../docs/driving-demo.md).

The model scores all eligible drivers in one fleet request, sequentially on
one engine, and immediately starts the next request. Stable policies are cached.
It cannot
invent keys or actions, but can choose badly. Physics runs independently of
inference; a higher simulation speed gives the model less time to react per
simulated second. Reset, pause, policy edits and unavailable actions invalidate
stale results. Forced pit routing and paused probes add no AI decisions.

See [driving QA and policy experiments](qa/README.md#slipstream-driving-demo)
for measured results and limitations. The CUDA benchmark headline is not a
browser speedup claim.

## Last Hearth — six villagers, one local model

**[Play Last Hearth →](https://kikoncuo.github.io/jevfire/)**

Keep a village alive against hunger and increasingly strong orcs. Two collectors
bring home food, two fighters train and protect them, and two builders repair
the settlement, construct defenses, and heal wounded allies. Edit the objective and role policies;
Qwen chooses each person's actions. [3D art credits and licenses](ASSETS.md).

## Play

1. Click **Load Qwen 3.5** in a recent desktop browser with WebGPU and
   `shader-f16`. The 4-bit model is about **450 MB**, plus runtime files.
   Allow roughly 2 GB of free GPU/unified memory; requirements vary by device.
2. Start the village. Click a person, nameplate, or roster card to open its
   inspector. See level/XP, health, hunger, current job, and recent decisions.
   On smaller screens, details open in a compact panel with a close button.
3. Edit the village order and role policies. Balance food reserves against
   early defenses, or risk faster foraging. Policies persist in this browser;
   **Restore** returns a role to the supplied policy.
4. Try again with the same seed. The separately labeled **scripted baseline**
   runs without a model download. It does not follow prompt edits and is never
   substituted for failed model inference.

Drag to orbit, scroll to zoom, and use the crosshair to restore the camera.
The game pauses when its tab is hidden. Simulation speed does not increase model
throughput. Seeds fix random spawning/roaming, but model arrival times and update
cadence also affect play; identical seeds do not guarantee identical AI runs.

## Roles and rules

| Role | Choices | Tradeoff |
|:--|:--|:--|
| Collectors | `forage_safe`, `forage_bold`, `relax` | Safer routing versus faster, riskier food runs |
| Fighters | `train`, `defend`, `relax` | Future strength versus intercepting current attacks |
| Builders | `repair`, `build`, `heal`, `relax` | Preserve buildings, invest in towers, or spend food treating allies |

Foraging includes selecting a patch, walking, harvesting, and returning a full
basket. Defending selects a threatening orc and taunts it away from villagers.
Building and repair select legal sites. The model chooses high-level behavior;
navigation and combat are game code, not a hidden second model.

Hunger declines continuously. **Zero hunger means death.** At 28 hunger, a visible
automatic-needs rule interrupts work, finds actual food at the hall, in a carried
basket, or at a stocked patch, and resumes the chosen job after eating. It does
not create food or count as an AI decision. Relaxing also walks home to eat and
recover. Builders travel to wounded allies and spend one stored food per treatment
to restore up to 20 HP. Training permanently raises fighter damage. Orcs roam,
acquire nearby villagers/buildings, and attack. New waves become stronger.
Finished towers shoot orcs. The run ends when everyone dies or the hall falls.
An allowed but unwise decision can lose the game.

Each villager has a distinct prompt: Mira is cautious, Bram likes short trips
and leisure, Aldric protects others, Sable prioritizes training, Tomas builds, and
Nell prioritizes treatment. Personality influences scores; it does not hard-code
a job. Stamina falls while working and recovers at home. Rest becomes available
when tired, hungry, wounded, already on a break, or when no useful job remains.
Bram takes earlier breaks (70 stamina), Tomas later ones (30); other thresholds
are shown in context. Unavailable work is removed from the candidate set. When only relaxation
is available, a labeled game rule applies it without invoking the model or
increasing AI ticks.

## Character levels and decisions

Every character starts at **level 1** and earns one level per **100 XP** from
productive work. Collectors earn 10 XP per harvested food; fighters earn 2 XP
per productive training second and 0.5 per actual damage dealt to an orc. Builders earn
0.1 XP per building HP repaired, 60 per tower constructed (shared according to
actual progress), and 0.5 per ally HP healed. Walking, resting, model calls,
and tower attacks do not award XP. Reset starts everyone at level 1 again.
Levels are experience milestones, with no added combat or work-speed multiplier;
fighters' existing training strength still determines damage.

The inspector distinguishes **current job and activity** from the **latest Qwen
decision**. The six-entry history identifies Qwen decisions, scripted commands,
forced single-option jobs, and automatic meal breaks with simulation timestamps.
Repeated identical scripted/rule assignments are collapsed; actual repeated model
decisions remain visible. Scores and the saved input snapshot belong to the
shown Qwen decision, not to a newer world state or automatic action. A scorer
provides preferences, not a generated explanation of its reasoning.

## What the model knows

Each villager gets compact, role-specific observations rather than a dump of
every world coordinate:

- Health, hunger, estimated time until starvation, walk time home, current
  action, carried food, and number of attackers.
- Shared food, living population, wave, hall health, and threatened people or
  buildings.
- The nearest two orcs: distance, bearing, health, level, current attack target,
  and estimated direct approach time.
- Collectors see food patches, stock, route danger, and trip estimates. Fighters
  see allies/buildings under attack. Builders see damage, unfinished defenses,
  and wounded allies. Each actor also sees its current available jobs.

These are observations computed from simulation state, not model-generated facts.
There is no screenshot interpretation in this browser build. A route's estimated
risk can become stale as orcs move. [Context design](../docs/game-context.md).

## Read the counters correctly

**One AI tick = one accepted model decision for one living villager.** One
WebLLM engine scores actors in a fair round-robin, taking fresh observations
before each request. It scores the available labels (up to four) at one final output position; JavaScript
builds a result such as `{"mira":"forage_safe"}`. Generated text is ignored.
Missing or nonfinite scores fail explicitly.

| Display | Measurement |
|:--|:--|
| AI ticks/sec | Applied NPC decisions per wall-clock second over a rolling 10-second window; shorter during warmup |
| AI rounds/sec | Completed rounds covering actors currently eligible for AI (multiple available jobs, no meal break) |
| Last inference | One actor's scoring time, including prefill |
| Model decisions | Total applied AI decisions in this run |
| Render FPS | Actual draws per elapsed wall time over 5 seconds; capped near 60 |
| Frame p99 | 99th percentile of animation-frame gaps over 5 seconds; lower is smoother |

Scripted mode shows no AI rate. Paused rates are zero. Pauses, resets, changed
orders, dead actors, automatic meal breaks, and newly unavailable jobs discard
pending results. Round counts use the currently eligible actor set; rule-only jobs and meal
breaks do not add model decisions. The browser SDK reuses exact instruction
prefixes but does not implement vLLM's parallel GPU batching. The repo's
**10.3× CUDA result is a separate benchmark**, not a claim for this game.

The model cannot invent a field or choose outside the role enum. It can still
choose badly, misunderstand observations, or follow an injected instruction
that changes its preference. Scores are not calibrated confidence.
[Exact structural guarantee](../docs/guarantees.md).

The supplied policies remain experimental. The previous release matched only
7/12 and 4/12 development scenes; those tests predate automatic meals, healing,
personalities, and available-action filtering. They are historical evidence,
not scores for this version. [Results and limitations](qa/README.md).
Prompt tuning here has not established an optimal survival policy.

## Smooth rendering and inference

A Web Worker keeps model orchestration off the main thread, but WebLLM and the
browser compositor still share a GPU. The new SDK checkpoints unchanged prompt
prefixes, including attention and recurrent state. The optimized adapter avoids
sampling and intermediate vocabulary readback; an unsupported runtime falls back
to independent prefills. See [the SDK implementation and limits](../docs/browser-sdk.md).

Last Hearth retains its responsiveness controls: Balanced uses 32-token chunks
with 16 ms yields and a 200 ms inter-decision pause; Maximum uses 128-token chunks
with no artificial in-worker yields and a 30 ms UI pause. **Slipstream** instead
scores an entire fleet snapshot with 128-token submissions and immediately starts
the next fleet request: no inter-request pause. Its per-driver policies are cached.
**World 1-1** reuses one observation across movement, jump and speed suffixes,
using 128-token submissions and no artificial in-worker yields. Its default
Decision steps mode explicitly waits at each action boundary; Live mode does not.

This browser runtime scores independent suffixes sequentially. It does not expose
simultaneous multi-sequence GPU execution. Higher throughput can compete with
rendering, and changed submission shapes can alter close floating-point scores.

The scene batches static foliage, caches shadows, limits pixel ratio, caps draws
near 60 FPS, and updates label content at 10 Hz. Low graphics reduces resolution
further. [Frame measurements and reproducible scripts](qa/README.md) include cold
and warm observations; hardware and shader compilation affect the results.

## Develop and verify

Requires Node.js 22.12+ or a newer version supported by Vite:

```bash
cd web
npm ci
npm run dev
```

WebGPU requires HTTPS or localhost. Explicitly load the model in the opened page.
Inference runs in a Web Worker through WebLLM; Three.js renders through WebGL.
There is no inference API key or remote model server.

```bash
npm test
npm run format:check
npm run build
npm run preview
```

CPU tests cover hunger, meals, death, training, construction, repair, aggro,
taunts, tower combat, observations, seeded balance, role contracts, stale results,
fair scheduling, and measured tick rates. GPU checks require a supported browser
and downloaded model. [QA scripts, fixtures, and results](qa).

## Pinned runtime

| Component | Pin |
|:--|:--|
| WebLLM | `@mlc-ai/web-llm` 0.2.85 |
| Tokenizer runtime | `@mlc-ai/web-tokenizers` 0.1.6 |
| Weights | [Qwen3.5-0.8B-q4f16_1-MLC](https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/tree/0ec138972555613c1d7812a821778ad0398c8790) |
| Weight revision | `0ec138972555613c1d7812a821778ad0398c8790` |
| Library | MLC `v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm` |
| Library revision | `025bcaf3780fa8254f5e5efd3bfea0a5397248f4` |
| Context | 2,048 tokens; input capped at 1,800 |
| Labels | Verified distinct single tokens mapped to finite actions; up to four village choices or nine driving choices |

Models/tokenizers download from Hugging Face/CDNs, the compiled library from
GitHub, and fonts from Google Fonts. Mission text and game state stay on-device.
WebLLM caches completed files in IndexedDB; browsers may evict them. This is not
an offline-installable PWA, though inference works without a network after the
page, assets, and model load. Upstream models and dependencies retain their
licenses. The application's MIT license does not relicense them.

The earlier Signal Run demo remains in commit
`c75ea086fc5aeee2eb8971b24631b827bd510045`.
