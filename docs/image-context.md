# Use images as decision context

An image can inform JEVfire decisions through a **two-stage pipeline**:
send the image to a vision model, then pass its text observations as JEVfire's
`context`. The included [Python example](../examples/image_context.py) runs both
requests and returns the observation, typed decisions, and separate timings.

```text
image + task text → vision chat endpoint → text observation
                                               ↓
                          JEVfire /v1/decisions → typed fields
```

This is not native image scoring in the same pass. The current
[`DecisionRequest`](../jevfire/models.py) accepts `context: str`, and the
[scorer](../jevfire/core.py) sends text-token prompts to `/v1/completions`.
Putting an image URL or base64 string inside that context does not make the
scorer see pixels. Do not send a list of image content parts to `/v1/decisions`.

## Requirements

- A running JEVfire sidecar and its text-scoring backend; use the
  [normal quickstart](../README.md#quickstart).
- A vision-capable model served through vLLM's `/v1/chat/completions`, with
  image input enabled, its processor/vision weights loaded, and a working chat
  template. A text-only checkpoint or a server configured with an image limit
  of zero will not work. The served model name comes from `/v1/models`.
- Python 3.11+ and the repository's normal dependencies (`httpx` and `pydantic`
  are already included). The helper does not load model weights locally.

vLLM accepts image content through its Chat Completions API, including remote
URLs and base64 data URLs. Its model table lists Qwen2.5-VL among supported
vision models. See the upstream [multimodal input guide](https://docs.vllm.ai/en/stable/features/multimodal_inputs/)
and [supported models](https://docs.vllm.ai/en/stable/models/supported_models/).

For a **separate vision backend**, this is an example launch configuration on
a suitable CUDA host with a compatible vLLM installation and available GPU
memory. It is not a command to run alongside an already full GPU:

```bash
vllm serve Qwen/Qwen2.5-VL-3B-Instruct \
  --served-model-name vision \
  --host 127.0.0.1 --port 8020 \
  --max-model-len 8192 \
  --limit-mm-per-prompt '{"image": 1}'
```

Use your installed vLLM version's CLI options and verify model compatibility.
The vision URL and JEVfire's backend can point to the same server **if that
deployment supports both image chat and JEVfire's required text scoring**;
the pipeline still makes two stages of inference. A second model is optional.

## Run the complete example

From the repository root, after installing the package and starting the services:

```bash
python examples/image_context.py \
  --image assets/browser-demo.png \
  --context 'Describe the depicted game scene and any readable interface text.' \
  --vision-url http://127.0.0.1:8020 \
  --vision-model vision \
  --endpoint http://127.0.0.1:8010
```

Replace the local image with your own PNG, JPEG, WebP, or GIF. The helper
base64-encodes its bytes and sends them to the vision endpoint; the server does
not need access to your local filesystem. It also accepts an HTTP(S) URL:

```bash
python examples/image_context.py \
  --image https://vllm-public-assets.s3.us-west-2.amazonaws.com/multimodal_asset/duck.jpg \
  --vision-url http://127.0.0.1:8020 --vision-model vision
```

`--image 'data:image/png;base64,...'` is supported too; substitute actual base64
data. For large images, prefer a file argument rather than a long shell argument.
Remote URLs are fetched by the vision server. Use sources accessible to that
server and apply its normal media-access policy.

Both endpoint arguments accept a server origin or a base ending in `/v1`.
If your endpoints require bearer authentication, set `VISION_API_KEY` and/or
`DECISION_API_KEY` separately. The latter is for a gateway in front of JEVfire;
the example does not add authentication to the sidecar.

The demo classifies three fixed fields: `scene` (`indoor`, `outdoor`, `unknown`),
`readable_text` (`present`, `absent`, `unknown`), and `needs_review` (boolean).
Customize `vision_request`, `decision_request`, and `ImageDecision` together
for another application. Its prompt asks the vision stage to preserve missing
evidence and uncertainty rather than guess. The helper stops if observation
generation is empty or truncated, the API fails, or JEVfire abstains; it does
not silently substitute a fabricated observation.

Example **response shape**, not a recorded inference result:

```json
{
  "mode": "vision_observation_then_text_decisions",
  "observation": "A rendered outdoor scene with readable interface labels.",
  "parsed_json": {
    "scene": "outdoor",
    "readable_text": "present",
    "needs_review": false
  },
  "vision_usage": {"prompt_tokens": 500, "completion_tokens": 20},
  "elapsed_ms": {"vision": 1200, "decisions": 120, "total": 1320}
}
```

## The HTTP payloads

The first request goes to the **vision server**, not JEVfire:

```http
POST /v1/chat/completions
Content-Type: application/json
```

```json
{
  "model": "vision",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "Describe the scene and readable text. Note uncertainty."},
      {"type": "image_url", "image_url": {"url": "https://vllm-public-assets.s3.us-west-2.amazonaws.com/multimodal_asset/duck.jpg"}}
    ]
  }],
  "temperature": 0,
  "max_tokens": 256
}
```

For a local file, the helper replaces `image_url.url` with
`data:image/png;base64,<encoded bytes>`. vLLM's server processes the image;
there is no manual `<image>` token in the text. The example additionally uses
a system instruction and disables thinking through a vLLM chat-template
argument, where the model's template supports it.

The second request goes to **JEVfire**, using the returned observation:

```json
{
  "context": "Task: classify the image. Vision observation: An outdoor duck beside water; no readable text is visible.",
  "schema": {
    "scene": {
      "type": "enum",
      "description": "Classify the scene from the observation. Use unknown when evidence is missing or ambiguous.",
      "choices": ["indoor", "outdoor", "unknown"]
    }
  }
}
```

The Python helper implements a larger three-field version of this request.

## Cost, guarantees, and browser limits

Image encoding/transfer, vision processing, image-token prefill, and generation
of the observation all add latency. Then JEVfire prefills and scores the text.
The helper measures both stages and total wall time, including HTTP; it makes
no claim that the README's text-only speedup applies to images. Reusing an
observation for an unchanged scene can save a vision call, but your application
must expire it when the scene changes and reject stale decisions.

JEVfire still guarantees declared keys and allowed values in its assembled
output. It cannot guarantee that the vision model saw the scene correctly,
that its summary preserved every important detail, or that the classifier
chose the right label. Evaluate **perception errors** separately from
**decision errors**, and preserve an explicit `unknown` path. Relative label
scores are not calibrated probabilities of correctness. Application rules
remain responsible for executing actions.

The [browser demo](../web/README.md) currently passes symbolic text to its
pinned Qwen 3.5 0.8B build; it does not send screenshots to the model. WebLLM
does have [image content types](https://github.com/mlc-ai/web-llm/blob/main/src/openai_api_protocols/chat_completion.ts),
but image inference also requires a compatible compiled model with an image
embedding entry point. The model family's vision capability does not establish
that this demo's compiled text-scoring path supports images. This Python helper
uses a server and does not change the browser demo's local-only behavior.

Native multimodal JEVfire scoring would need a new input contract, a
multimodal-aware prompt/processor path, candidate-logit support on that path,
and verified image/prefix cache behavior. That is future work, not an option
enabled by adding `image_url` to today's decision request.

## Verification status

CPU tests mock the HTTP responses and cover file/data-URL encoding, both API
payloads, typed output validation, and failures before scoring. Run:

```bash
python -m pytest -q tests/test_image_context.py
```

On September 16, 2026, a real request using `assets/browser-demo.png` reached
the existing Qwen3.8-27B vLLM deployment, but returned HTTP 400:
`At most 0 image(s) may be provided in one prompt. (parameter=image)`.
The deployment was not reconfigured. Therefore the complete vision-to-decision
path has **not** been live-validated on that deployment; the example requires
a vision-enabled endpoint. The error is distinct from an unsupported JSON
shape or a failed text-classification request.
