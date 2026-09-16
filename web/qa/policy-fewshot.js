// Real-model diagnostic, paused only. Handcrafted examples are prompt text, not overrides.
async function checkFewShot(page) {
  return await page.evaluate(async () => {
    const fixtures = await fetch('./qa/policy-fixtures.json').then((r) =>
      r.json(),
    );
    const additions = {
      collector:
        '\nExamples from OTHER scenes, not the current scene:\nFood meter 2/100, pantry 5 meals, no attack: C\nFood meter 90/100, pantry 0 meals, all routes low risk: B\nFood meter 90/100, pantry 9 meals, some route risk: A\nApply these survival priorities to the current observations.',
      fighter:
        '\nExamples from OTHER scenes, not the current scene:\nFood meter 2/100, pantry 5 meals, no attack: C\nHealthy, well fed, orc attacking a collector: B\nHealthy, well fed, no orcs observed: A\nApply these survival priorities to the current observations.',
      builder:
        '\nExamples from OTHER scenes, not the current scene:\nFood meter 2/100, pantry 5 meals, no attack: C\nHealthy, well fed, no damaged buildings, four unfinished towers: B\nHealthy, well fed, hall damaged: A\nApply these survival priorities to the current observations.',
    };
    const initial = window.jevfireDiagnostics().policies;
    const report = {
      tested_at: new Date().toISOString(),
      kind: 'Real-model diagnostic of handcrafted scenes; not a benchmark',
      variants: [],
    };
    for (const name of ['current', 'examples']) {
      const rows = [];
      for (const fixture of fixtures) {
        const role = fixture.context.self.role;
        const result = await window.jevfireTestDecision({
          ...fixture,
          rolePrompt:
            initial[role] + (name === 'examples' ? additions[role] : ''),
        });
        const choice = result.parsed_json[fixture.unitId];
        rows.push({
          name: fixture.name,
          choice,
          expected: fixture.expected,
          pass: fixture.expected.includes(choice),
          elapsed_ms: result.elapsed_ms,
          prompt_tokens: result.prompt_tokens,
          logits: result.fields[fixture.unitId].logits,
          diagnostic: result.diagnostic,
        });
      }
      report.variants.push({
        name,
        passed: rows.filter((r) => r.pass).length,
        total: rows.length,
        rows,
      });
    }
    window.jevfireFewShotReport = report;
    return report.variants.map((v) => ({
      ...v,
      rows: v.rows.map((r) => ({
        ...r,
        diagnostic: {
          ranks: r.diagnostic.ranks,
          sampled_text: r.diagnostic.sampled_text,
          top: r.diagnostic.top.slice(0, 3),
        },
      })),
    }));
  });
}
