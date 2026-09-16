// Compare actual candidate logits from chunked and ordinary WebLLM prefill.
async function checkPrefill(page) {
  await page.bringToFront();
  await page.waitForFunction(
    () => {
      const d = window.jevfireDiagnostics();
      return d.loaded && !d.busy && !d.running;
    },
    null,
    { timeout: 45000 },
  );
  const results = [];
  for (const unitId of ['mira', 'aldric', 'tomas', 'nell']) {
    await page.locator(`[data-unit="${unitId}"]`).click();
    const result = await page.evaluate(async (unitId) => {
      const context = window.jevfireDiagnostics().selectedContext;
      const result = await window.jevfireTestDecision({
        unitId,
        context,
        compareWithWhole: true,
      });
      return {
        unitId,
        context,
        parsed_json: result.parsed_json,
        elapsed_ms: result.elapsed_ms,
        prompt_tokens: result.prompt_tokens,
        prefill_chunks: result.prefill_chunks,
        comparison: result.diagnostic.comparison,
      };
    }, unitId);
    results.push(result);
  }
  await page.screenshot({ path: 'last-hearth-qa-prefill.png' });
  const report = {
    tested_at: new Date().toISOString(),
    model: 'Qwen3.5-0.8B-q4f16_1-MLC',
    results,
  };
  await page.evaluate((r) => (window.jevfirePrefillCheck = r), report);
  if (results.some((r) => !r.comparison.same_winner))
    throw new Error(JSON.stringify(report));
  return report;
}
