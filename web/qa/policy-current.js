// Real model, paused. The first set guided tuning; the second was held out until final checks.
async function checkCurrent(page) {
  return await page.evaluate(async () => {
    const report = {
      tested_at: new Date().toISOString(),
      model: 'Qwen3.5-0.8B-q4f16_1-MLC',
      runtime: 'WebLLM 0.2.85',
      policies: window.jevfireDiagnostics().policies,
      sets: [],
    };
    for (const file of [
      'policy-fixtures.json',
      'policy-heldout-fixtures.json',
    ]) {
      const fixtures = await fetch('./qa/' + file).then((r) => r.json());
      const rows = [];
      for (const fixture of fixtures) {
        const result = await window.jevfireTestDecision(fixture);
        const choice = result.parsed_json[fixture.unitId];
        rows.push({
          name: fixture.name,
          expected: fixture.expected,
          choice,
          pass: fixture.expected.includes(choice),
          elapsed_ms: result.elapsed_ms,
          prompt_tokens: result.prompt_tokens,
          logits: result.fields[fixture.unitId].logits,
          diagnostic: result.diagnostic,
        });
      }
      report.sets.push({
        file,
        passed: rows.filter((r) => r.pass).length,
        total: rows.length,
        rows,
      });
    }
    window.jevfirePolicyCurrent = report;
    return report.sets.map(({ file, passed, total, rows }) => ({
      file,
      passed,
      total,
      failures: rows.filter((r) => !r.pass),
    }));
  });
}
