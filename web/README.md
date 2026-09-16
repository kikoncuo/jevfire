# Signal Run — the JEVfire browser lab

**[Play the demo →](https://kikoncuo.github.io/jevfire/)**

Three squad members recover supply cores from an isometric arena. A local
**Qwen 3.5 0.8B** model chooses `recover`, `return`, `evade`, or `hold` for each
unit. Give it a mission, add hazards, or try asking for an invented JSON field.
The model proposes actions; deterministic navigation and game rules execute them.

Everything runs in the browser: WebLLM inference on WebGPU, a Web Worker for
scoring, JavaScript game simulation, and Canvas 2D rendering. There is no model
API, Python server, API key, or CUDA box behind this demo.

## Try it

1. Open the demo in a recent desktop browser with WebGPU, hardware acceleration,
   and `shader-f16` support. Leave at least roughly 2 GB of GPU/unified memory
   available; actual memory use varies by browser and device.
2. Click **Download & load Qwen**. The 4-bit model files are about **450 MB**,
   plus the application and compiled runtime. Download starts only on this click.
   WebLLM stores completed files in IndexedDB; browsers can evict that cache.
3. Click **Deploy squad**. Change the order, pause, reset, or drop a hazard.
   The cards show the model's choice, relative candidate scores, and any rule
   that overrides the proposed action.

The separately labeled **scripted preview** works without a model download. It
uses hand-written rules and is never substituted silently for failed inference.

Weights/tokenizers download from Hugging Face and its CDNs; the compiled model
library downloads from GitHub. The page also loads Google Fonts. Mission text
and game state stay on the device. This is not an installable offline PWA;
reopening the site can still require network access to load its assets.

## How the decision contract works

```text
symbolic world + your mission
          ↓
three field prompts → WebLLM → logits for A, B, C, D
          ↓
JavaScript selects an allowed value for each fixed field
          ↓
{ ember: "recover", moss: "hold", echo: "return" }
          ↓
validate → game rules → navigation + animation
```

The tokenizer verifies that all four labels are distinct single tokens. A
WebLLM `LogitProcessor` captures their raw scores before sampling transforms.
Each completion requests one output position. Its generated text is ignored;
`contract.js` creates the keys and maps each winning label to an allowed action.
Missing or nonfinite scores fail the request. Relative softmax scores are
**not calibrated confidence**.

The model cannot add `teleport: true` or select `fly`, because neither key nor
value can enter the assembled object. It can still pick a wrong allowed action
or respond to an injected instruction by changing its choices. The UI includes
a challenge demonstrating this distinction. [Full guarantee →](../docs/guarantees.md)

WebLLM's public completion API accepts one prompt at a time. The three fields
are scored **sequentially on one engine**, using the same snapshot of the world.
This demo does not port the CUDA sidecar's parallel scheduling or explicit
shared-prefix cache optimization. It makes no browser speedup claim. The displayed
cycle latency includes all three calls; animation proceeds independently. Paused,
reset, or superseded missions discard stale inference results.

## Run locally

Requires Node.js 22.12+ (or a newer version supported by Vite).

```bash
cd web
npm ci
npm run dev
```

Open the printed localhost URL. WebGPU requires a secure context: HTTPS or
localhost, not an arbitrary HTTP address on your LAN.

```bash
npm test
npm run format:check
npm run build
npm run preview
```

CPU tests cover finite outputs, invalid scores, invented fields, game rules,
stale results, and core collection. Real GPU checks require a supported browser
and a model download; they are not run by the CPU-only CI job.

The [recorded browser smoke test](qa/smoke-result.json) passed on Chromium 152
with an Apple Metal 3 WebGPU adapter on September 16, 2026. The production build
recovered a core with browser networking disabled after loading, followed a Hold
order, retained the fixed schema under the injection challenge, discarded a
result after reset, and fit a 390 px viewport without horizontal overflow.
The three recorded cycles took 971.5, 591.4, and 977.6 ms. These are individual
smoke-test observations, not a benchmark distribution or a comparison with JSON.

To repeat with the Playwright CLI, open the app in its isolated browser session,
click the download button, and wait until Qwen is ready. From `web/`, run:

```bash
playwright-cli -s=cowork open http://127.0.0.1:5173 --persistent --headed
# Load the real model in the opened browser before this next command.
playwright-cli -s=cowork run-code --filename=qa/browser-smoke.js
```

The script temporarily disables networking, restores it in `finally`, and
returns real scores and timings. It does not mock inference. Outputs are also
available through `window.jevfireSmokeReport` in that browser page.

## Pinned model and runtime

| Component | Version / source |
|:--|:--|
| Runtime | `@mlc-ai/web-llm` **0.2.85** |
| Tokenizer runtime | `@mlc-ai/web-tokenizers` **0.1.6** |
| Weights | [mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC](https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/tree/0ec138972555613c1d7812a821778ad0398c8790) |
| Weight revision | `0ec138972555613c1d7812a821778ad0398c8790` |
| Compiled library | MLC `v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm` |
| Library revision | `025bcaf3780fa8254f5e5efd3bfea0a5397248f4` |
| Context | 2,048 tokens; inputs capped below 1,800 tokens |
| Template | Qwen ChatML, empty thinking block; symbolic text inputs only |

Upstream: [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B),
[WebLLM](https://github.com/mlc-ai/web-llm), and its
[API reference](https://webllm.mlc.ai/docs/user/api_reference.html).
Weights are downloaded separately and retain their upstream license. The
application's MIT license does not relicense models or dependencies.

This small model is an experimental controller. Legal actions are guaranteed;
successful strategy, perfect instruction following, and independent choices
that always agree with one another are not. Test your own tasks before reuse.
