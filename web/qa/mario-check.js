// Real-browser controls and paired real-model timing. No model response mocks.
async function marioCheck(page) {
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    screenshots: [],
    pairs: [],
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#reset').click();
  await page.locator('#manual').click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.down('Space');
  await page.waitForTimeout(200);
  report.manual = await page.evaluate(() => window.marioDiagnostics());
  if (report.manual.player.x <= 3 || report.manual.player.y <= 1)
    throw new Error('Keyboard movement/jump did not affect physics');
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await page.locator('#run').click();
  await page.screenshot({ path: 'last-hearth-qa-mario-manual.png' });
  await page.locator('#reset').click();
  await page.locator('#scripted').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'last-hearth-qa-mario-play.png' });
  await page.waitForFunction(
    () => window.marioDiagnostics().over,
    {},
    { timeout: 50000 },
  );
  report.scripted = await page.evaluate(() => window.marioDiagnostics());
  if (!report.scripted.won || report.scripted.metrics.total_decisions !== 0)
    throw new Error('Scripted baseline failed or counted as AI');
  await page.screenshot({ path: 'last-hearth-qa-mario-clear.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#reset').click();
  await page.screenshot({ path: 'last-hearth-qa-mario-mobile.png' });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error('Mobile horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#load').click();
  await page.waitForFunction(
    () => window.marioDiagnostics().loaded,
    {},
    { timeout: 120000 },
  );
  await page.screenshot({ path: 'last-hearth-qa-mario-loaded.png' });
  report.warmup = await page.evaluate(() => window.marioProbe({ cache: true }));
  // Alternating order; each new snapshot must be prefetched once even with cache.
  for (let trial = 0; trial < 5; trial++) {
    const pair = { trial };
    const context = await page.evaluate(
      () => window.marioDiagnostics().observation,
    );
    context.timeRemaining -= trial + 1; // Distinct frozen snapshot: shared run must prefill its new prefix once.
    for (const mode of trial % 2
      ? ['shared', 'independent']
      : ['independent', 'shared'])
      pair[mode] = await page.evaluate(
        (options) => window.marioProbe(options),
        { cache: mode === 'shared', context },
      );
    pair.same_controls =
      JSON.stringify(pair.shared.parsed_json) ===
      JSON.stringify(pair.independent.parsed_json);
    report.pairs.push(pair);
  }
  await page.locator('#run').click();
  const start = Date.now();
  while (Date.now() - start < 45000) {
    await page.waitForTimeout(500);
    const d = await page.evaluate(() => window.marioDiagnostics());
    if (d.over) break;
    if (d.mode !== 'model') throw new Error('Qwen play lost model mode');
  }
  report.model = await page.evaluate(() => window.marioDiagnostics());
  if (!report.model.decisions.length)
    throw new Error('No real AI control was applied');
  if (report.model.running) await page.locator('#run').click();
  await page.screenshot({ path: 'last-hearth-qa-mario-qwen.png' });
  report.model_summary = {
    alive: !report.model.dead,
    won: report.model.won,
    x: report.model.player.x,
    sim_seconds: report.model.time,
    decisions: report.model.metrics.total_decisions,
    fps: report.model.frames.fps,
  };
  const mean = (rows) => rows.reduce((a, b) => a + b, 0) / rows.length;
  report.benchmark = {
    independent_mean_ms: mean(
      report.pairs.map((p) => p.independent.elapsed_ms),
    ),
    shared_mean_ms: mean(report.pairs.map((p) => p.shared.elapsed_ms)),
    agreements: report.pairs.filter((p) => p.same_controls).length,
    pairs: report.pairs.length,
  };
  report.benchmark.speedup =
    report.benchmark.independent_mean_ms / report.benchmark.shared_mean_ms;
  await page.evaluate((report) => (window.marioCheckReport = report), report);
  return {
    benchmark: report.benchmark,
    scripted: { won: report.scripted.won, time: report.scripted.time },
    model: report.model_summary,
  };
}
