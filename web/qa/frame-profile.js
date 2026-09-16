// Real renderer/model profiling. Open the page and explicitly load Qwen first.
async function profileFrames(page) {
  await page.bringToFront();
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (!(await page.evaluate(() => window.jevfireDiagnostics().loaded)))
    throw new Error('Load Qwen first');
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    viewport: { width: 1440, height: 1000 },
    pace: await page.locator('#inference-pace').inputValue(),
    phases: [],
  };
  for (const phase of ['idle', 'scripted', 'model']) {
    await page.locator(phase === 'scripted' ? '#preview' : '#load').click();
    await page.locator('#reset').click();
    await page.locator('#speed').selectOption('1');
    await page.waitForFunction(() => !window.jevfireDiagnostics().busy, null, {
      timeout: 40000,
    });
    if (phase !== 'idle') await page.locator('#run').click();
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const gaps = [],
            tasks = [];
          let last = null,
            frame;
          const start = performance.now(),
            initial = window.jevfireDiagnostics();
          const observer = new PerformanceObserver((list) =>
            tasks.push(...list.getEntries().map((x) => x.duration)),
          );
          observer.observe({ entryTypes: ['longtask'] });
          const sample = (now) => {
            if (last !== null) gaps.push(now - last);
            last = now;
            frame = requestAnimationFrame(sample);
          };
          frame = requestAnimationFrame(sample);
          setTimeout(() => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            const end = performance.now(),
              final = window.jevfireDiagnostics();
            const sorted = [...gaps].sort((a, b) => a - b);
            const quantile = (q) =>
              sorted[
                Math.min(sorted.length - 1, Math.floor(sorted.length * q))
              ] ?? 0;
            resolve({
              wall_seconds: (end - start) / 1000,
              frames: gaps.length,
              fps: gaps.length / ((end - start) / 1000),
              frame_median_ms: quantile(0.5),
              frame_p95_ms: quantile(0.95),
              frame_p99_ms: quantile(0.99),
              frame_max_ms: Math.max(0, ...gaps),
              frames_over_50ms: gaps.filter((x) => x > 50).length,
              long_task_count: tasks.length,
              long_task_total_ms: tasks.reduce((a, b) => a + b, 0),
              simulation_seconds: final.time - initial.time,
              accepted_model_decisions:
                final.metrics.total_decisions - initial.metrics.total_decisions,
              rendered_frames: final.rendererStats
                ? final.rendererStats.rendered_frames -
                  initial.rendererStats.rendered_frames
                : null,
              measured_draw_fps: final.rendererStats
                ? (final.rendererStats.rendered_frames -
                    initial.rendererStats.rendered_frames) /
                  ((end - start) / 1000)
                : null,
              renderer: final.rendererStats ?? null,
            });
          }, 12000);
        }),
    );
    report.phases.push({ phase, ...result });
    if (phase !== 'idle') await page.locator('#run').click();
  }
  report.gpu = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return {
      vendor: a.info.vendor,
      architecture: a.info.architecture,
      user_agent: navigator.userAgent,
    };
  });
  await page.screenshot({ path: 'last-hearth-qa-profile.png' });
  await page.evaluate((r) => (window.jevfireFrameProfile = r), report);
  return report;
}
