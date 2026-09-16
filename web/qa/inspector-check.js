// Actual browser clicks and live game progression; no simulation/model mocks.
async function inspectorCheck(page) {
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => window.jevfireDiagnostics()?.rendererReady);
  const initial = await page.evaluate(() => window.jevfireDiagnostics());
  if (initial.running) await page.locator('#run').click();
  await page.locator('#reset').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    hits: [],
  };
  for (const kind of ['body', 'nameplate']) {
    for (const id of ['mira', 'bram', 'aldric', 'sable', 'tomas', 'nell']) {
      const point = await page.evaluate(
        ({ id, kind }) =>
          window
            .jevfireDiagnostics({ selectionTargets: true })
            .selectionTargets.find((t) => t.id === id)[kind],
        { id, kind },
      );
      await page.evaluate((x) => (window.jevfireClickAttempt = x), {
        id,
        kind,
        point,
      });
      // A body behind the hall cannot be clicked through the building. Every
      // character must still be selectable by its unobstructed nameplate.
      if (kind === 'body' && point.visible === false) {
        report.hits.push({ id, kind, occluded: true });
        continue;
      }
      // Give the pointer a real hover interval: a label must not dodge it.
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(150);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        (id) => window.jevfireDiagnostics().selectedId === id,
        id,
        { timeout: 2500 },
      );
      check(
        (await page.locator('#selected-name').textContent()).toLowerCase() ===
          id,
        `${kind} click did not update ${id}'s inspector`,
      );
      check(
        (await page.locator('#selected-level').textContent()) === 'LV 1',
        'Initial level absent',
      );
      report.hits.push({ id, kind, passed: true });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    }
  }
  check(
    report.hits.some((hit) => hit.kind === 'body' && hit.passed),
    'No exposed character body was selectable',
  );
  const point = await page.evaluate(
    () =>
      window
        .jevfireDiagnostics({ selectionTargets: true })
        .selectionTargets.find((t) => t.id === 'mira').body,
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 30, point.y, { steps: 4 });
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.mouse.up();
  check(
    (await page.evaluate(() => window.jevfireDiagnostics().selectedId)) ===
      'nell',
    'Orbit drag selected a character',
  );
  report.orbit_drag_does_not_select = true;
  await page.locator('#reset-camera').click();
  await page.locator('#preview').click();
  await page.locator('#speed').selectOption('2');
  await page.locator('#run').click();
  await page.waitForFunction(
    () =>
      window
        .jevfireDiagnostics()
        .units.some((u) => u.role === 'fighter' && u.experience >= 100),
    null,
    { timeout: 50000 },
  );
  await page.locator('#run').click();
  await page.locator('[data-unit="aldric"]').click();
  const d = await page.evaluate(() => window.jevfireDiagnostics());
  check(
    (await page.locator('#selected-level').textContent()) !== 'LV 1',
    'Earned levels not displayed',
  );
  check(
    d.selectedHistory.some((e) => e.source === 'scripted'),
    'Scripted decisions absent from inspector',
  );
  check(
    await page.locator('#model-decision').isHidden(),
    'Scripted history presented as AI scores',
  );
  check(
    d.metrics.total_decisions === 0,
    'Inspection or scripted progression created AI ticks',
  );
  report.progression = d.units.map(({ id, experience, activity }) => ({
    id,
    experience,
    activity,
  }));
  report.scripted_history = d.selectedHistory;
  await page.screenshot({ path: 'last-hearth-qa-inspector-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-unit="nell"]').click();
  check(
    await page.locator('#inspect').isVisible(),
    'Mobile selection did not open details',
  );
  const rect = await page.locator('#inspect').boundingBox();
  check(
    rect.y >= 0 && rect.y + rect.height <= 845,
    'Mobile inspector is outside viewport',
  );
  check(
    (await page.locator('#selected-name').textContent()) === 'Nell',
    'Mobile inspector selected wrong character',
  );
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Mobile overflow',
  );
  await page.screenshot({ path: 'last-hearth-qa-inspector-mobile.png' });
  await page.locator('#close-inspector').click();
  check(
    await page.locator('#inspect').isHidden(),
    'Mobile inspector did not close',
  );
  report.mobile_panel_passed = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#reset').click();
  check(
    (await page.locator('#selected-level').textContent()) === 'LV 1',
    'Reset kept previous XP',
  );
  check(
    (await page.locator('#selected-history').textContent()).includes(
      'No decisions yet',
    ),
    'Reset kept previous history',
  );
  report.reset_clears_levels_and_history = true;
  await page.evaluate((r) => (window.jevfireInspectorReport = r), report);
  return report;
}
