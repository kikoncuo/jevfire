# Last Hearth — six villagers, one local model

**[Play Last Hearth →](https://kikoncuo.github.io/jevfire/)**

Keep a village alive against hunger and increasingly strong orcs. Two collectors
bring home food, two fighters train and protect them, and two builders repair
the settlement and construct defenses. Edit the objective and role policies;
Qwen chooses each person's actions. [3D art credits and licenses](ASSETS.md).

## Play

1. Click **Load Qwen 3.5** in a recent desktop browser with WebGPU and
   `shader-f16`. The 4-bit model is about **450 MB**, plus runtime files.
   Allow roughly 2 GB of free GPU/unified memory; requirements vary by device.
2. Start the village. Click a person or roster card to inspect health, hunger,
   action scores, and the exact observations supplied to the controller.
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
| Builders | `repair`, `build`, `relax` | Preserve buildings or invest in firing towers |

Foraging includes selecting a patch, walking, harvesting, and returning a full
basket. Defending selects a threatening orc and taunts it away from villagers.
Building and repair select legal sites. The model chooses high-level behavior;
navigation and combat are game code, not a hidden second model.

Hunger declines continuously. **Zero hunger means death.** Relaxing walks home;
hungry villagers there consume actual shared food and recover health. An empty
pantry cannot feed them. Training permanently raises fighter damage. Orcs roam,
acquire nearby villagers/buildings, and attack. New waves become stronger.
Finished towers shoot orcs. The run ends when everyone dies or the hall falls.
An allowed but unwise decision can lose the game.

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
  see allies/buildings under attack. Builders see damage and unfinished defenses.

These are observations computed from simulation state, not model-generated facts.
There is no screenshot interpretation in this browser build. A route's estimated
risk can become stale as orcs move. [Context design](../docs/game-context.md).

## Read the counters correctly

**One AI tick = one accepted model decision for one living villager.** One
WebLLM engine scores actors in a fair round-robin, taking fresh observations
before each request. It scores three labels at one output position; JavaScript
builds a result such as `{"mira":"forage_safe"}`. Generated text is ignored.
Missing or nonfinite scores fail explicitly.

| Display | Measurement |
|:--|:--|
| AI ticks/sec | Applied NPC decisions per wall-clock second over a rolling 10-second window; shorter during warmup |
| Squad rounds/sec | Completed rounds where every currently living villager received a fresh decision |
| Last inference | One actor's scoring time, including prefill |
| Model decisions | Total applied AI decisions in this run |
| Render FPS | Drawing frames per second; not model inference |

Scripted mode shows no AI rate. Paused rates are zero. Pauses, resets, changed
orders, and dead actors discard pending results. This browser does not implement
vLLM's parallel scheduling or explicit prefix-cache optimization. The repo's
**10.3× CUDA result is a separate benchmark**, not a claim for this game.

The model cannot invent a field or choose outside the role enum. It can still
choose badly, misunderstand observations, or follow an injected instruction
that changes its preference. Scores are not calibrated confidence.
[Exact structural guarantee](../docs/guarantees.md).

The supplied policies remain experimental: the final handcrafted scene checks
matched 7/12 development cases and 4/12 additional cases. Missed meals,
training, and construction still occur. [Full results and limitations](qa/README.md).
Prompt tuning here did not establish an optimal survival policy.

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
| Labels | Three verified distinct single tokens, A/B/C |

Models/tokenizers download from Hugging Face/CDNs, the compiled library from
GitHub, and fonts from Google Fonts. Mission text and game state stay on-device.
WebLLM caches completed files in IndexedDB; browsers may evict them. This is not
an offline-installable PWA, though inference works without a network after the
page, assets, and model load. Upstream models and dependencies retain their
licenses. The application's MIT license does not relicense them.

The earlier Signal Run demo remains in commit
`c75ea086fc5aeee2eb8971b24631b827bd510045`.
