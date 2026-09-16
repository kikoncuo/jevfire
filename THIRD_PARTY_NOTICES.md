# Attribution

JEVfire takes its name from **JEV**, the original inspiration, and builds on the
shared-context categorical decoding approach demonstrated in
[harshatheg/Qwen-2.5-1B-RLCD](https://huggingface.co/harshatheg/Qwen-2.5-1B-RLCD).
It is an independent implementation for an already running CUDA/vLLM engine.
No model weights or source files from that demo are distributed here.

[vLLM](https://github.com/vllm-project/vllm) is licensed under
[Apache 2.0](https://github.com/vllm-project/vllm/blob/main/LICENSE).
The optional patch changes one constant in its `vllm/sampling_params.py`;
the installed vLLM package and modified file retain their upstream license.
JEVfire's MIT license does not relicense vLLM or model weights.

The measured model is
[Qwen/Qwen3.8-27B-FP8](https://huggingface.co/Qwen/Qwen3.8-27B-FP8).
Users obtain weights separately and must follow their license.

Hero and game illustration were generated for this repository using the
built-in image generation tool. [Prompts and provenance](docs/art-direction.md).
The benchmark graphic is generated directly from recorded measurements.
