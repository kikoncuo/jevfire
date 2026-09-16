// On the local dev server, load Qwen and pause. This evaluates real WebLLM logits.
// playwright-cli -s=cowork run-code --filename=qa/policy-check.js
async function checkPolicies(page) {
  return await page.evaluate(async () => {
    const fixtures = await fetch('./qa/policy-fixtures.json').then((r) =>
      r.json(),
    );
    const initial = {
      collector:
        'Keep yourself and the village alive. Forage safely while food is needed. Use bold foraging only when food is critically low and the routes are not dangerous. Relax to walk home and eat before starvation, especially when weak or threatened. If you already carry food, either forage action returns it home. Relaxing also deposits food. Never remain relaxed with full hunger while the village runs out of food.',
      fighter:
        'Protect the villagers so the settlement survives. Defend when an orc is attacking or approaching an ally or a building; this draws nearby orcs onto you. Train when no one is threatened to raise your damage for later waves. Relax before starvation or to heal if badly injured. Defend again when recovered. Do not train while villagers are being attacked.',
      builder:
        'Keep the settlement alive. Repair damaged buildings, giving the hall and occupied defenses priority. Build towers when buildings are healthy; towers shoot orcs automatically. Relax before starvation or to heal if injured. Avoid working next to an orc that is attacking you. A destroyed hall cannot provide food or healing.',
    };
    const tuned = {
      collector:
        'Apply these priorities in order. If attacked_by > 0 or health < 35, relax at home. If hunger < 45 and village food > 0, relax to eat. If hunger < 20, relax unless the pantry is empty and you carry no food. If village food >= 18 and hunger < 75, relax. Otherwise collect food: choose forage_bold when village food <= 2 and every visible food route has low risk; choose forage_safe in all other cases. A full basket automatically returns home. Hunger 0 kills you.',
      fighter:
        'Apply these priorities in order. If hunger < 40 or health < 40, relax to eat and heal at home. Otherwise, if any villager or building is threatened, defend immediately. Also defend if an orc is within distance 12. Defending taunts orcs away from others. If there is no threat, train to increase your strength. Hunger 0 kills you. Do not train during an attack.',
      builder:
        'Apply these priorities in order. If hunger < 40 or health < 30 or attacked_by > 0, relax at home to eat and heal. Otherwise, if the repairs list contains any damaged building, repair. If there are no repairs and defense_sites_left > 0, build. If no construction or repair work remains, relax. Hunger 0 kills you. Never build a new tower while the hall needs urgent repair.',
    };
    const report = {
      tested_at: new Date().toISOString(),
      model: 'Qwen3.5-0.8B-q4f16_1-MLC',
      runtime: 'WebLLM 0.2.85',
      kind: 'hand-authored scenario checks; not a survival benchmark',
      variants: [],
    };
    for (const [name, policies] of [
      ['initial', initial],
      ['prioritized', tuned],
    ]) {
      const rows = [];
      for (const fixture of fixtures) {
        const result = await window.jevfireTestDecision({
          ...fixture,
          rolePrompt: policies[fixture.context.self.role],
        });
        const choice = result.parsed_json[fixture.unitId];
        rows.push({
          name: fixture.name,
          expected: fixture.expected,
          choice,
          pass: fixture.expected.includes(choice),
          elapsed_ms: result.elapsed_ms,
          prompt_tokens: result.prompt_tokens,
          logits: result.fields[fixture.unitId].logits,
        });
      }
      report.variants.push({
        name,
        policies,
        passed: rows.filter((row) => row.pass).length,
        total: rows.length,
        rows,
      });
    }
    window.jevfirePolicyReport = report;
    return report.variants.map(({ name, passed, total, rows }) => ({
      name,
      passed,
      total,
      failures: rows.filter((row) => !row.pass),
    }));
  });
}
