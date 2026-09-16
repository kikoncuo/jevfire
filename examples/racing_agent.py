"""Run a toy racing decision loop through the real JEVfire endpoint.

This simulation uses symbolic track state, not screenshots or real vehicles.
There is no fixed frame-rate claim; each tick waits for its decision.
"""

import argparse
import json
import time
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict


class Action(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    maneuver: Literal["brake", "coast", "accelerate"]
    lane: Literal["left", "hold", "right"]
    boost: bool


def guard_action(action: Action, *, bend: bool, blocked: bool, charge: int) -> Action:
    """Resolve conflicting independent actions with deterministic game rules."""
    result = action.model_copy()
    if bend or blocked:
        result.maneuver = "brake"
    if blocked:
        result.lane = "hold"
    if result.maneuver != "accelerate" or charge <= 0:
        result.boost = False
    return result


def make_request(*, bend: bool, blocked: bool, speed: int, charge: int) -> dict:
    state = {
        "tight_bend": bend,
        "lane_blocked": blocked,
        "speed": speed,
        "boost_charge": charge,
    }
    return {
        "context": "Toy racing game state: " + json.dumps(state),
        "schema": {
            "maneuver": {
                "type": "enum",
                "description": "Brake when tight_bend or lane_blocked is true; otherwise accelerate below speed 100, else coast.",
                "choices": ["brake", "coast", "accelerate"],
            },
            "lane": {
                "type": "enum",
                "description": "Hold the current lane unless another lane is explicitly reported clear.",
                "choices": ["left", "hold", "right"],
            },
            "boost": {
                "type": "boolean",
                "description": "Use boost only when boost_charge is positive, speed below 100, tight_bend false and lane_blocked false.",
            },
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8010")
    parser.add_argument("--steps", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.steps <= 1000:
        parser.error("--steps must be between 1 and 1000")
    speed, charge, distance = 60, 3, 0
    with httpx.Client(base_url=args.endpoint, timeout=120, trust_env=False) as client:
        for tick in range(args.steps):
            bend, blocked = tick % 4 == 2, tick % 7 == 5
            start = time.perf_counter()
            response = client.post(
                "/v1/decisions",
                json=make_request(
                    bend=bend, blocked=blocked, speed=speed, charge=charge
                ),
            )
            response.raise_for_status()
            result = response.json()
            if result["abstained_fields"]:
                raise RuntimeError("Decision abstained; simulation stopped")
            proposed = Action.model_validate(result["parsed_json"])
            action = guard_action(proposed, bend=bend, blocked=blocked, charge=charge)
            latency = 1000 * (time.perf_counter() - start)
            speed = max(
                0,
                min(
                    140,
                    speed
                    + {"brake": -25, "coast": -5, "accelerate": 15}[action.maneuver],
                ),
            )
            if action.boost:
                speed = min(140, speed + 20)
                charge -= 1
            distance += speed
            print(
                json.dumps(
                    {
                        "tick": tick,
                        "decision_ms": round(latency, 1),
                        "proposed": proposed.model_dump(),
                        "applied": action.model_dump(),
                        "speed": speed,
                        "distance_units": distance,
                        "boost_charge": charge,
                    }
                )
            )


if __name__ == "__main__":
    main()
