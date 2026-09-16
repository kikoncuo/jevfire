"""Exercise actual chat-template rendering in the standalone CPU install."""

from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from transformers import PreTrainedTokenizerFast

from jevfire.core import Label, build_prompts
from jevfire.models import DecisionRequest


def test_real_chat_template_renders_without_torch_or_model_download():
    backend = Tokenizer(
        WordLevel({"[UNK]": 0, "A": 1, "B": 2, "direct": 3}, unk_token="[UNK]")
    )
    backend.pre_tokenizer = Whitespace()
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=backend, unk_token="[UNK]")
    tokenizer.chat_template = (
        "{% for message in messages %}{{ message['role'] }}: {{ message['content'] }}\n{% endfor %}"
        "{{ 'thinking' if enable_thinking else 'direct' }}"
    )
    request = DecisionRequest.model_validate(
        {
            "context": "The path is clear.",
            "schema": {
                "clear": {"type": "boolean", "description": "Is the path clear?"}
            },
        }
    )
    prompts = build_prompts(request, tokenizer, [Label("A", 1), Label("B", 2)])
    assert len(prompts) == 1
    assert tokenizer.decode(prompts[0]).endswith("direct")
