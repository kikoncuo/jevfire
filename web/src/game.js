import {
  UNIT_DEFINITIONS,
  ROLE_ACTIONS,
  schemaFor,
  validateDecision,
} from './contract.js';
import {
  awardExperience,
  EXPERIENCE_RATES,
  progressionFor,
} from './progression.js';

export const WORLD_SIZE = 32;
export const COLORS = UNIT_DEFINITIONS.map((unit) => unit.color);
export const STAMINA_RULES = Object.freeze({
  mira: Object.freeze({ breakAt: 45, restUntil: 95 }),
  bram: Object.freeze({ breakAt: 70, restUntil: 90 }),
  aldric: Object.freeze({ breakAt: 40, restUntil: 95 }),
  sable: Object.freeze({ breakAt: 35, restUntil: 95 }),
  tomas: Object.freeze({ breakAt: 30, restUntil: 95 }),
  nell: Object.freeze({ breakAt: 45, restUntil: 95 }),
});
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round = (n) => Math.round(n * 10) / 10;
const HUNGER_RATE = 0.7;
const MEAL_SIZE = 34;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function seeded(seed) {
  let value =
    typeof seed === 'number'
      ? seed >>> 0
      : [...String(seed)].reduce(
          (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
          2166136261,
        );
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function bearing(a, b) {
  const names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  return names[
    (Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) + 8) % 8
  ];
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export class Game {
  constructor(options = {}) {
    this.seed = options.seed ?? 1847;
    this.reset();
  }

  reset(options = {}) {
    if (options.seed !== undefined) this.seed = options.seed;
    this.random = seeded(this.seed);
    this.running = false;
    this.time = 0;
    this.ticks = 0;
    this.decisions = 0;
    this.food = 6;
    this.totalGathered = 0;
    this.kills = 0;
    this.wave = 0;
    this.nextWave = 22;
    this.gameOver = false;
    this.over = false;
    this.endReason = null;
    this.events = [];
    this.projectiles = [];
    this.nextOrcId = 1;
    this.base = { x: 16, y: 20 };
    this.trainingGround = { id: 'training', x: 16, y: 25.4 };
    this.clinic = { id: 'clinic', x: 22.5, y: 22.8 };
    this.selfCareMeals = 0;
    this.treatments = 0;
    const placements = [
      [14.5, 19],
      [17.5, 19],
      [14.5, 17.8],
      [17.5, 17.8],
      [12.5, 19.5],
      [19.5, 19.5],
    ];
    this.units = UNIT_DEFINITIONS.map((definition, i) => ({
      ...definition,
      x: placements[i][0],
      y: placements[i][1],
      health: definition.role === 'fighter' ? 130 : 85,
      maxHealth: definition.role === 'fighter' ? 130 : 85,
      hunger: 100,
      experience: 0,
      stamina: 100,
      ...STAMINA_RULES[definition.id],
      restingBreak: false,
      alive: true,
      action: 'relax',
      proposed: 'relax',
      ruleAction: null,
      ruleReason: null,
      reason: null,
      needsOverride: null,
      needsState: null,
      needsActive: false,
      autoTargetId: null,
      eatingUntil: 0,
      healWork: 0,
      healCooldown: 0,
      activity: 'resting',
      strength: definition.role === 'fighter' ? 11 : 2,
      carrying: 0,
      targetId: null,
      heading: 0,
      work: 0,
      cooldown: 0,
      nextMeal: 0,
      path: [],
      pathFor: null,
      nextPath: 0,
      home: {
        id: `home-${definition.id}`,
        x: 14.6 + (i % 3) * 1.4,
        y: 21.5 + Math.floor(i / 3) * 1.2,
      },
    }));
    this.mealSpots = this.units.map((unit) => ({
      ...unit.home,
      unitId: unit.id,
    }));
    this.buildings = [
      {
        id: 'hall',
        type: 'hall',
        x: 16,
        y: 20,
        maxHealth: 420,
        health: 420,
        progress: 1,
      },
      {
        id: 'west-house',
        type: 'house',
        x: 12,
        y: 21,
        maxHealth: 170,
        health: 170,
        progress: 1,
      },
      {
        id: 'east-house',
        type: 'house',
        x: 20,
        y: 21,
        maxHealth: 170,
        health: 170,
        progress: 1,
      },
      {
        id: 'west-wall',
        type: 'wall',
        x: 13,
        y: 17,
        maxHealth: 160,
        health: 160,
        progress: 1,
      },
      {
        id: 'east-wall',
        type: 'wall',
        x: 19,
        y: 17,
        maxHealth: 160,
        health: 160,
        progress: 1,
      },
      ...[
        [11, 17],
        [21, 17],
        [14, 23],
        [18, 23],
      ].map(([x, y], i) => ({
        id: `tower-${i + 1}`,
        type: 'tower',
        x,
        y,
        maxHealth: 150,
        health: 0,
        progress: 0,
        cooldown: 0,
        destroyed: false,
      })),
    ];
    this.resources = [
      {
        id: 'west-garden',
        type: 'berries',
        x: 7,
        y: 17,
        food: 18,
        maxFood: 18,
        refill: 0,
      },
      {
        id: 'east-garden',
        type: 'berries',
        x: 25,
        y: 16,
        food: 18,
        maxFood: 18,
        refill: 0,
      },
      {
        id: 'north-grove',
        type: 'berries',
        x: 9,
        y: 7,
        food: 40,
        maxFood: 40,
        refill: 0,
      },
      {
        id: 'wild-grove',
        type: 'berries',
        x: 25,
        y: 6,
        food: 44,
        maxFood: 44,
        refill: 0,
      },
    ];
    this.orcs = [];
    this.log('start', 'Six villagers. One hall. Keep them alive.');
  }

  log(type, text, details = {}) {
    this.events.unshift({ time: this.time, type, text, ...details });
    this.events.length = Math.min(this.events.length, 32);
  }

  hall() {
    return this.buildings.find((building) => building.id === 'hall');
  }
  livingOrcs() {
    return this.orcs.filter((orc) => orc.alive);
  }
  livingUnits() {
    return this.units.filter((unit) => unit.alive);
  }

  spawnWave() {
    this.wave++;
    const count = Math.min(7, 1 + Math.floor(this.wave / 2));
    for (let i = 0; i < count; i++) {
      const edge = Math.floor(this.random() * 3);
      const x = edge === 0 ? 1 : edge === 1 ? 31 : 3 + this.random() * 26;
      const y = edge < 2 ? 3 + this.random() * 16 : 1;
      this.spawnOrc(x, y, this.wave);
    }
    this.nextWave = this.time + Math.max(20, 36 - this.wave);
    this.log(
      'wave',
      `Wave ${this.wave}: ${count} stronger orc${count === 1 ? '' : 's'} enter the woods.`,
    );
  }

  spawnOrc(x, y, level = Math.max(1, this.wave)) {
    const health = 42 + level * 14;
    const orc = {
      id: `orc-${this.nextOrcId++}`,
      x,
      y,
      level,
      health,
      maxHealth: health,
      alive: true,
      strength: 4 + level * 1.6,
      speed: Math.min(1.85, 1.15 + level * 0.035),
      targetId: null,
      heading: 0,
      activity: 'roaming',
      cooldown: 0,
      tauntedUntil: 0,
      roam: { x: 6 + this.random() * 20, y: 9 + this.random() * 17 },
      nextRoam: this.time + 8 + this.random() * 8,
    };
    this.orcs.push(orc);
    return orc;
  }

  apply(decision) {
    const ids =
      decision && typeof decision === 'object' ? Object.keys(decision) : [];
    if (
      !ids.length ||
      ids.some((id) => !this.units.some((unit) => unit.id === id && unit.alive))
    )
      throw new Error('Decision must address living villagers');
    const selected = this.units.filter((unit) => ids.includes(unit.id));
    validateDecision(decision, schemaFor(selected));
    for (const unit of selected) {
      unit.proposed = decision[unit.id];
      unit.ruleAction = null;
      unit.ruleReason = null;
      unit.restingBreak =
        unit.proposed === 'relax' &&
        (unit.restingBreak || unit.stamina <= unit.breakAt);
      if (unit.action !== unit.proposed) {
        unit.action = unit.proposed;
        unit.targetId = null;
        unit.work = 0;
        unit.path = [];
      }
      unit.reason = null;
    }
    this.ticks++;
    this.decisions += selected.length;
    return decision;
  }

  applyRuleAction(id, action, reason = 'Only available action') {
    const unit = this.units.find(
      (candidate) => candidate.id === id && candidate.alive,
    );
    if (!unit || !this.availableActions(unit).includes(action))
      throw new Error('Rule action is not currently available');
    if (unit.action !== action) {
      unit.action = action;
      unit.targetId = null;
      unit.work = 0;
      unit.path = [];
    }
    unit.restingBreak =
      action === 'relax' && (unit.restingBreak || unit.stamina <= unit.breakAt);
    unit.ruleAction = action;
    unit.ruleReason = reason;
    unit.reason = reason;
    // Preserve the last proposed choice, and do not manufacture a scored decision.
    return action;
  }

  routeRisk(unit, target) {
    const nearby = this.livingOrcs().filter(
      (orc) => segmentDistance(orc, unit, target) < 5,
    );
    return nearby.length === 0
      ? 'low'
      : nearby.some((orc) => segmentDistance(orc, unit, target) < 2.8)
        ? 'high'
        : 'medium';
  }

  forageTarget(unit, safe) {
    const candidates = this.resources.filter((resource) => resource.food > 0);
    return candidates.sort((a, b) => {
      const score = (resource) =>
        distance(unit, resource) +
        (safe
          ? { low: 0, medium: 16, high: 40 }[this.routeRisk(unit, resource)]
          : -resource.food * 0.32);
      return score(a) - score(b);
    })[0];
  }

  repairTarget(unit) {
    return this.buildings
      .filter(
        (building) =>
          building.progress >= 1 &&
          building.health > 0 &&
          building.health < building.maxHealth - 1,
      )
      .sort(
        (a, b) =>
          a.health / a.maxHealth -
            (a.id === 'hall' ? 0.35 : 0) -
            (b.health / b.maxHealth - (b.id === 'hall' ? 0.35 : 0)) ||
          distance(unit, a) - distance(unit, b),
      )[0];
  }

  buildTarget(unit) {
    return this.buildings
      .filter(
        (building) =>
          building.type === 'tower' &&
          building.progress < 1 &&
          !building.destroyed,
      )
      .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
  }

  healTarget(unit) {
    return this.livingUnits()
      .filter((ally) => ally.id !== unit.id && ally.health < ally.maxHealth - 4)
      .sort(
        (a, b) =>
          a.health / a.maxHealth - b.health / b.maxHealth ||
          distance(unit, a) - distance(unit, b),
      )[0];
  }

  restReason(unit) {
    if (unit.health < unit.maxHealth * 0.9) return 'Recovering from injury';
    if (unit.hunger <= 74) return 'Hungry: a meal is useful';
    if (unit.restingBreak && unit.stamina < unit.restUntil)
      return `Finishing a break until ${unit.restUntil} stamina`;
    if (unit.stamina <= unit.breakAt)
      return `Fatigue: stamina is below the ${unit.breakAt} break threshold`;
    return null;
  }

  availableActions(unitOrId) {
    const unit =
      typeof unitOrId === 'string'
        ? this.units.find((candidate) => candidate.id === unitOrId)
        : unitOrId;
    if (
      !unit ||
      !UNIT_DEFINITIONS.some(
        (definition) =>
          definition.id === unit.id && definition.role === unit.role,
      )
    )
      throw new Error('Unknown villager');
    if (!unit.alive) return [];
    const actions = ROLE_ACTIONS[unit.role].filter((action) => {
      if (action === 'relax') return false;
      if (action === 'forage_safe' || action === 'forage_bold')
        return (
          unit.carrying >= 3 ||
          this.resources.some((resource) => resource.food > 0)
        );
      if (action === 'train') return unit.strength < 40;
      if (action === 'defend') return this.orcs.some((orc) => orc.alive);
      if (action === 'repair') return Boolean(this.repairTarget(unit));
      if (action === 'build') return Boolean(this.buildTarget(unit));
      if (action === 'heal')
        return this.food > 0 && Boolean(this.healTarget(unit));
      return false;
    });
    if (this.restReason(unit) || !actions.length) actions.push('relax');
    return actions;
  }

  stepStamina(unit, dt) {
    if (unit.action === 'relax' && distance(unit, unit.home) < 0.9) {
      unit.stamina = Math.min(100, unit.stamina + dt * 8);
    } else if (unit.activity === 'eating') {
      unit.stamina = Math.min(100, unit.stamina + dt * 1.5);
    } else if (unit.action !== 'relax' || unit.activity === 'walking') {
      unit.stamina = Math.max(
        0,
        unit.stamina - dt * (unit.activity === 'fighting' ? 0.65 : 0.45),
      );
    }
    if (unit.stamina >= unit.restUntil) unit.restingBreak = false;
  }

  defendTarget(unit) {
    return this.livingOrcs().sort((a, b) => {
      const priority = (orc) =>
        distance(unit, orc) -
        (this.units.some((ally) => ally.alive && orc.targetId === ally.id)
          ? 25
          : 0) -
        (this.buildings.some(
          (building) => building.health > 0 && orc.targetId === building.id,
        )
          ? 15
          : 0);
      return priority(a) - priority(b);
    })[0];
  }

  // Navigation is deterministic execution of the selected action, not another policy.
  // Only safe-foraging routes penalize danger. No action is replaced by a survival fallback.
  findPath(start, goal, safe) {
    const cell = (point) => [
      clamp(Math.round(point.x / 2), 1, 15),
      clamp(Math.round(point.y / 2), 1, 15),
    ];
    const [sx, sy] = cell(start),
      [gx, gy] = cell(goal);
    const key = (x, y) => y * 17 + x;
    const startKey = key(sx, sy),
      goalKey = key(gx, gy);
    const open = [{ x: sx, y: sy, key: startKey, score: 0 }],
      cost = new Map([[startKey, 0]]),
      parent = new Map();
    const threats = safe ? this.livingOrcs() : [];
    while (open.length) {
      open.sort((a, b) => a.score - b.score);
      const current = open.shift();
      if (current.key === goalKey) {
        const path = [{ x: goal.x, y: goal.y }];
        let cursor = goalKey;
        while (cursor !== startKey) {
          path.unshift({
            x: (cursor % 17) * 2,
            y: Math.floor(cursor / 17) * 2,
          });
          cursor = parent.get(cursor);
        }
        return path;
      }
      for (const [dx, dy] of NEIGHBORS) {
        const x = current.x + dx,
          y = current.y + dy;
        if (x < 1 || x > 15 || y < 1 || y > 15) continue;
        const next = key(x, y),
          point = { x: x * 2, y: y * 2 };
        if (
          next !== goalKey &&
          this.buildings.some(
            (building) =>
              building.health > 0 && distance(point, building) < 1.1,
          )
        )
          continue;
        const danger = threats.reduce(
          (sum, orc) => sum + Math.max(0, 5.5 - distance(point, orc)) * 3,
          0,
        );
        const newCost = cost.get(current.key) + Math.hypot(dx, dy) + danger;
        if (newCost >= (cost.get(next) ?? Infinity)) continue;
        cost.set(next, newCost);
        parent.set(next, current.key);
        const existing = open.find((node) => node.key === next);
        if (existing) existing.score = newCost + Math.hypot(x - gx, y - gy);
        else
          open.push({
            x,
            y,
            key: next,
            score: newCost + Math.hypot(x - gx, y - gy),
          });
      }
    }
    return [{ x: goal.x, y: goal.y }];
  }

  move(entity, target, speed, dt, safe = false, direct = false) {
    if (!target) return false;
    if (entity.role && Number.isFinite(entity.stamina))
      speed *= 0.85 + (0.15 * entity.stamina) / 100;
    if (distance(entity, target) < 0.85) return true;
    let waypoint = target;
    if (!direct) {
      const targetKey = `${target.id ?? ''}:${Math.round(target.x)}:${Math.round(target.y)}:${safe}`;
      if (
        entity.pathFor !== targetKey ||
        this.time >= entity.nextPath ||
        !entity.path.length
      ) {
        entity.path = this.findPath(entity, target, safe);
        entity.pathFor = targetKey;
        entity.nextPath = this.time + 2.5;
      }
      while (entity.path.length > 1 && distance(entity, entity.path[0]) < 0.25)
        entity.path.shift();
      waypoint = entity.path[0] ?? target;
    }
    const d = distance(entity, waypoint);
    if (d > 0.02) {
      const step = Math.min(d, speed * dt);
      entity.heading = Math.atan2(waypoint.x - entity.x, waypoint.y - entity.y);
      entity.x = clamp(
        entity.x + ((waypoint.x - entity.x) / d) * step,
        0.6,
        31.4,
      );
      entity.y = clamp(
        entity.y + ((waypoint.y - entity.y) / d) * step,
        0.6,
        31.4,
      );
    }
    entity.activity = 'walking';
    return distance(entity, target) < 0.85;
  }

  damage(target, amount, attacker) {
    if (target.health <= 0) return;
    const previousHealth = target.health;
    target.health = Math.max(0, target.health - amount);
    if (target.id.startsWith('orc-') && attacker?.role === 'fighter')
      awardExperience(
        attacker,
        (previousHealth - target.health) * EXPERIENCE_RATES.orcDamage,
      );
    if (target.health > 0) return;
    if (Object.hasOwn(target, 'role'))
      this.killUnit(target, `killed by ${attacker?.id ?? 'an orc'}`);
    else if (target.id.startsWith('orc-')) {
      target.alive = false;
      target.activity = 'dead';
      target.targetId = null;
      target.diedAt = this.time;
      this.kills++;
      this.log(
        'kill',
        `${attacker?.name ?? 'A tower'} felled a level ${target.level} orc.`,
        { targetId: target.id },
      );
    } else {
      target.destroyed = true;
      this.log(
        'building',
        `${target.type === 'hall' ? 'The hall' : target.id} was destroyed.`,
        { targetId: target.id },
      );
    }
  }

  killUnit(unit, cause) {
    if (!unit.alive) return;
    unit.alive = false;
    unit.health = 0;
    unit.activity = 'dead';
    unit.targetId = null;
    unit.diedAt = this.time;
    unit.reason = cause;
    unit.needsOverride = null;
    unit.needsState = null;
    unit.autoTargetId = null;
    this.log('death', `${unit.name} ${cause}.`, { unitId: unit.id });
  }

  deposit(unit) {
    if (
      unit.carrying > 0 &&
      this.hall().health > 0 &&
      distance(unit, this.base) < 3.5
    ) {
      const amount = unit.carrying;
      this.food += amount;
      this.totalGathered += amount;
      unit.carrying = 0;
      this.log('food', `${unit.name} brought home ${amount} food.`, {
        unitId: unit.id,
      });
    }
  }

  mealSource(unit) {
    if (unit.carrying > 0)
      return { kind: 'basket', id: unit.id, x: unit.x, y: unit.y };
    const sources = this.resources
      .filter((resource) => resource.food > 0)
      .map((resource) => ({ ...resource, kind: 'patch' }));
    if (this.food > 0 && this.hall().health > 0)
      sources.push({ ...unit.home, id: 'hall', kind: 'hall' });
    return sources.sort((a, b) => distance(unit, a) - distance(unit, b))[0];
  }

  consumeMeal(unit, source) {
    if (this.time < unit.nextMeal) return false;
    if (source.kind === 'hall') {
      if (this.food <= 0 || this.hall().health <= 0) return false;
      this.food--;
    } else if (source.kind === 'basket') {
      if (unit.carrying <= 0) return false;
      unit.carrying--;
    } else {
      const patch = this.resources.find(
        (resource) => resource.id === source.id,
      );
      if (!patch || patch.food <= 0) return false;
      patch.food--;
    }
    unit.hunger = Math.min(100, unit.hunger + MEAL_SIZE);
    unit.nextMeal = this.time + 3;
    unit.eatingUntil = this.time + 1.2;
    unit.activity = 'eating';
    unit.needsState = 'eating';
    unit.autoTargetId = source.id;
    unit.needsOverride = `Automatic needs: eating ${source.kind === 'hall' ? 'at the hall' : source.kind === 'basket' ? 'from the basket' : 'at a food patch'}`;
    unit.reason = unit.needsOverride;
    this.selfCareMeals++;
    return true;
  }

  // Explicit physiology: villagers attend to hunger without manufacturing an AI tick.
  // The model's action/proposed fields are retained and resume after the meal.
  stepNeeds(unit, dt) {
    if (this.time < unit.eatingUntil) {
      unit.activity = 'eating';
      unit.reason = unit.needsOverride;
      return true;
    }
    if (unit.hunger <= 28) unit.needsActive = true;
    if (unit.hunger >= 55) unit.needsActive = false;
    if (!unit.needsActive) {
      unit.needsOverride = null;
      unit.needsState = null;
      unit.autoTargetId = null;
      return false;
    }
    const source = this.mealSource(unit);
    if (!source) {
      unit.needsOverride = 'Automatic needs: no food available';
      unit.needsState = 'no_food';
      unit.autoTargetId = null;
      unit.reason = unit.needsOverride;
      return false;
    }
    unit.autoTargetId = source.id;
    unit.needsState = 'seeking_food';
    unit.needsOverride = `Automatic needs: seeking food ${source.kind === 'hall' ? 'at the hall' : source.kind === 'basket' ? 'in the basket' : 'at a food patch'}`;
    unit.reason = unit.needsOverride;
    if (!this.move(unit, source, 2.25, dt, true)) return true;
    if (source.kind === 'hall') this.deposit(unit);
    unit.activity = 'eating';
    this.consumeMeal(unit, source);
    return true;
  }

  stepUnit(unit, dt) {
    if (!unit.alive) return;
    unit.hunger = Math.max(0, unit.hunger - dt * HUNGER_RATE);
    if (unit.hunger <= 0) {
      this.killUnit(unit, 'starved');
      return;
    }
    this.stepStamina(unit, dt);
    unit.cooldown = Math.max(0, unit.cooldown - dt);
    unit.reason = unit.ruleReason;
    if (this.stepNeeds(unit, dt)) return;
    const available = this.availableActions(unit);
    if (!available.includes(unit.action)) {
      if (available.length === 1)
        this.applyRuleAction(unit.id, available[0], 'Only available action');
      else {
        unit.activity = 'waiting';
        unit.reason =
          'Previous job has no useful effect; waiting for a new decision';
        return;
      }
    }
    const action = unit.action;
    if (action === 'relax') {
      unit.targetId = 'hall';
      if (!this.move(unit, unit.home, 2.1, dt)) return;
      unit.activity = 'resting';
      if (this.hall().health <= 0) {
        unit.reason = 'The hall is destroyed: no food or healing';
        return;
      }
      this.deposit(unit);
      if (unit.hunger <= 74 && this.food > 0 && this.time >= unit.nextMeal) {
        this.consumeMeal(unit, { kind: 'hall', id: 'hall' });
      }
      if (this.food === 0 && unit.hunger <= 74)
        unit.reason = 'The shared pantry is empty';
      unit.health = Math.min(
        unit.maxHealth,
        unit.health + dt * (unit.hunger > 20 ? 3 : 0),
      );
      return;
    }
    if (action === 'forage_safe' || action === 'forage_bold') {
      const safe = action === 'forage_safe';
      // A filled basket returns home as part of the selected foraging action.
      if (unit.carrying >= 3) {
        unit.targetId = 'hall';
        if (this.move(unit, unit.home, safe ? 1.8 : 2.5, dt, safe))
          this.deposit(unit);
        if (this.hall().health <= 0)
          unit.reason = 'Cannot deposit: hall destroyed';
        return;
      }
      let target = this.resources.find(
        (resource) => resource.id === unit.targetId && resource.food > 0,
      );
      if (!target || this.time >= (unit.nextResourceCheck ?? 0)) {
        target = this.forageTarget(unit, safe);
        unit.nextResourceCheck = this.time + 3;
      }
      if (!target) {
        unit.activity = 'waiting';
        unit.reason = 'All food patches are empty';
        return;
      }
      unit.targetId = target.id;
      if (!this.move(unit, target, safe ? 1.8 : 2.5, dt, safe)) return;
      unit.activity = 'gathering';
      unit.work += dt;
      const duration = safe ? 2.1 : 1.45;
      if (unit.work >= duration && target.food > 0) {
        unit.work -= duration;
        target.food--;
        unit.carrying++;
        awardExperience(unit, EXPERIENCE_RATES.harvestedFood);
      }
      return;
    }
    if (action === 'train') {
      unit.targetId = 'training';
      const position = {
        ...this.trainingGround,
        x: this.trainingGround.x + (unit.id === 'aldric' ? -0.8 : 0.8),
      };
      if (!this.move(unit, position, 2.1, dt)) return;
      unit.activity = 'training';
      const previousStrength = unit.strength;
      unit.strength = Math.min(40, unit.strength + dt * 0.12);
      awardExperience(
        unit,
        ((unit.strength - previousStrength) / 0.12) *
          EXPERIENCE_RATES.trainingSecond,
      );
      return;
    }
    if (action === 'defend') {
      const target = this.defendTarget(unit);
      if (!target) {
        unit.targetId = null;
        if (this.move(unit, { x: 16, y: 16 }, 2.4, dt))
          unit.activity = 'guarding';
        unit.reason = 'No living orcs to intercept';
        return;
      }
      unit.targetId = target.id;
      if (distance(unit, target) < 6) {
        target.targetId = unit.id;
        target.tauntedUntil = this.time + 3;
      }
      if (distance(unit, target) > 1.4) {
        this.move(unit, target, 2.45, dt, false, true);
        return;
      }
      unit.activity = 'fighting';
      unit.heading = Math.atan2(target.x - unit.x, target.y - unit.y);
      if (unit.cooldown <= 0) {
        this.damage(target, unit.strength, unit);
        unit.cooldown = 0.85;
      }
      return;
    }
    if (action === 'heal') {
      const target = this.healTarget(unit);
      if (!target || this.food <= 0) {
        unit.targetId = null;
        unit.activity = 'waiting';
        unit.healWork = 0;
        unit.reason = !target
          ? 'No wounded allies need treatment'
          : 'Treatment needs one stored food';
        return;
      }
      if (unit.targetId !== target.id) unit.healWork = 0;
      unit.targetId = target.id;
      if (distance(unit, target) > 1.3) {
        this.move(unit, target, 2.15, dt);
        return;
      }
      unit.activity = 'healing';
      unit.heading = Math.atan2(target.x - unit.x, target.y - unit.y);
      unit.healWork += dt;
      if (
        unit.healWork >= 2 &&
        this.time >= unit.healCooldown &&
        this.food > 0
      ) {
        unit.healWork = 0;
        unit.healCooldown = this.time + 2;
        this.food--;
        const restored = Math.min(20, target.maxHealth - target.health);
        target.health += restored;
        awardExperience(unit, restored * EXPERIENCE_RATES.healedHealth);
        this.treatments++;
        this.log(
          'heal',
          `${unit.name} treated ${target.name} (+${Math.round(restored)} health, 1 food).`,
          { unitId: unit.id, targetId: target.id },
        );
      }
      return;
    }
    if (action === 'repair' || action === 'build') {
      const target =
        action === 'repair' ? this.repairTarget(unit) : this.buildTarget(unit);
      if (!target) {
        unit.targetId = null;
        unit.activity = 'waiting';
        unit.reason =
          action === 'repair'
            ? 'No damaged standing buildings'
            : 'All defense sites completed or destroyed';
        return;
      }
      unit.targetId = target.id;
      if (!this.move(unit, target, 2, dt)) return;
      unit.activity = action === 'repair' ? 'repairing' : 'building';
      unit.heading = Math.atan2(target.x - unit.x, target.y - unit.y);
      if (action === 'repair') {
        const previousHealth = target.health;
        target.health = Math.min(target.maxHealth, target.health + dt * 10);
        awardExperience(
          unit,
          (target.health - previousHealth) * EXPERIENCE_RATES.repairedHealth,
        );
      } else {
        const previous = target.progress;
        target.progress = Math.min(1, target.progress + dt / 28);
        awardExperience(
          unit,
          (target.progress - previous) * EXPERIENCE_RATES.completedTower,
        );
        target.health = Math.min(
          target.maxHealth,
          target.health + (target.progress - previous) * target.maxHealth,
        );
        if (target.progress === 1 && previous < 1)
          this.log('build', `${unit.name} completed a watchtower.`, {
            unitId: unit.id,
            targetId: target.id,
          });
      }
    }
  }

  stepOrc(orc, dt) {
    if (!orc.alive) return;
    orc.cooldown = Math.max(0, orc.cooldown - dt);
    const candidates = [
      ...this.livingUnits(),
      ...this.buildings.filter((building) => building.health > 0),
    ];
    let target = candidates.find((entity) => entity.id === orc.targetId);
    if (target && distance(orc, target) > 10 && this.time >= orc.tauntedUntil)
      target = null;
    if (this.time >= orc.tauntedUntil) {
      const nearby = candidates
        .filter((entity) => distance(orc, entity) < (entity.role ? 5.6 : 4.7))
        .sort((a, b) => distance(orc, a) - distance(orc, b));
      if (
        nearby[0] &&
        (!target || distance(orc, nearby[0]) + 1.2 < distance(orc, target))
      )
        target = nearby[0];
    }
    orc.targetId = target?.id ?? null;
    if (target) {
      if (distance(orc, target) > (target.role ? 1.25 : 1.7)) {
        this.move(orc, target, orc.speed, dt, false, true);
        return;
      }
      orc.activity = 'fighting';
      orc.heading = Math.atan2(target.x - orc.x, target.y - orc.y);
      if (orc.cooldown <= 0) {
        this.damage(target, orc.strength, orc);
        orc.cooldown = 1.05;
      }
      return;
    }
    if (this.time >= orc.nextRoam || distance(orc, orc.roam) < 1) {
      orc.roam = { x: 5 + this.random() * 22, y: 7 + this.random() * 21 };
      orc.nextRoam = this.time + 8 + this.random() * 8;
    }
    this.move(orc, orc.roam, orc.speed * 0.75, dt, false, true);
    orc.activity = 'roaming';
  }

  update(dt) {
    if (!this.running || this.gameOver || !Number.isFinite(dt) || dt <= 0)
      return;
    // Bounded substeps make damage, hunger and building work stable across render rates.
    let remaining = Math.min(dt, 10);
    while (remaining > 1e-8 && !this.gameOver) {
      const step = Math.min(0.05, remaining);
      remaining -= step;
      this.time += step;
      if (this.time >= this.nextWave) this.spawnWave();
      for (const unit of this.units) this.stepUnit(unit, step);
      for (const orc of this.orcs) this.stepOrc(orc, step);
      for (const tower of this.buildings.filter(
        (building) =>
          building.type === 'tower' &&
          building.progress >= 1 &&
          building.health > 0,
      )) {
        tower.cooldown = Math.max(0, tower.cooldown - step);
        const target = this.livingOrcs()
          .filter((orc) => distance(tower, orc) < 7)
          .sort((a, b) => distance(tower, a) - distance(tower, b))[0];
        tower.targetId = target?.id ?? null;
        if (target && tower.cooldown <= 0) {
          this.damage(target, 8, tower);
          this.projectiles.push({
            x: tower.x,
            y: tower.y,
            targetX: target.x,
            targetY: target.y,
            born: this.time,
            expires: this.time + 0.28,
          });
          tower.cooldown = 1.4;
        }
      }
      for (const resource of this.resources) {
        resource.refill += step;
        if (resource.refill >= 12) {
          resource.refill -= 12;
          resource.food = Math.min(resource.maxFood, resource.food + 1);
        }
      }
      this.projectiles = this.projectiles.filter(
        (projectile) => projectile.expires > this.time,
      );
      // Keep recent corpses visible without growing the simulation forever.
      this.orcs = this.orcs.filter(
        (orc) => orc.alive || this.time - orc.diedAt < 20,
      );
      if (!this.units.some((unit) => unit.alive) || this.hall().health <= 0) {
        this.gameOver = true;
        this.over = true;
        this.endReason =
          this.hall().health <= 0
            ? 'The hall was destroyed'
            : 'All villagers died';
        this.running = false;
        this.log(
          'end',
          `The village fell after ${Math.floor(this.time)} seconds.`,
        );
      }
    }
  }

  contextFor(id) {
    const unit = this.units.find((candidate) => candidate.id === id);
    if (!unit) throw new Error('Unknown villager');
    const progression = progressionFor(unit);
    const liveOrcs = this.livingOrcs();
    const nearest = liveOrcs.toSorted(
      (a, b) => distance(unit, a) - distance(unit, b),
    );
    const endangered = this.livingUnits().filter((ally) =>
      liveOrcs.some((orc) => orc.targetId === ally.id),
    );
    const buildingThreats = this.buildings.filter(
      (building) =>
        building.health > 0 &&
        liveOrcs.some((orc) => orc.targetId === building.id),
    );
    const describe = (target) => ({
      id: target.id,
      distance: round(distance(unit, target)),
      bearing: bearing(unit, target),
    });
    const context = {
      self: {
        id: unit.id,
        alive: unit.alive,
        role: unit.role,
        level: progression.level,
        experience: progression.totalXp,
        health: Math.ceil(unit.health),
        max_health: unit.maxHealth,
        hunger: Math.ceil(unit.hunger),
        stamina: Math.ceil(unit.stamina),
        break_threshold: unit.breakAt,
        rest_until: unit.restUntil,
        starves_in_seconds: Math.floor(unit.hunger / HUNGER_RATE),
        home_walk_seconds: Math.ceil(distance(unit, unit.home) / 2.1),
        action: unit.action,
        personality: unit.personality,
        needs_override: unit.needsOverride,
        carrying_food: unit.carrying,
        attacked_by: liveOrcs.filter((orc) => orc.targetId === unit.id).length,
      },
      village: {
        food: this.food,
        alive: this.livingUnits().length,
        wave: this.wave,
        hall_health_percent: Math.round(
          (this.hall().health / this.hall().maxHealth) * 100,
        ),
        threatened_villagers: endangered.length,
        threatened_buildings: buildingThreats.length,
      },
      available_actions: this.availableActions(unit),
      rest_available_reason:
        this.restReason(unit) ||
        (this.availableActions(unit).includes('relax')
          ? 'No useful work is currently available'
          : null),
      nearest_orcs: nearest.slice(0, 2).map((orc) => ({
        ...describe(orc),
        health: Math.ceil(orc.health),
        level: orc.level,
        attacking: orc.targetId ?? 'none',
        reaches_me_seconds: Math.max(
          0,
          Math.ceil((distance(unit, orc) - 1.25) / orc.speed),
        ),
      })),
    };
    if (unit.role === 'collector') {
      context.food_routes = this.resources
        .filter((resource) => resource.food > 0)
        .toSorted((a, b) => distance(unit, a) - distance(unit, b))
        .slice(0, 3)
        .map((resource) => ({
          ...describe(resource),
          food: resource.food,
          risk: this.routeRisk(unit, resource),
          safe_round_trip_seconds: Math.ceil(
            (distance(unit, resource) + distance(resource, this.base)) / 1.8 +
              6.3,
          ),
        }));
    } else if (unit.role === 'fighter') {
      context.self.strength = round(unit.strength);
      context.allies_under_attack = endangered
        .filter((ally) => ally.id !== unit.id)
        .slice(0, 3)
        .map((ally) => ({
          ...describe(ally),
          health: Math.ceil(ally.health),
          role: ally.role,
        }));
      context.buildings_under_attack = buildingThreats
        .slice(0, 2)
        .map(describe);
    } else {
      context.wounded_allies = this.livingUnits()
        .filter(
          (ally) => ally.id !== unit.id && ally.health < ally.maxHealth - 4,
        )
        .toSorted((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)
        .slice(0, 3)
        .map((ally) => ({
          ...describe(ally),
          health: Math.ceil(ally.health),
          max_health: ally.maxHealth,
          role: ally.role,
        }));
      context.healing_food_cost = 1;
      context.repairs = this.buildings
        .filter(
          (building) =>
            building.health > 0 &&
            building.progress >= 1 &&
            building.health < building.maxHealth - 1,
        )
        .toSorted((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)
        .slice(0, 3)
        .map((building) => ({
          ...describe(building),
          health_percent: Math.round(
            (100 * building.health) / building.maxHealth,
          ),
          under_attack: liveOrcs.some((orc) => orc.targetId === building.id),
        }));
      context.defense_sites_left = this.buildings.filter(
        (building) =>
          building.type === 'tower' &&
          building.progress < 1 &&
          !building.destroyed,
      ).length;
      context.towers_active = this.buildings.filter(
        (building) =>
          building.type === 'tower' &&
          building.progress >= 1 &&
          building.health > 0,
      ).length;
    }
    return context;
  }

  state() {
    return Object.fromEntries(
      this.livingUnits().map((unit) => [unit.id, this.contextFor(unit.id)]),
    );
  }

  summary() {
    return {
      time: round(this.time),
      alive: this.livingUnits().length,
      total: this.units.length,
      food: this.food,
      wave: this.wave,
      kills: this.kills,
      gathered: this.totalGathered,
      automatic_meals: this.selfCareMeals,
      treatments: this.treatments,
      ticks: this.ticks,
      decisions: this.decisions,
      orcs: this.livingOrcs().length,
      hall_health: Math.ceil(this.hall().health),
      game_over: this.gameOver,
      end_reason: this.endReason,
    };
  }

  // Explicit reference controller for preview and balance tests; never an AI fallback.
  scripted() {
    return Object.fromEntries(
      this.livingUnits().map((unit) => {
        const c = this.contextFor(unit.id);
        let action;
        if (
          unit.hunger < 36 + c.self.home_walk_seconds * HUNGER_RATE ||
          unit.health < unit.maxHealth * 0.38
        )
          action = 'relax';
        else if (unit.role === 'collector')
          action = this.food >= 20 ? 'relax' : 'forage_safe';
        else if (unit.role === 'fighter')
          action =
            c.village.threatened_villagers ||
            c.village.threatened_buildings ||
            c.nearest_orcs.some((orc) => orc.distance < 12)
              ? 'defend'
              : 'train';
        else
          action =
            unit.id === 'nell' && this.food > 2 && this.healTarget(unit)
              ? 'heal'
              : this.repairTarget(unit)
                ? 'repair'
                : this.buildTarget(unit)
                  ? 'build'
                  : 'relax';
        const available = this.availableActions(unit);
        return [unit.id, available.includes(action) ? action : available[0]];
      }),
    );
  }
}
