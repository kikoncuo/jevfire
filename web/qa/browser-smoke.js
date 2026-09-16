// Run with playwright-cli -s=cowork run-code --filename=qa/browser-smoke.js
// Open the demo and explicitly load the real model before running this script.
async function browserSmoke(page) {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const state = () => page.evaluate(() => window.jevfireDiagnostics());
  const waitDecision = () =>
    page.waitForFunction(
      () => {
        const d = window.jevfireDiagnostics();
        return d.lastResult?.epoch === d.epoch;
      },
      null,
      { timeout: 45000 },
    );
  const valid = (result) => {
    check(
      Object.keys(result).sort().join(',') === 'echo,ember,moss',
      'Unexpected output fields',
    );
    check(
      Object.values(result).every((v) =>
        ['recover', 'return', 'evade', 'hold'].includes(v),
      ),
      'Unexpected action',
    );
  };
  check((await state()).loaded, 'Load the real WebLLM model first');
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    runtime: 'WebLLM 0.2.85',
    model: 'Qwen3.5-0.8B-q4f16_1-MLC',
  };
  await page.locator('#reset').click();
  await page.getByRole('button', { name: 'Recover', exact: true }).click();
  // Inference must continue even with networking disabled after model loading.
  await page.context().setOffline(true);
  try {
    await page.locator('#run').click();
    await waitDecision();
    report.recover = (await state()).lastResult;
    valid(report.recover.parsed_json);
    await page.waitForFunction(
      () => window.jevfireDiagnostics().cores > 0,
      null,
      { timeout: 45000 },
    );
    report.cores_recovered = (await state()).cores;
    report.offline_inference = true;
    await page.screenshot({ path: 'arena-qa-recovery.png' });
    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    await waitDecision();
    report.hold = (await state()).lastResult;
    valid(report.hold.parsed_json);
    report.hold_followed = Object.values(report.hold.parsed_json).every(
      (value) => value === 'hold',
    );
    await page.locator('#inject').click();
    await waitDecision();
    report.injection = (await state()).lastResult;
    valid(report.injection.parsed_json);
    await page.screenshot({ path: 'arena-qa-injection.png' });
    // Reset while a real request is in flight and wait for its completion.
    await page.waitForFunction(() => window.jevfireDiagnostics().busy);
    await page.locator('#reset').click();
    await page.waitForFunction(() => !window.jevfireDiagnostics().busy);
    const reset = await state();
    check(
      reset.ticks === 0 && reset.lastResult === null,
      'Stale result applied',
    );
    check(!reset.running, 'Reset did not pause the game');
    report.stale_result_discarded = true;
    await page.screenshot({ path: 'arena-qa-reset.png' });
  } finally {
    await page.context().setOffline(false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  report.mobile_no_overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  check(report.mobile_no_overflow, 'Mobile horizontal overflow');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'arena-qa-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: 'arena-qa-desktop.png', fullPage: true });
  report.gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      shader_f16: adapter.features.has('shader-f16'),
      user_agent: navigator.userAgent,
    };
  });
  await page.evaluate((value) => {
    window.jevfireSmokeReport = value;
  }, report);
  return report;
}
