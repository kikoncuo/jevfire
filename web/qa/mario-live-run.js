// Actual UI play. No injected controls, route or model substitutes.
async function marioLiveRun(page) {
  await page.waitForFunction(() => !!window.marioDiagnostics);
  if (!(await page.evaluate(() => window.marioDiagnostics().loaded))) {
    await page.locator('#load').click();
    await page.waitForFunction(() => window.marioDiagnostics().loaded, null, {
      timeout: 120000,
    });
  }
  if (await page.evaluate(() => window.marioDiagnostics().running))
    await page.locator('#run').click();
  await page.waitForFunction(() => !window.marioDiagnostics().busy, null, {
    timeout: 45000,
  });
  if ((await page.locator('#control-mode').inputValue()) !== 'maneuvers')
    await page.locator('#control-mode').selectOption('maneuvers');
  await page.locator('#restore').click();
  await page.locator('#reset').click();
  await page.locator('#run').click();
  await page.screenshot({ path: 'last-hearth-qa-fast-live-start.png' });
  const started = Date.now();
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    samples: [],
    decisions: [],
    errors: [],
  };
  const seen = new Set();
  page.on('pageerror', (error) => report.errors.push(error.message));
  let d;
  do {
    d = await page.evaluate(() => window.marioDiagnostics());
    report.samples.push({
      wall_s: (Date.now() - started) / 1000,
      time: d.time,
      x: d.player.x,
      y: d.player.y,
      running: d.running,
      busy: d.busy,
      metrics: d.metrics,
      inference: d.inference,
      executor: d.executor,
      frames: d.frames,
      planning: d.planning,
    });
    for (const result of d.decisions)
      if (!seen.has(result.id)) {
        seen.add(result.id);
        report.decisions.push(result);
      }
    if (d.over || !d.running) break;
    await page.waitForTimeout(200);
  } while (Date.now() - started < 120000);
  report.final = d;
  report.wall_seconds = (Date.now() - started) / 1000;
  report.complete = !!d.won;
  await page.screenshot({ path: 'last-hearth-qa-fast-live-result.png' });
  await page.evaluate((value) => {
    window.marioLiveRunReport = value;
  }, report);
  return report;
}
