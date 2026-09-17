async function marioFastUI(page) {
  const report = { tested_at: new Date().toISOString(), errors: [] };
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => window.marioDiagnostics?.().loaded, null, {
    timeout: 120000,
  });
  // No-options probe after a finished run must reject rather than locking UI.
  const over = await page.evaluate(() => window.marioDiagnostics().over);
  if (over) {
    report.terminal_probe = await page.evaluate(async () => {
      try {
        await window.marioProbe();
        return { rejected: false };
      } catch (error) {
        return { rejected: true, message: error.message };
      }
    });
    if (!report.terminal_probe.rejected)
      throw new Error('Terminal probe did not reject');
  }
  await page.locator('#reset').click();
  await page.locator('#run').click();
  await page.waitForFunction(() => window.marioDiagnostics().busy);
  const before = await page.evaluate(() => window.marioDiagnostics());
  await page.locator('#run').click();
  await page.waitForFunction(() => !window.marioDiagnostics().busy);
  const paused = await page.evaluate(() => window.marioDiagnostics());
  if (paused.metrics.total_decisions !== before.metrics.total_decisions)
    throw new Error('Paused answer applied');
  const time = paused.time;
  await page.waitForTimeout(150);
  if ((await page.evaluate(() => window.marioDiagnostics().time)) !== time)
    throw new Error('Pause advanced physics');
  report.pause = {
    before: before.metrics.total_decisions,
    after: paused.metrics.total_decisions,
  };
  await page.locator('#reset').click();
  const reset = await page.evaluate(() => window.marioDiagnostics());
  if (
    reset.metrics.total_decisions !== 0 ||
    reset.executor.acceptedSelections !== 0
  )
    throw new Error('Reset counters retained');
  await page.setViewportSize({ width: 390, height: 844 });
  report.mobile = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  if (report.mobile.content > report.mobile.viewport)
    throw new Error('Mobile overflow');
  await page.screenshot({ path: 'last-hearth-qa-fast-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#manual').click();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await page.locator('#run').click();
  report.manual = await page.evaluate(() => window.marioDiagnostics());
  if (
    report.manual.player.x <= 3 ||
    report.manual.player.y <= 1 ||
    report.manual.metrics.total_decisions !== 0
  )
    throw new Error('Manual control regression');
  await page.locator('#control-mode').selectOption('raw');
  if (await page.locator('#timing').isDisabled())
    throw new Error('Raw timing control disabled');
  await page.locator('#timing').selectOption('step');
  await page.locator('#load').click();
  report.raw_probe = await page.evaluate(() =>
    window.marioProbe({ controller: 'raw' }),
  );
  if (report.raw_probe.fields_scored !== 3)
    throw new Error('Raw mode no longer scores three controls');
  await page.locator('#control-mode').selectOption('maneuvers');
  if (
    (await page.locator('#timing').inputValue()) !== 'live' ||
    !(await page.locator('#timing').isDisabled())
  )
    throw new Error('Fast mode can pause for inference');
  await page.screenshot({ path: 'last-hearth-qa-fast-controls.png' });
  if (report.errors.length) throw new Error(report.errors.join(';'));
  return report;
}
