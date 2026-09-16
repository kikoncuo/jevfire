async function drivingSdkUi(page) {
  const read = () => page.evaluate(() => window.slipstreamDiagnostics());
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const ids = ['nova', 'atlas', 'juno', 'milo'];
  await page.waitForFunction(
    () =>
      ['nova', 'atlas', 'juno', 'milo'].every(
        (id) => window.slipstreamDiagnostics().decisions[id]?.cache?.cache_hit,
      ),
    null,
    { timeout: 45000 },
  );
  const state = await read();
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    decisions: Object.fromEntries(
      ids.map((id) => {
        const d = state.decisions[id];
        check(
          d.cache.processed_tokens < d.prompt_tokens,
          'No token saving for ' + id,
        );
        check(
          d.fields[id].options.includes(d.parsed_json[id]),
          'Invalid action for ' + id,
        );
        return [
          id,
          {
            cache: d.cache,
            action: d.parsed_json[id],
            options: d.fields[id].options,
            policy: d.policy,
          },
        ];
      }),
    ),
    metrics: state.metrics,
    frames: state.frames,
  };
  if (state.running) await page.locator('#run').click();
  await page.waitForFunction(() => !window.slipstreamDiagnostics().busy, null, {
    timeout: 20000,
  });
  await page.locator('#reset').click();
  await page.locator('[data-driver="nova"]').click();
  const original = state.policies.nova;
  const edited = original + ' Preserve enough grip to finish the race.';
  try {
    await page.locator('#driver-prompt').fill(edited);
    await page.locator('#apply-prompt').click();
    await page.locator('#run').click();
    await page.waitForFunction(
      (policy) =>
        window.slipstreamDiagnostics().decisions.nova?.policy === policy,
      edited,
      { timeout: 45000 },
    );
    const first = (await read()).decisions.nova;
    check(!first.cache.cache_hit, 'Edited policy reused stale cache');
    report.edited_policy_first_cache_hit = first.cache.cache_hit;
    await page.waitForFunction(
      (policy) => {
        const d = window.slipstreamDiagnostics().decisions.nova;
        return d?.policy === policy && d.cache.cache_hit;
      },
      edited,
      { timeout: 45000 },
    );
    const later = await read();
    check(
      ids.slice(1).every((id) => later.policies[id] === state.policies[id]),
      'Editing one driver changed another',
    );
    report.edited_policy_later_cache_hit = later.decisions.nova.cache.cache_hit;
    report.other_policies_unchanged = true;
    report.passed = true;
  } finally {
    if ((await read()).running) await page.locator('#run').click();
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 20000 },
    );
    await page.locator('#driver-prompt').fill(original);
    await page.locator('#apply-prompt').click();
  }
  await page.screenshot({ path: 'driving-sdk-verified.png' });
  await page.evaluate((report) => {
    window.drivingSdkReport = report;
  }, report);
  return report;
}
