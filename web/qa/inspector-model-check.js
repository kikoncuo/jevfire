// Requires real WebGPU; loads the cached model through the normal UI.
async function inspectorModelCheck(page) {
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#load').click();
  await page.waitForFunction(() => window.jevfireDiagnostics().loaded, null, {
    timeout: 90000,
  });
  await page.locator('#reset').click();
  await page.locator('#speed').selectOption('1');
  await page.locator('[data-unit="mira"]').click();
  await page.locator('#run').click();
  await page.waitForFunction(
    () => {
      const d = window.jevfireDiagnostics();
      return d.selectedDecision && d.metrics.total_decisions >= 3;
    },
    null,
    { timeout: 45000 },
  );
  await page.locator('#run').click();
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    characters: [],
    configuration: await page.evaluate(() => ({
      mission: document.querySelector('#mission').value,
      policies: window.jevfireDiagnostics().policies,
      inference_pace: document.querySelector('#inference-pace').value,
      simulation_speed: document.querySelector('#speed').value,
    })),
  };
  for (const id of ['mira', 'bram']) {
    await page.locator(`[data-unit="${id}"]`).click();
    const d = await page.evaluate(() => window.jevfireDiagnostics());
    const shown = await page.locator('#selected-thought').textContent();
    check(
      await page.locator('#model-decision').isVisible(),
      `${id} has no visible AI decision`,
    );
    check(
      d.selectedDecision.unitId === id &&
        d.selectedDecision.observedContext.self.id === id,
      'Inspector mixed character decisions or observations',
    );
    check(
      d.selectedHistory[0].source === 'model',
      'Real model choice missing its source',
    );
    check(
      (await page.locator('#selected-source').textContent()) === 'Qwen',
      'Current job is attributed to the wrong controller',
    );
    check(
      (await page.locator('#selected-scores .chosen span').textContent()) ===
        shown,
      'Score highlight does not match the applied choice',
    );
    check(
      (await page.locator('#selected-scores .score-row').count()) ===
        d.selectedDecision.fields[id].options.length,
      'Scores include unscored actions',
    );
    check(
      (await page.locator('#selected-decision-time').textContent()).includes(
        'ago',
      ),
      'Missing decision time',
    );
    report.characters.push({
      id,
      shown,
      decision: d.selectedDecision,
      history: d.selectedHistory,
    });
  }
  await page.locator('[data-unit="nell"]').click();
  check(
    await page.locator('#model-decision').isHidden(),
    'Another character’s AI scores leaked to Nell',
  );
  check(
    (await page.locator('#selected-source').textContent()) === 'Game rule',
    'Forced construction has no correct source',
  );
  check(
    (await page.locator('#selected-action').textContent()) === 'Build defenses',
    'Forced job is invisible',
  );
  report.rule_only_inspector_passed = true;
  await page.locator('[data-unit="mira"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'last-hearth-qa-inspector-model.png' });
  report.gpu = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return {
      vendor: a.info.vendor,
      architecture: a.info.architecture,
      user_agent: navigator.userAgent,
    };
  });
  await page.evaluate((r) => (window.jevfireInspectorModelReport = r), report);
  return report;
}
