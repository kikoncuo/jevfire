// Dev-server-only mechanical regression check; no model must be loaded.
// Run from web/: playwright-cli -s=cowork run-code --filename=qa/needs-jobs-check.js
// The controls are paused, then isolated instances of the REAL Game module receive
// explicitly scripted setup/actions. No worker/model/response is replaced or mocked.
async function needsJobsCheck(page) {
  await page.bringToFront();
  const initial = await page.evaluate(() => window.jevfireDiagnostics());
  if (initial.running) await page.locator('#run').click();
  await page.waitForFunction(() => !window.jevfireDiagnostics().busy, null, {
    timeout: 40000,
  });
  const before = await page.evaluate(() => window.jevfireDiagnostics());
  const report = await page.evaluate(async () => {
    const sourceUrl = new URL('src/game.js', location.href).href;
    const { Game } = await import(sourceUrl);
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const makeGame = () => {
      const game = new Game({ seed: 9137 });
      game.running = true;
      game.nextWave = Infinity;
      return game;
    };
    const advance = (game, seconds) => {
      let remaining = seconds;
      while (remaining > 1e-8) {
        const step = Math.min(0.05, remaining);
        game.update(step);
        remaining -= step;
      }
    };
    const snapshot = (unit) => ({
      id: unit.id,
      health: unit.health,
      hunger: unit.hunger,
      action: unit.action,
      proposed: unit.proposed,
      activity: unit.activity,
      needsOverride: unit.needsOverride,
      needsState: unit.needsState,
      autoTargetId: unit.autoTargetId,
      stamina: unit.stamina,
      restingBreak: unit.restingBreak,
      ruleAction: unit.ruleAction,
      ruleReason: unit.ruleReason,
    });
    const cases = [];

    {
      const game = makeGame(),
        fighter = game.units.find((unit) => unit.id === 'aldric');
      Object.assign(fighter, {
        x: fighter.home.x,
        y: fighter.home.y,
        hunger: 26,
      });
      game.apply({ aldric: 'train' }); // Scripted fixture input, not a model output.
      const ticks = game.ticks,
        decisions = game.decisions,
        food = game.food;
      game.update(0.05);
      check(
        fighter.activity === 'eating' &&
          fighter.needsOverride?.startsWith('Automatic needs:'),
        'Automatic hall meal did not expose its activity and attribution',
      );
      check(
        fighter.hunger > 59 && game.food === food - 1,
        'Hall meal did not consume one real food',
      );
      check(
        fighter.action === 'train' && fighter.proposed === 'train',
        'Automatic needs overwrote the requested job',
      );
      const eating = snapshot(fighter);
      advance(game, 2);
      check(
        fighter.needsOverride === null && fighter.action === 'train',
        'The selected job did not resume after eating',
      );
      check(
        game.ticks === ticks && game.decisions === decisions,
        'Eating manufactured a decision tick',
      );
      cases.push({
        name: 'automatic-hall-meal-and-resume',
        passed: true,
        eating,
        after: snapshot(fighter),
        food_spent: 1,
        extra_decision_ticks: 0,
      });
    }
    {
      const game = makeGame(),
        collector = game.units[0],
        patch = game.resources[0];
      Object.assign(collector, { x: patch.x, y: patch.y, hunger: 24 });
      game.food = 0;
      game.apply({ mira: 'forage_safe' });
      const stock = patch.food;
      game.update(0.05);
      check(
        collector.activity === 'eating' && collector.autoTargetId === patch.id,
        'Empty pantry did not permit eating at a stocked patch',
      );
      check(
        patch.food === stock - 1 && game.food === 0 && collector.carrying === 0,
        'Patch meal invented shared food or cargo',
      );
      cases.push({
        name: 'automatic-patch-meal',
        passed: true,
        unit: snapshot(collector),
        patch_food_spent: 1,
      });
    }
    {
      const game = makeGame(),
        collector = game.units[0];
      game.food = 0;
      for (const patch of game.resources) patch.food = 0;
      collector.hunger = 1;
      game.apply({ mira: 'forage_bold' });
      advance(game, 2);
      check(
        !collector.alive &&
          collector.reason === 'starved' &&
          game.selfCareMeals === 0,
        'Automatic needs invented food or made the villager immortal',
      );
      cases.push({
        name: 'no-food-still-means-starvation',
        passed: true,
        reason: collector.reason,
      });
    }
    {
      const game = makeGame(),
        ally = game.units[0],
        medic = game.units[5];
      Object.assign(ally, { x: 7, y: 17, health: 40 });
      Object.assign(medic, { x: 6.5, y: 17 });
      game.apply({ mira: 'forage_safe', nell: 'heal' });
      advance(game, 2.1);
      check(
        ally.health === 60 && game.food === 5 && game.treatments === 1,
        'Treatment did not exchange one food for twenty health',
      );
      check(medic.activity === 'healing', 'Medic activity was not exposed');
      const treatment = {
        medic: snapshot(medic),
        patient: snapshot(ally),
        food: game.food,
      };
      ally.health = 80;
      advance(game, 2.1);
      check(
        ally.health === ally.maxHealth && game.food === 4,
        'Healing exceeded max health or consumed incorrect food',
      );
      ally.health = 40;
      game.food = 0;
      advance(game, 1);
      check(
        ally.health === 40 && game.food === 0,
        'Healing continued without stored food',
      );
      cases.push({
        name: 'builder-healing-caps-and-food-cost',
        passed: true,
        treatment,
        capped_health: ally.maxHealth,
      });
    }
    {
      const game = makeGame(),
        fighter = game.units[2];
      check(
        game.availableActions('nell').join('|') === 'build',
        'Builder was offered nonexistent repair/healing work',
      );
      game.hall().health = 100;
      game.units[0].health = 30;
      game.units[5].stamina = 40;
      check(
        game.availableActions('nell').join('|') === 'repair|build|heal|relax',
        'Builder was not offered all four meaningful jobs',
      );
      const builderOptions = game.availableActions('nell');
      game.apply({ aldric: 'train' });
      fighter.strength = 40;
      check(
        game.availableActions(fighter).join('|') === 'relax',
        'Capped fighter still had pointless training/defense candidates',
      );
      const ticks = game.ticks,
        decisions = game.decisions;
      game.applyRuleAction(fighter.id, 'relax', 'Only available action');
      check(
        fighter.action === 'relax' &&
          fighter.proposed === 'train' &&
          fighter.ruleReason === 'Only available action',
        'Rule-only action lost attribution',
      );
      check(
        game.ticks === ticks && game.decisions === decisions,
        'Rule-only action manufactured AI decision counters',
      );
      cases.push({
        name: 'dynamic-jobs-and-rule-attribution',
        passed: true,
        builder_options: builderOptions,
        fighter: snapshot(fighter),
        extra_decision_ticks: 0,
      });
    }
    {
      const game = makeGame(),
        before = game.units.map((unit) => unit.personality);
      check(
        new Set(before).size === 6 && before.every(Boolean),
        'The six villagers did not have distinct personalities',
      );
      game.reset();
      check(
        JSON.stringify(game.units.map((unit) => unit.personality)) ===
          JSON.stringify(before),
        'Reset changed the character definitions',
      );
      cases.push({
        name: 'persistent-individual-personalities',
        passed: true,
        villagers: game.units.map(({ id, disposition, personality }) => ({
          id,
          disposition,
          personality,
        })),
      });
    }
    {
      const game = makeGame(),
        fighter = game.units[2],
        bram = game.units[1],
        mira = game.units[0];
      bram.stamina = mira.stamina = 60;
      check(
        game.availableActions(bram).includes('relax') &&
          !game.availableActions(mira).includes('relax'),
        'Distinct break thresholds did not affect available choices',
      );
      Object.assign(fighter, {
        x: fighter.home.x,
        y: fighter.home.y,
        stamina: 30,
      });
      game.apply({ aldric: 'relax' });
      const ticks = game.ticks,
        decisions = game.decisions;
      advance(game, 2);
      check(
        fighter.stamina > fighter.breakAt &&
          fighter.restingBreak &&
          fighter.action === 'relax',
        'The stamina break ended as soon as it crossed its trigger',
      );
      const during = snapshot(fighter);
      advance(game, 8);
      check(
        !fighter.restingBreak &&
          fighter.action === 'train' &&
          fighter.ruleReason === 'Only available action',
        'Fully recovered fighter remained in ineffective rest',
      );
      check(
        game.ticks === ticks && game.decisions === decisions,
        'Stamina recovery manufactured a model decision',
      );
      cases.push({
        name: 'personal-break-thresholds-and-return-to-work',
        passed: true,
        during,
        after: snapshot(fighter),
        extra_decision_ticks: 0,
      });
    }
    return {
      tested_at: new Date().toISOString(),
      source_url: sourceUrl,
      scope:
        'Controlled scripted mechanics in isolated real Game instances inside the browser. No LLM requests, model mocks, tactical accuracy claim, or live-stage fixture injection.',
      model_requests: 0,
      seed: 9137,
      cases,
      browser: navigator.userAgent,
    };
  });
  const after = await page.evaluate(() => window.jevfireDiagnostics());
  if (
    before.metrics.total_decisions !== after.metrics.total_decisions ||
    before.ticks !== after.ticks ||
    before.time !== after.time ||
    after.running
  )
    throw new Error(
      'Isolated scripted mechanics altered the paused live stage or model telemetry',
    );
  report.live_stage_unchanged = true;
  report.live_model_decisions_before = before.metrics.total_decisions;
  report.live_model_decisions_after = after.metrics.total_decisions;
  await page.evaluate((value) => {
    window.jevfireNeedsJobsReport = value;
  }, report);
  return report;
}
