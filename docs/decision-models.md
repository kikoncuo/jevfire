# JEVfire, trained decision models, and constrained decoding

Research checked 17 September 2026. These recipes were inspected, not executed. Reported model results below come from the authors; they are not our benchmarks.

[Explore the interactive field guide](https://kikoncuo.github.io/jevfire/learn.html) ·
[Browser result: 71 ms per action on M4 Max](mario-realtime.md#measurements)

## What we built

JEVfire uses an existing language model to choose from a menu of typed values. It reads scores for existing token labels such as A, B, and C, keeps only the allowed labels, and lets ordinary code assemble the JSON. We did not retrain the weights, replace the tokenizer, or invent new vocabulary tokens.

The model still computes vocabulary scores. Scores outside the menu can be large; our selection step ignores them. If A originally has 10% probability, B has 5%, and everything else has 85%, restricting to A/B gives A = 10/15 = 66.7% and B = 5/15 = 33.3%. That is a relative preference *within this menu*, not a measured 66.7% chance of being correct. Softmax preserves the highest-scoring choice; it does not itself improve accuracy or calibrate confidence.

Caching reuses calculations for the exact unchanged prefix. New observations and field suffixes still need computation. Independent field queries can be batched on the CUDA path; the current browser engine evaluates fields sequentially. A batch is not proof that all work runs physically simultaneously. Dependencies between fields require conditioning later fields on earlier answers, joint candidates, or application validation. Our Mario controller also uses physics forecasting and a guard, so its success should not be attributed to the language model alone. [JEVfire source](https://github.com/kikoncuo/jevfire).

In TypeSafe's usage, **RLCD means Reinforcement Learning for Calibrated Decisions**. They describe a new architecture, sampler, and training algorithm. JEVfire pursues a similar software interface; it is not a verified reproduction of their training or architecture. [TypeSafe](https://typesafe.ai/).

## Constrained decoding is another useful option

A grammar engine tracks the partial JSON. At each generation step it masks vocabulary tokens that cannot continue a valid output, then updates its grammar state after the selected token. This supports richer schemas, nested arrays/objects, and free-text strings within permitted fields. Existing tokenization and model weights can remain unchanged. Forced text can sometimes be skipped, so “one expensive model call per punctuation token” is not a universal description. [XGrammar matcher](https://xgrammar.mlc.ai/docs/latest/api/python/grammar_matcher.html).

JEVfire is related: it imposes a small constraint at each choice position and builds the structure in code. General constrained generation builds the output as a sequence, allowing later fields to depend on previous generated values. Both approaches can use prefix caching. Neither guarantees factual correctness. Schema compliance also depends on supported constraints and successful completion, rather than interruption or token-budget exhaustion. [vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/).

Use finite-choice scoring for small menus and known structures; use constrained decoding when the output needs flexible nested content or arbitrary text. Training can improve either approach—the training method and output restriction are separate choices.

## 1. AlexWortega/openjev: Qwen trained as a classifier

**What changed:** Qwen3.5-4B is fine-tuned with a three-class classification head: contradiction, entailment, or neutral. Context becomes a premise and each candidate becomes a hypothesis. The new head scores their relationship rather than generating answer tokens. This is supervised learning, not reinforcement learning. [Model and weights](https://huggingface.co/AlexWortega/openjev).

**Recipe:** combine SNLI and MNLI, filter invalid labels, map the three classes consistently, and fine-tune the text backbone plus classification head. The released run uses 120,000 training examples, 2,000 validation examples, maximum length 256, batch 32, learning rate 2e-5, one epoch, gradient checkpointing, and seed 42. The vision tower is frozen. Optional LoRA is supported, but the recorded run does not use it. [Training source](https://huggingface.co/AlexWortega/openjev/blob/main/code/train.py).

From a checkout containing the authors' code and its dependencies, the recorded settings correspond to:

```bash
python code/train.py \
  --model Qwen/Qwen3.5-4B \
  --out ckpt/qwen3.5-4b-nli \
  --n-train 120000 --n-val 2000 \
  --max-len 256 --bs 32 --lr 2e-5 --epochs 1 \
  --grad-ckpt --seed 42
```

The saved training result reports **89.85% validation accuracy**. That measures the NLI task, not game-playing ability or confidence calibration. Each premise/hypothesis pair has its own three-way distribution; entailment scores across different candidate pairs do not automatically form one distribution summing to 100%. [Recorded run](https://huggingface.co/AlexWortega/openjev/blob/main/qwen3.5-4b-nli/train_result.json).

## 2. Verdict / rlcd-modernbert-151m: small model, probability-aware supervision

**What changed:** a roughly 151M-parameter ModernBERT/GLiClass model is fine-tuned to score candidates. Its published recipe minimizes cross-entropy plus Brier loss, then fits a temperature on separate calibration data. Despite the RLCD branding, the inspected trainer uses labeled examples and backpropagation; it is not a reinforcement-learning rollout loop. It also offers ONNX browser exports, using a different runtime from our WebLLM Qwen path. [Model](https://huggingface.co/heman10x/rlcd-modernbert-151m).

**Recipe:** start from `knowledgator/gliclass-modern-base-v2.0`; use Banking77/CLINC-derived records with an explicit insufficient-evidence option. The manifest lists 2,300 training, 500 validation, 500 calibration, and 1,000 test records. Train three epochs, batch 8 with four accumulation steps, backbone learning rate 2e-5 and head learning rate 1e-4. Use cross-entropy + 1×Brier and choose the checkpoint by validation NLL. [Training code](https://github.com/Heman10x-NGU/Verdict-open-jev/blob/main/scripts/train.py), [split manifest](https://github.com/Heman10x-NGU/Verdict-open-jev/blob/main/data/real_benchmark_manifest.json).

Example CUDA invocation after installing that repository's dependencies:

```bash
python scripts/train.py \
  --train_file data/real_banking_train.jsonl \
  --val_file data/real_banking_val.jsonl \
  --output_dir artifacts/reproduction \
  --epochs 3 --batch_size 8 --grad_accum 4 \
  --selection_metric val_nll --device cuda --seed 42
```

Next fit temperature using the separate calibration split and the selected fine-tuned checkpoint. Do not accidentally use the calibration script's default synthetic dataset or default base checkpoint. The fitted scalar softens or sharpens probabilities; a positive temperature preserves the winning class. Evaluate once on the untouched test split and also on changed candidate menus. [Calibration script](https://github.com/Heman10x-NGU/Verdict-open-jev/blob/main/scripts/train_calibrator.py).

**Important evidence:** the current v2 evaluation JSON reports 95% test accuracy both before and after temperature scaling. But equal-width calibration error worsens from **1.13% to 3.35%**, and Brier loss from **0.0756 to 0.0785**. The repository also documents failures when abstention wording and candidate distractors change. An explicit “I don't know” option cannot guarantee reliable uncertainty. Earlier model-card numbers disagree with this newer report; use the versioned evaluation receipt rather than mixing them. [Evaluation receipt](https://github.com/Heman10x-NGU/Verdict-open-jev/blob/main/reports/v2/evaluation_report_v2.json), [limitations](https://github.com/Heman10x-NGU/Verdict-open-jev#known-boundaries-and-model-limitations).

## 3. RLCR: actual reinforcement learning for calibrated confidence

**What changed:** the model generates reasoning, an answer, and confidence. Training grades answer correctness and penalizes mismatched confidence, then uses GRPO to update model weights. The paper's conceptual reward combines correctness with a negative squared calibration error. Being confidently wrong costs more than being cautiously wrong; merely reporting low confidence is not optimal when the answer is correct. [Paper: Beyond Binary Rewards](https://arxiv.org/abs/2507.16806).

**Model example:** `mehuldamani/hotpot-v2-brier-7b-no-split`, from the released RLCR collection. The Hotpot recipe starts with Qwen2.5-7B. A separate math recipe and checkpoints are also released. This is closely related research, not evidence of a reproduction of TypeSafe's proprietary recipe. [Models and code](https://github.com/damanimehul/RLCR).

**Recipe:** load the authors' Hotpot QA data; sample 32 completions per prompt at temperature 0.7; compute format, correctness, and Brier-related rewards; optimize with GRPO for one epoch. The published configuration uses learning rate 1e-6, BF16, prompt/completion limits 3,072/1,536, per-device batch 8, accumulation 64, and seed 43. Its implementation adds a format reward and scaled components, so the code reward is not literally just the paper's short formula. [Hotpot configuration](https://github.com/damanimehul/RLCR/blob/main/configs/Qwen-7B/hotpot/RLCR.yaml).

The authors provide Conda/DeepSpeed setup and an Accelerate launch command, with a pinned TRL version. Follow that environment rather than substituting current package versions blindly. Their documented Hotpot training uses four A100 GPUs; this is materially heavier than the small supervised classifier. The shipped config also enables Hub uploads and external experiment logging—review those settings before any local reproduction. [Training instructions](https://github.com/damanimehul/RLCR#training).

**Limit:** these checkpoints still generate reasoning text. Calibrating a confidence number in a generated answer does not automatically calibrate JEVfire's restricted A/B/C token scores. A new evaluator and adaptation would be necessary.

## Naming trap

The older Meta project called RLCD means **Reinforcement Learning from Contrastive Distillation**. It generates contrastive preference pairs, trains a reward model, and uses PPO to align a language model. It is real training, but a different research objective from calibrated decisions. [Meta RLCD](https://github.com/facebookresearch/RLCD).

## Practical next experiment for our games — proposed, not run

1. Record observations, candidate actions, and outcomes from many levels/seeds. Keep entire levels/seeds separate across training, calibration, and test data.
2. Train a small action scorer using good-action labels or outcome estimates. Decide what confidence should mean: “matches the teacher,” “survives the next second,” and “wins the level” are different targets.
3. Include difficult, unsafe, and insufficient-information cases. Train with a proper probability loss; calibrate only on separate data. Compare with the existing frozen-Qwen scorer and a deterministic policy.
4. Measure action latency, survival/win rate, Brier score, reliability by confidence bucket, and performance under shuffled options and unfamiliar states. Keep runtime guards where needed.
5. Try RL only if the supervised baseline misses strategic behavior: reward progress and survival while charging for crashes/deaths and incorrect confidence about a clearly defined outcome.

The expected speed benefit comes from the smaller model and shorter computation path. Any claimed magnitude needs measurement on the actual browser/GPU and must include context processing, cache behavior, and decision quality.
