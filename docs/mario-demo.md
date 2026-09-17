# World 1-1: continuous local Qwen play

[Play World 1-1](https://kikoncuo.github.io/jevfire/mario.html) ·
[Speed research, controller design and measurements](mario-realtime.md)

This playable recreation uses original JavaScript physics and Canvas2D artwork.
It includes question blocks, coins, mushrooms, Goombas, pipes, three pits, stairs,
a flag and a castle. It is not a ROM emulator or an exact physics/pixel port;
the underground bonus room is not included. No extracted Nintendo assets are distributed.

## Choose a controller

- **Load Qwen:** the default is **Fast maneuvers + physics guard**, running locally
  through WebLLM/WebGPU. Qwen selects a collision-checked maneuver while the world
  continues at 1×. The pinned Qwen3.5 0.8B model downloads about 450 MB once.
- **Play yourself:** arrows move, Space jumps, Shift runs; touch buttons also work.
- **Watch scripted:** a separate geometric rule controller. It does not read the
  policy, use the model or increment AI counters.
- **Raw buttons · experimental:** the advanced original three-field controller,
  without a physics guard. Continuous mode is available; optional Decision steps
  waits at action boundaries for debugging. This mode is much less reliable.

## What the fast model controls

```json
{ "maneuver": "jump" }
```

The finite library contains `run`, `walk`, `hop`, `jump`, `jump_walk`, `brake`
and `retreat`. CPU physics predicts each option through a 1.6-second horizon after
an estimated inference delay. Qwen receives offered option IDs and predicted
forward gains, alongside the editable policy. It scores one verified label;
JavaScript assembles the declared maneuver value. The inspector shows those
model-visible options. Full forecasts are retained in diagnostics for QA.

The executor handles jump press/hold/release and maneuver expiry. The guard
rechecks the selected maneuver against the latest state; an outdated choice is
rejected while a committed maneuver continues. Without an active maneuver,
Mario brakes while enemies and physics still advance. There is no stored level
route and no hidden call to the scripted controller. This is explicitly a hybrid
Qwen-and-physics system, not an unaided LLM playing from pixels.

The policy prefix stays cached across decisions. Only the compact option table
is processed again, with one scored position per update. The next request starts
immediately after the previous result. [SDK details](browser-sdk.md).

| Display | Meaning |
| --- | --- |
| AI updates/sec | Accepted real-model maneuver choices per wall second |
| Fields/sec | One scored field per fast update; three per raw-button update |
| Mean inference | Worker latency for the complete chosen interface |
| Prompt work reused | Avoided input-token evaluations / logical input-token evaluations |
| Render FPS | Canvas frame submissions per wall second |
| Guard counts | Rejected stale choices, waiting stops and single-option selections |

A single-option menu still incurs scoring, but gives Qwen no strategic choice;
those selections are reported separately. Forecasting and button execution never
increment AI counters. A finite horizon cannot guarantee safety on every device.

## Raw-button comparison

The original interface independently selects:

```json
{ "direction": "right", "jump": true, "speed": "run" }
```

It sees player state, relative blocks, pits and enemies in tiles. It must learn
when to press and release jump itself. The SDK now supports two cache levels:
stable instructions across updates and the current observation across its three
fields. Field answers remain independent; earlier answers are not fed to later
fields. Only this advanced mode offers physics-pausing Decision steps.

## Verify locally

Run `cd web && npm ci && npm run dev`, then open `/mario.html`. `npm test` checks
physics, jump timing, clone isolation, stale choices, cache isolation and prompt
contracts. `qa/mario-live-run.js` records real Qwen through the normal UI at 1×;
`qa/mario-cache-ablation.js` compares cache strategies on paired frozen inputs.
The paused-only `window.marioProbe()` reports scores without applying controls.

## Original raw-button check (previous release)

The first production-build check used the real pinned model, five paired frozen
observations and alternating baseline/optimized order. Each pair used identical
inputs; the next pair changed its time-left fact so the shared path had to prefill
one fresh prefix, rather than reuse a previous complete observation.

| Three-field control update | Mean latency |
| --- | ---: |
| Independent prefills, cache disabled | 1,478 ms |
| Shared prefix, fresh once per observation | 541 ms |

That is **2.73× faster across these five local pairs**. The shared path reused
672 of 1,146 logical input-token evaluations in the recorded starting scene
(58.6% avoided); all 15 paired field assignments agreed. Both conditions used
128-token chunks with zero artificial yields. This is a small local timing
check, not a hardware-independent speed claim or a policy accuracy benchmark.

The keyboard movement/jump and mobile layout checks passed. The explicit scripted
controller cleared the course in 27.61 simulated seconds. **The first Qwen run did
not clear the course:** it repeatedly held jump and collided with the first
Goomba after seven updates, at x=18.52. The raw controls make this failure visible;
no scripted jumps were substituted. Shared-prefix reuse improves compute cost,
not the small model's platforming ability. [Raw check](../web/qa/mario-check-result.json)
and [reproduction script](../web/qa/mario-check.js).
