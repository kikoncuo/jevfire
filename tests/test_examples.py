"""Game rules must override conflicting independently scored decisions."""

import pytest
from pydantic import ValidationError

from examples.racing_agent import Action, guard_action, make_request
from jevfire.models import DecisionRequest


@pytest.mark.parametrize(
    "bend,blocked,charge", [(True, False, 3), (False, True, 3), (False, False, 0)]
)
def test_boost_is_prevented_when_game_rules_disallow_it(bend, blocked, charge):
    proposed = Action(maneuver="accelerate", lane="left", boost=True)
    applied = guard_action(proposed, bend=bend, blocked=blocked, charge=charge)
    assert applied.boost is False
    assert proposed.boost is True
    if bend or blocked:
        assert applied.maneuver == "brake"
    if blocked:
        assert applied.lane == "hold"


def test_abstention_is_not_executable_action():
    with pytest.raises(ValidationError):
        Action(maneuver=None, lane="hold", boost=False)


def test_game_request_obeys_api_contract():
    request = DecisionRequest.model_validate(
        make_request(bend=True, blocked=False, speed=60, charge=3)
    )
    assert len(request.fields) == 3
