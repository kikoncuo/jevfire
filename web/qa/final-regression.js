// Final production-build smoke check. Normal UI controls and a real Qwen run.
async function finalRegression(page) {
  const report = { tested_at: new Date().toISOString(), errors: [] };
  page.on('pageerror', (error) => report.errors.push(error.message));
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const base = page.url().replace(/[^/]*$/, '');
  await page.goto(`${base}mario.html`);
  await page.waitForFunction(() => !!window.marioDiagnostics);
  await page.locator('#manual').click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(450);
  await page.keyboard.up('ArrowRight');
  await page.locator('#run').click();
  const paused = await page.evaluate(() => window.marioDiagnostics());
  check(!paused.running && paused.player.x > 3, 'Manual movement/pause failed');
  await page.locator('#run').click();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await page.waitForTimeout(300);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await page.locator('#run').click();
  report.mario = await page.evaluate(() => window.marioDiagnostics());
  check(
    report.mario.player.x > paused.player.x,
    'Manual resume lost keyboard focus',
  );
  check(report.mario.player.y > paused.player.y, 'Manual jump failed');
  check(
    report.mario.metrics.total_decisions === 0,
    'Manual mode counted AI decisions',
  );
  await page.screenshot({ path: 'last-hearth-qa-final-mario.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  report.mario.mobile = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  check(
    report.mario.mobile.content <= report.mario.mobile.viewport,
    'Mario mobile overflow',
  );
  await page.screenshot({ path: 'last-hearth-qa-final-mario-mobile.png' });
  await page.goto(base);
  await page.waitForFunction(
    () => window.jevfireDiagnostics?.().rendererReady,
    null,
    { timeout: 30000 },
  );
  report.village_mobile = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
    mario_link: !!document.querySelector('a[href="./mario.html"]'),
  }));
  check(
    report.village_mobile.content <= report.village_mobile.viewport,
    'Village mobile overflow',
  );
  await page.screenshot({ path: 'last-hearth-qa-final-village-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#load').click();
  await page.waitForFunction(() => window.jevfireDiagnostics().loaded, null, {
    timeout: 120000,
  });
  await page.locator('#run').click();
  await page.waitForFunction(
    () => window.jevfireDiagnostics().metrics.total_decisions >= 6,
    null,
    { timeout: 60000 },
  );
  await page.locator('#run').click();
  await page.waitForFunction(() => !window.jevfireDiagnostics().busy, null, {
    timeout: 30000,
  });
  report.village = await page.evaluate(() => window.jevfireDiagnostics());
  check(
    report.village.mode === 'model' &&
      report.village.metrics.total_decisions >= 6,
    'Village real model regression',
  );
  await page.screenshot({ path: 'last-hearth-qa-final-village.png' });
  check(report.errors.length === 0, report.errors.join('; '));
  await page.evaluate((value) => {
    window.finalRegressionReport = value;
  }, report);
  return report;
}
