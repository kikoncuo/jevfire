// Starts one real-model game and records read-only samples until it ends.
// Run after explicitly loading the model. Keep this tab visible.
// Read window.jevfireSurvivalReport after its final property appears.
async function survivalRun(page) {
  const d = await page.evaluate(() => window.jevfireDiagnostics());
  if (!d.loaded) throw new Error('Load the real model first');
  await page.bringToFront();
  await page.locator('#load').click();
  await page.locator('#seed').fill('7341');
  await page.locator('#speed').selectOption('2');
  await page.locator('#reset').click();
  await page.waitForFunction(() => !window.jevfireDiagnostics().busy, null, {
    timeout: 40000,
  });
  await page.evaluate(() => {
    if (window.__jevfireSurvivalTimer)
      clearInterval(window.__jevfireSurvivalTimer);
    const start = performance.now();
    const report = (window.jevfireSurvivalReport = {
      tested_at: new Date().toISOString(),
      seed: 7341,
      simulation_speed: 2,
      scope:
        'One development run; asynchronous timing prevents exact seed-only reproduction',
      policies: window.jevfireDiagnostics().policies,
      samples: [],
    });
    window.__jevfireSurvivalTimer = setInterval(() => {
      const d = window.jevfireDiagnostics();
      report.samples.push({
        wall_seconds: (performance.now() - start) / 1000,
        summary: d.summary,
        metrics: d.metrics,
      });
      if (d.over) {
        report.final = d;
        report.wall_seconds = (performance.now() - start) / 1000;
        clearInterval(window.__jevfireSurvivalTimer);
      }
    }, 1000);
  });
  await page.locator('#run').click();
  return { started: true, seed: 7341, speed: 2 };
}
