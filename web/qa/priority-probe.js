async function priorityProbe(page) {
  await page.bringToFront();
  await page.waitForFunction(
    () =>
      !window.jevfireDiagnostics().busy && !window.jevfireDiagnostics().running,
    null,
    { timeout: 45000 },
  );
  await page.locator('#reset').click();
  const report = {
    tested_at: new Date().toISOString(),
    policies: await page.evaluate(() => window.jevfireDiagnostics().policies),
    results: [],
  };
  const policies = {
    aldric:
      'Choose defend if any villager or building is under attack. Otherwise train. Relax only if your health is below half of maximum. Meals happen automatically.',
    sable:
      'You love training. Choose train whenever no villager or building is threatened. Choose defend during an attack. Relax only when badly wounded. Meals happen automatically.',
    tomas:
      'Work priorities: repair the damaged hall; otherwise heal critically wounded allies; otherwise build unfinished towers. Relax only when badly wounded or no useful work remains. Meals happen automatically.',
    nell: 'Choose heal if wounded allies and food exist; otherwise repair damaged buildings; otherwise build unfinished towers. Relax only when badly wounded or all work is done. Meals happen automatically.',
  };
  for (const [unitId, policy] of Object.entries(policies)) {
    await page.locator(`[data-unit="${unitId}"]`).click();
    for (const variant of ['default', 'explicit']) {
      report.results.push(
        await page.evaluate(
          async ({ unitId, policy, variant }) => {
            const context = window.jevfireDiagnostics().selectedContext;
            const r = await window.jevfireTestDecision({
              unitId,
              context,
              pace: 'fast',
              ...(variant === 'explicit' ? { rolePrompt: policy } : {}),
            });
            return {
              unitId,
              variant,
              context,
              policy: variant === 'explicit' ? policy : null,
              result: r.parsed_json,
              scores: r.fields,
              elapsed_ms: r.elapsed_ms,
            };
          },
          { unitId, policy, variant },
        ),
      );
    }
  }
  await page.screenshot({ path: 'last-hearth-qa-priority.png' });
  await page.evaluate((r) => (window.jevfirePriorityProbe = r), report);
  return report;
}
