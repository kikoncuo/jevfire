# World 1-1: three controls, one shared context

[Play World 1-1](https://kikoncuo.github.io/jevfire/mario.html)

This is a playable recreation of the first Super Mario Bros. course, using original
JavaScript physics and Canvas2D artwork. It includes question blocks, coins,
mushrooms, Goombas, pipes, the three pits, stairs, a flag and a castle. The geometry
is recognizable, but this is not a ROM emulator or a pixel/physics-exact port. The
underground bonus room is not included. No Nintendo sprites, music, ROM or other
extracted game files are distributed.

## Three ways to play

- **Play yourself:** left/right arrows move, Space jumps, and Shift runs. Hold
  jump to rise higher; release before the next jump. Touch buttons also work.
- **Watch scripted:** an explicit geometric rule controller. It does not run the
  model, read the editable prompt or increment AI counters.
- **Load Qwen:** downloads the pinned Qwen3.5 0.8B model (~450 MB) and runs it
  through WebLLM on the browser's WebGPU device. No inference server is involved.

Qwen chooses three independently scored fields:

```json
{ "direction": "right", "jump": true, "speed": "run" }
```

`direction` is `left`, `still` or `right`; `jump` is a boolean; `speed` is `walk`
or `run`. JavaScript supplies these keys and values, scores single-token labels,
and assembles the result. A model response cannot add fields or select an
undeclared control. Valid controls can still miss a jump or run into an enemy.

## Give a small model usable state

The observation contains the player's position, velocity, grounded state and
held jump button; distance to the flag; relative solid bounds; the next obstacle
and its top height; the next pit's distance and width; nearby enemy positions and
velocities; and reachable items. Coordinates are in tiles, with x increasing
rightward, y increasing upward, and positions at each entity's bottom-left corner.
The inspector records the actual observation used for each accepted AI decision.

These are geometric facts, not a hidden planner's recommended action. Each of the
three field suffixes sees the same snapshot and player instructions. Later fields
do not see earlier answers. Pause, restart, policy changes and controller changes
invalidate pending results, so an old instruction cannot act in a new run.

**Decision steps** advance 0.30 seconds of simulated play per AI control update,
then wait for the model before advancing again. The canvas continues rendering
while inference runs. This deliberately gives the small model a chance to react;
it is not a claim of real-time platforming speed. **Live** mode keeps physics
running while Qwen thinks and is harder when inference is slow.

## How the SDK reduces prompt work

The game calls `FiniteDecisions.scoreFields()` once per update. It prefills the
common instructions and observation, saves the attention **and recurrent** state,
then restores that checkpoint for each field's short suffix. Only the first field
needs the full shared prefix on a new snapshot. The other two reuse it. Each final
hidden state still passes through the pretrained language-model head; the SDK
reads the allowed label scores, applies restricted softmax and maps winners back
to typed values.

```js
const result = await decisions.scoreFields({
  sharedPrompt: instructions + currentObservation,
  cacheKey: 'mario:controls',
  fields: [
    { key: 'direction', suffix: directionQuestion, choices: directionLabels },
    { key: 'jump', suffix: jumpQuestion, choices: jumpLabels },
    { key: 'speed', suffix: speedQuestion, choices: speedLabels },
  ],
  chunkSize: 128,
  yieldMs: 0,
});
applyControl(result.parsed_json);
```

This WebLLM build runs the field suffixes **sequentially** on one engine; it does
not expose multi-sequence GPU batching. Cache reuse removes repeated prompt work,
not all prompt computation or the field forwards. The private optimized adapter
is pinned and validated; unsupported runtimes use independent prefills and report
zero cache savings. [SDK API, runtime limits and verification](browser-sdk.md).

| Display | Meaning |
| --- | --- |
| AI updates/sec | Applied three-field control objects per wall-clock second |
| Fields/sec | Three assignments per accepted control update |
| Mean 3-field inference | Mean worker latency for the entire three-field request |
| Prompt work reused | Cached input-token evaluations / total logical input-token evaluations |
| Render FPS | Actual render submissions per second; independent of inference |

Rates use rolling wall-time windows. Mean inference and cache savings cover the
current run and remain visible after pausing. Scripted/manual play never counts
as AI inference. Token savings are not a measured latency multiplier.

## Verify locally

Run `cd web && npm ci && npm run dev`, then open `/mario.html`.
`npm test` covers collision, jumping, pits, blocks, enemies, power-ups, typed
controls, observations, cache isolation and scripted course completion. The
paused-only `window.marioProbe({cache: true|false})` runs real model scoring on a
snapshot without applying controls or adding throughput samples.

The source is split into `web/src/mario/level.js`, `game.js`, `renderer.js`,
`contract.js`, `prompt.js` and `main.js`. The renderer uses original pixel drawing
commands and requires no external art downloads. The shared inference worker and
SDK also serve the village and driving experiments.

## Recorded local check

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
