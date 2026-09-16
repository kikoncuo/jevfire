# Try the action examples

Start the API, then run:

```bash
python examples/racing_agent.py --steps 8
python examples/tool_router.py
```

Both accept `--endpoint http://127.0.0.1:8010`. The router also accepts `--context`.
They call the real LLM, reject invalid/abstained outputs, and execute no external
tools. The racing example advances only a local toy state machine.

The racing loop prints proposed and applied actions separately. Independent
model decisions can conflict: in our eight-tick smoke check, the model proposed
accelerating into a tight bend once, and the deterministic guard replaced that
action with braking. This demonstrates why game rules remain authoritative;
the example is not a gameplay-quality or frame-rate benchmark.

For a real-time game integration, run inference asynchronously, retain the last
valid action while a request is in flight, and discard stale decisions using
your game's state/tick IDs. Rendering and physics should have their own clocks.
The included command-line simulation intentionally waits between decision ticks.

The tool router composes fixed nested objects and an array in Python after
scoring flat fields. It forces confirmation for ticket creation regardless of
the independently selected confirmation flag. Wire actual tools and permission
checks in your application.
