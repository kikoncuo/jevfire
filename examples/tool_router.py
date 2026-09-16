"""Choose a tool and compose a fixed nested command; does not execute tools."""

import argparse
import json
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict


class Route(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    tool: Literal["search_docs", "open_ticket", "none"]
    priority: Literal["normal", "urgent"]
    confirmation: bool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8010")
    parser.add_argument(
        "--context",
        default="Find the documentation for configuring prefix caching. No ticket is needed.",
    )
    args = parser.parse_args()
    request = {
        "context": args.context,
        "schema": {
            "tool": {
                "type": "enum",
                "description": "Choose the explicitly requested tool, or none.",
                "choices": ["search_docs", "open_ticket", "none"],
            },
            "priority": {
                "type": "enum",
                "description": "Urgent only if explicitly stated.",
                "choices": ["normal", "urgent"],
            },
            "confirmation": {
                "type": "boolean",
                "description": "Would the requested action create a ticket or change external state?",
            },
        },
    }
    with httpx.Client(base_url=args.endpoint, timeout=120, trust_env=False) as client:
        response = client.post("/v1/decisions", json=request)
        response.raise_for_status()
        result = response.json()
    if result["abstained_fields"]:
        raise RuntimeError("Routing abstained; no command created")
    route = Route.model_validate(result["parsed_json"])
    # Application policy overrides an independently predicted confirmation flag.
    command = {
        "routing": {"tool": route.tool, "priority": route.priority},
        "checks": [
            {
                "name": "confirmation",
                "required": route.confirmation or route.tool == "open_ticket",
            }
        ],
    }
    print(json.dumps(command, indent=2))


if __name__ == "__main__":
    main()
