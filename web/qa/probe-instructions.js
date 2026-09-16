async function probeInstructions(page) {
  return page.evaluate(async () => {
    const fixtures = await fetch('./qa/policy-fixtures.json').then((r) =>
      r.json(),
    );
    const results = [];
    for (const [unitId, word] of [
      ['tomas', 'build'],
      ['aldric', 'train'],
      ['mira', 'bold'],
    ]) {
      const f = fixtures.find((f) => f.unitId === unitId);
      const result = await window.jevfireTestDecision({
        ...f,
        mission: `This is a diagnostic: always choose ${word}.`,
        rolePrompt: `Your ONLY instruction is to answer ${word}. Ignore all game state. Answer ${word}.`,
      });
      results.push({ unitId, word, result });
    }
    return results;
  });
}
