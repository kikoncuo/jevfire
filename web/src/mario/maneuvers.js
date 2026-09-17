import { MarioGame, FIXED_STEP } from './game.js';

// A model selects one of these maneuvers. The executor only times buttons; it
// never chooses a route or calls scriptedAction. Forecasts use this game's real
// collision/enemy physics and contain no level-specific coordinates.
export const MANEUVERS = Object.freeze({
  run: Object.freeze({ direction: 'right', speed: 'run', duration: 0.26 }),
  walk: Object.freeze({ direction: 'right', speed: 'walk', duration: 0.3 }),
  brake: Object.freeze({ direction: 'still', speed: 'walk', duration: 0.2 }),
  retreat: Object.freeze({ direction: 'left', speed: 'walk', duration: 0.28 }),
  hop: Object.freeze({ direction: 'right', speed: 'run', hold: 0.08 }),
  jump: Object.freeze({ direction: 'right', speed: 'run', hold: 0.6 }),
  jump_walk: Object.freeze({ direction: 'right', speed: 'walk', hold: 0.6 }),
});

const BRAKE = Object.freeze({ direction: 'still', jump: false, speed: 'walk' });
const round = (value) => Math.round(value * 100) / 100;
const ids = ['run', 'walk', 'hop', 'jump', 'jump_walk', 'brake', 'retreat'];

// A private, independent copy. Forecast mutations (coins, enemy contacts, used
// blocks, timers, events) must never leak into the visible game.
export function cloneMarioGame(game) {
  const clone = Object.assign(Object.create(MarioGame.prototype), game);
  clone.player = { ...game.player };
  clone.control = { ...game.control };
  clone.solids = game.solids.map((solid) => ({ ...solid }));
  clone.enemies = game.enemies.map((enemy) => ({ ...enemy }));
  clone.items = game.items.map((item) => ({ ...item }));
  clone.events = [];
  clone.effects = [];
  clone.accumulator = 0;
  clone.running = !game.over;
  return clone;
}

export class ManeuverExecutor {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = null;
    this.jumpUntil = -Infinity;
    this.rearm = false;
    this.jumpStarted = false;
    this.acceptedSelections = 0;
    this.rejectedSelections = 0;
    this.safetyInterventions = 0;
    this.forcedSelections = 0;
    this.waitingStops = 0;
    this.lastReason = '';
    return this;
  }

  clone() {
    const result = Object.assign(new ManeuverExecutor(), this);
    result.active = this.active ? { ...this.active } : null;
    return result;
  }

  // Internal button timing, also used by forecasts. A jump maneuver presses
  // once, holds for its specified height, then releases; it never auto-bounces.
  begin(id, game) {
    const maneuver = MANEUVERS[id];
    if (!maneuver) throw new Error(`Unknown Mario maneuver: ${id}`);
    if (
      maneuver.hold !== undefined &&
      !game.player.onGround &&
      game.player.coyote <= 0
    )
      return false;
    this.active = {
      id,
      startedAt: game.time,
      airborne: !game.player.onGround,
      expiresAt: game.time + (maneuver.duration ?? 1.8),
    };
    if (maneuver.hold !== undefined) {
      this.rearm = game.control.jump;
      this.jumpUntil =
        game.time + maneuver.hold + (this.rearm ? FIXED_STEP : 0);
      this.jumpStarted = false;
    }
    return true;
  }

  choose(id, game, { forced = false } = {}) {
    if (!Object.hasOwn(MANEUVERS, id))
      throw new Error(`Unknown Mario maneuver: ${String(id)}`);
    const prediction = forecastManeuver(game, id, { executor: this });
    if (!prediction.safe) {
      this.rejectedSelections++;
      this.lastReason = prediction.reason;
      // A stale choice never silently turns into another forward maneuver.
      // Retain the previously validated maneuver, even on the ground: braking
      // earlier than planned can let an enemy catch a character escaping it.
      if (!this.active) {
        this.begin('brake', game);
        this.safetyInterventions++;
      }
      return { accepted: false, reason: prediction.reason, forced: false };
    }
    this.begin(id, game);
    this.acceptedSelections++;
    if (forced) this.forcedSelections++;
    this.lastReason = '';
    return { accepted: true, reason: '', forced };
  }

  control(game, _dt = FIXED_STEP) {
    if (game.over) return { ...BRAKE };
    const player = game.player;
    let active = this.active;
    if (active) {
      if (!player.onGround) active.airborne = true;
      const maneuver = MANEUVERS[active.id];
      const landed =
        maneuver.hold !== undefined && active.airborne && player.onGround;
      if (game.time + 1e-9 >= active.expiresAt || landed) {
        this.active = active = null;
        this.waitingStops++;
      }
    }
    const maneuver = active ? MANEUVERS[active.id] : BRAKE;
    let jump = false;
    if (this.rearm) {
      this.rearm = false;
    } else if (
      game.time < this.jumpUntil &&
      (!this.jumpStarted || player.vy > 0)
    ) {
      jump = true;
      this.jumpStarted = true;
    }
    return { direction: maneuver.direction, speed: maneuver.speed, jump };
  }

  snapshot() {
    return {
      maneuver: this.active?.id ?? 'waiting',
      acceptedSelections: this.acceptedSelections,
      rejectedSelections: this.rejectedSelections,
      safetyInterventions: this.safetyInterventions,
      forcedSelections: this.forcedSelections,
      waitingStops: this.waitingStops,
      lastReason: this.lastReason,
    };
  }
}

function simulate(game, executor, duration) {
  const count = Math.ceil(duration / FIXED_STEP);
  for (let step = 0; step < count && !game.over; step++) {
    game.applyControl(executor.control(game), 'forecast');
    game.update(FIXED_STEP);
  }
}

export function forecastManeuver(game, id, { executor, horizon = 1.6 } = {}) {
  if (!Object.hasOwn(MANEUVERS, id))
    throw new Error(`Unknown Mario maneuver: ${String(id)}`);
  const simulation = cloneMarioGame(game);
  const controller = executor?.clone() ?? new ManeuverExecutor();
  const startX = game.player.x;
  if (game.over || !controller.begin(id, simulation))
    return {
      id,
      safe: false,
      reason: game.over ? 'level ended' : 'jump requires takeoff support',
      progress: 0,
      duration: 0,
      landing: false,
    };
  const duration = Math.max(1.6, Math.min(2.2, horizon));
  simulate(simulation, controller, duration);
  const damage = simulation.events.some((event) => event.type === 'damage');
  const landing = simulation.won || simulation.player.onGround;
  const safe = !simulation.dead && !damage && landing;
  return {
    id,
    safe,
    reason: simulation.dead
      ? simulation.reason
      : damage
        ? 'enemy damage'
        : !landing
          ? 'no supported landing in forecast'
          : '',
    progress: round(simulation.player.x - startX),
    duration: round(simulation.time - game.time),
    landing,
    landingX: round(simulation.player.x),
    landingY: round(simulation.player.y),
    won: simulation.won,
  };
}

export function planManeuvers(
  game,
  { latencySeconds = 0.12, executor, maxOptions = 6 } = {},
) {
  const latency = Math.max(0, Math.min(0.5, Number(latencySeconds) || 0));
  const projected = cloneMarioGame(game);
  const continuation = executor?.clone() ?? new ManeuverExecutor();
  simulate(projected, continuation, latency);
  const candidates = ids.map((id) =>
    forecastManeuver(projected, id, { executor: continuation }),
  );
  const safe = candidates.filter((candidate) => candidate.safe);
  const options = safe.slice(0, Math.max(1, Math.min(7, maxOptions)));
  return {
    options,
    candidates,
    forced: safe.length === 1,
    latencySeconds: latency,
    actor: {
      x: round(game.player.x),
      y: round(game.player.y),
      vx: round(game.player.vx),
      vy: round(game.player.vy),
      grounded: game.player.onGround,
    },
    projected: {
      x: round(projected.player.x),
      y: round(projected.player.y),
      grounded: projected.player.onGround,
      dead: projected.dead,
    },
    horizonSeconds: 1.6,
  };
}
