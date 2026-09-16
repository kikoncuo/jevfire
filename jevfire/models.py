"""Validate the restricted classification contract before calling the GPU."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DecisionField(BaseModel):
    """Describe one independent boolean or categorical decision."""

    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["boolean", "enum"]
    description: str = Field(min_length=1, max_length=4000)
    choices: list[str] | None = Field(default=None, min_length=2, max_length=255)

    @model_validator(mode="after")
    def validate_choices(self):
        if self.type == "boolean" and self.choices is not None:
            raise ValueError("Boolean fields must not supply choices")
        if self.type == "enum":
            if self.choices is None:
                raise ValueError("Enum fields require choices")
            if len(set(self.choices)) != len(self.choices):
                raise ValueError("Choices must be unique")
            if any(not c.strip() or len(c) > 1000 for c in self.choices):
                raise ValueError("Choices must be nonblank and at most 1000 characters")
        return self

    @property
    def values(self) -> list[str | bool]:
        return [True, False] if self.type == "boolean" else list(self.choices or [])


class DecisionRequest(BaseModel):
    """Accept a bounded flat schema, with optional explicit abstention."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "context": "The racing game reports a tight bend ahead and low grip.",
                "schema": {
                    "maneuver": {
                        "type": "enum",
                        "description": "Choose a driving maneuver for this simulated racing game.",
                        "choices": ["brake", "coast", "accelerate"],
                    }
                },
                "strategy": "auto",
            }
        },
    )
    context: str = Field(min_length=1, max_length=100000)
    fields: dict[str, DecisionField] = Field(
        alias="schema", min_length=1, max_length=64
    )
    strategy: Literal["auto", "prefill_then_batch", "batch", "aligned_prefill"] = "auto"
    score_temperature: float = Field(default=1.0, ge=0.05, le=10)
    min_probability: float | None = Field(default=None, ge=0, le=1)
    cache_salt: str | None = Field(default=None, min_length=1, max_length=256)

    @field_validator("fields")
    @classmethod
    def validate_names(cls, fields):
        for name in fields:
            if not name.strip() or len(name) > 128 or any(ord(c) < 32 for c in name):
                raise ValueError(
                    "Field names must be nonblank, <=128 chars, without controls"
                )
        return fields

    @field_validator("score_temperature", "min_probability")
    @classmethod
    def finite_numbers(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("Scores must use finite numbers")
        return value
