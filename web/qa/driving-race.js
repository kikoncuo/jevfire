// One real-model race through normal controls; no simulated/model responses.
async function drivingRace(page) {
  await page.waitForFunction(() => window.slipstreamDiagnostics?.().loaded);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#seed').fill('7');
  await page.locator('#sim-speed').selectOption('1');
  await page.locator('#pace').selectOption('balanced');
  await page.locator('#reset').click();
  for (const id of ['nova', 'atlas', 'juno', 'milo']) {
    await page.locator(`[data-driver="${id}"]`).click();
    await page.locator('#restore-prompt').click();
  }
  await page.locator('[data-driver="nova"]').click();
  await page.evaluate(() => scrollTo(0, 0));
  const report = {
    tested_at: new Date().toISOString(),
    seed: 7,
    simulation_speed: 1,
    inference_pace: 'balanced',
    controller: 'real WebLLM',
    samples: [],
    decisions: [],
    events: [],
  };
  const seen = new Set(),
    eventSeen = new Set();
  const started = Date.now();
  await page.locator('#run').click();
  while (Date.now() - started < 230000) {
    await page.waitForTimeout(1000);
    const d = await page.evaluate(() => window.slipstreamDiagnostics());
    if (d.mode !== 'model') throw new Error('Race is not using real Qwen');
    if (!d.running && !d.summary.over)
      throw new Error(
        `Race stopped before completion: ${await page.locator('#error').textContent()}`,
      );
    report.samples.push({
      wall_seconds: (Date.now() - started) / 1000,
      time: d.time,
      metrics: d.metrics,
      frames: d.frames,
      summary: d.summary,
    });
    for (const decision of Object.values(d.decisions))
      if (!seen.has(decision.id)) {
        seen.add(decision.id);
        report.decisions.push(decision);
      }
    for (const event of d.events) {
      const key = JSON.stringify(event);
      if (!eventSeen.has(key)) {
        eventSeen.add(key);
        report.events.push(event);
      }
    }
    if (d.time >= 25 && !report.capture_at) {
      await page.screenshot({ path: 'last-hearth-qa-driving-live-race.png' });
      report.capture_at = d.time;
    }
    if (d.summary.over) {
      report.final = d;
      break;
    }
  }
  if (!report.final)
    throw new Error('Race did not terminate in the wall-time budget');
  report.wall_seconds = (Date.now() - started) / 1000;
  report.action_counts = Object.fromEntries(
    ['nova', 'atlas', 'juno', 'milo'].map((id) => [
      id,
      report.decisions
        .filter((d) => d.unitId === id)
        .reduce((r, d) => {
          const a = d.parsed_json[id];
          r[a] = (r[a] || 0) + 1;
          return r;
        }, {}),
    ]),
  );
  await page.screenshot({ path: 'last-hearth-qa-driving-finish.png' });
  await page.evaluate(
    (report) => (window.slipstreamRaceReport = report),
    report,
  );
  return {
    wall_seconds: report.wall_seconds,
    summary: report.final.summary,
    action_counts: report.action_counts,
    metrics: report.final.metrics,
    frames: report.final.frames,
  };
}
