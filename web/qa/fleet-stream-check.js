async function fleetStreamCheck(page) {
  await page.locator('#load').click();
  await page.waitForFunction(
    () => window.slipstreamDiagnostics().loaded,
    null,
    { timeout: 120000 },
  );
  await page.locator('#reset').click();
  await page.locator('#run').click();
  await page.waitForFunction(
    () => window.slipstreamDiagnostics().metrics.total_decisions > 0,
  );
  const first = await page.evaluate(() => window.slipstreamDiagnostics());
  if (!first.busy || first.batches.length || first.metrics.total_decisions >= 4)
    throw new Error('First car did not act before the fleet finished');
  await page.locator('#run').click();
  const paused = await page.evaluate(() => window.slipstreamDiagnostics());
  await page.waitForFunction(() => !window.slipstreamDiagnostics().busy);
  const settled = await page.evaluate(() => window.slipstreamDiagnostics());
  if (settled.metrics.total_decisions !== paused.metrics.total_decisions)
    throw new Error('Paused response applied a control');
  if (settled.metrics.discarded_decisions < 1)
    throw new Error('Discarded stream responses were not counted');
  if (settled.metrics.completed_decisions !== 4)
    throw new Error('Fleet counted a field twice or missed a field');
  if (settled.metrics.decisions_per_second !== 0)
    throw new Error('Paused throughput is nonzero');
  await page.screenshot({ path: 'last-hearth-qa-fleet-stream-pause.png' });
  const report = {
    first: {
      busy: first.busy,
      completed: first.metrics.total_decisions,
      batches: first.batches.length,
    },
    paused: paused.metrics,
    settled: settled.metrics,
  };
  await page.locator('#reset').click();
  const reset = await page.evaluate(() => window.slipstreamDiagnostics());
  if (reset.metrics.completed_decisions || reset.metrics.total_decisions)
    throw new Error('Reset retained old inference counters');
  await page.evaluate((r) => (window.fleetStreamReport = r), report);
  return report;
}
