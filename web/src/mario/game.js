import { LEVEL } from './level.js';
import { validateControl } from './contract.js';

export const FIXED_STEP = 1 / 120;
export const GRAVITY = 26;
export const JUMP_SPEED = 15.3;
export const WALK_SPEED = 4.5;
export const RUN_SPEED = 8.4;
const EPSILON = 1e-7;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = (value) => Number(value.toFixed(2));
const horizontalOverlap = (a, b) =>
  a.x + a.w > b.x + EPSILON && a.x < b.x + b.w - EPSILON;
const overlap = (a, b) =>
  horizontalOverlap(a, b) &&
  a.y + a.h > b.y + EPSILON &&
  a.y < b.y + b.h - EPSILON;

export class MarioGame {
  constructor({ level = LEVEL } = {}) {
    this.level = level;
    this.reset();
  }

  reset({ lives = 3 } = {}) {
    this.running = false;
    this.time = 0;
    this.timeRemaining = 400;
    this.coins = 0;
    this.score = 0;
    this.lives = lives;
    this.won = false;
    this.dead = false;
    this.over = false;
    this.status = 'ready';
    this.reason = '';
    this.accumulator = 0;
    this.control = { direction: 'still', jump: false, speed: 'walk' };
    this.controlSource = 'ready';
    this.lastControlAt = null;
    this.jumpBuffer = 0;
    this.maxX = this.level.spawn.x;
    this.events = [];
    this.effects = [];
    this.eventSequence = 0;
    this.itemSequence = 0;
    this.solids = this.level.solids.map((solid) => ({
      ...solid,
      bump: 0,
      used: false,
      broken: false,
    }));
    this.enemies = this.level.enemies.map((enemy) => ({
      ...enemy,
      alive: true,
      active: false,
      onGround: false,
      squashed: false,
      deadAge: 0,
    }));
    this.items = [];
    this.player = {
      x: this.level.spawn.x,
      y: this.level.spawn.y,
      w: 0.72,
      h: 0.94,
      vx: 0,
      vy: 0,
      onGround: true,
      coyote: 0.08,
      power: 'small',
      facing: 1,
      invincible: 0,
      dead: false,
      animation: 'idle',
    };
    return this;
  }

  get blocks() {
    return this.solids.filter((solid) => solid.type !== 'ground');
  }

  restart() {
    return this.reset({ lives: this.lives > 0 ? this.lives : 3 });
  }

  event(type, message, detail = {}) {
    this.events.push({
      id: ++this.eventSequence,
      type,
      message,
      time: this.time,
      ...detail,
    });
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
  }

  applyControl(control, source = 'model') {
    validateControl(control);
    if (this.over)
      throw new Error('Restart the level before applying controls');
    const changed =
      source !== this.controlSource ||
      Object.keys(control).some((key) => control[key] !== this.control[key]);
    if (control.jump && !this.control.jump) this.jumpBuffer = 0.13;
    this.control = { ...control };
    this.controlSource = source;
    this.lastControlAt = this.time;
    if (changed)
      this.event(
        'control',
        `${control.direction} · ${control.jump ? 'jump held' : 'jump released'} · ${control.speed}`,
        { control: { ...control }, source },
      );
    return this.control;
  }

  update(dt) {
    if (!this.running || this.over || !Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(0.25, dt);
    while (this.accumulator + 1e-10 >= FIXED_STEP && !this.over) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
  }

  moveBody(body, dt, hitBlock = false) {
    const previousX = body.x;
    const previousY = body.y;
    const vx = body.vx;
    const vy = body.vy;
    let hitX = false;
    body.x += vx * dt;
    for (const solid of this.solids) {
      if (solid.broken || !overlap(body, solid)) continue;
      if (vx > 0 && previousX + body.w <= solid.x + EPSILON) {
        body.x = Math.min(body.x, solid.x - body.w);
        hitX = true;
      } else if (vx < 0 && previousX >= solid.x + solid.w - EPSILON) {
        body.x = Math.max(body.x, solid.x + solid.w);
        hitX = true;
      }
    }
    if (hitX) body.vx = 0;
    body.y += vy * dt;
    body.onGround = false;
    const headBlocks = [];
    for (const solid of this.solids) {
      if (solid.broken || !horizontalOverlap(body, solid)) continue;
      const top = solid.y + solid.h;
      if (
        vy <= 0 &&
        previousY >= top - EPSILON &&
        body.y <= top &&
        body.y + body.h > solid.y
      ) {
        body.y = top;
        body.vy = 0;
        body.onGround = true;
      } else if (
        vy > 0 &&
        previousY + body.h <= solid.y + EPSILON &&
        body.y + body.h >= solid.y &&
        body.y < top
      ) {
        body.y = solid.y - body.h;
        body.vy = 0;
        if (hitBlock) headBlocks.push(solid);
      }
    }
    if (headBlocks.length) {
      // One block per head impact, selected by actual horizontal overlap.
      headBlocks.sort(
        (a, b) =>
          Math.abs(a.x + a.w / 2 - (body.x + body.w / 2)) -
          Math.abs(b.x + b.w / 2 - (body.x + body.w / 2)),
      );
      this.hitBlock(headBlocks[0]);
    }
    return { hitX, previousY };
  }

  hitBlock(block) {
    if (
      !['brick', 'question'].includes(block.type) ||
      block.used ||
      block.broken
    )
      return;
    block.bump = 0.18;
    if (block.type === 'brick' && this.player.power === 'big') {
      block.broken = true;
      this.score += 50;
      for (let i = 0; i < 4; i++)
        this.effects.push({
          type: 'brick',
          x: block.x + (i % 2) * 0.5,
          y: block.y + Math.floor(i / 2) * 0.5,
          w: 0.45,
          h: 0.45,
          vx: i % 2 ? 2.5 : -2.5,
          vy: i < 2 ? 5 : 8,
          life: 0.9,
        });
      this.event('brick', 'Broke a brick', { blockId: block.id });
    } else if (block.type === 'question') {
      block.used = true;
      if (block.content === 'mushroom') {
        this.items.push({
          id: `mushroom-${++this.itemSequence}`,
          type: 'mushroom',
          x: block.x + 0.08,
          y: block.y + block.h - 0.85,
          baseY: block.y + block.h - 0.85,
          w: 0.84,
          h: 0.85,
          vx: 1.7,
          vy: 0,
          alive: true,
          emerging: 0.6,
          age: 0,
          onGround: false,
        });
        this.event('mushroom', 'A mushroom emerged', { blockId: block.id });
      } else {
        this.coins++;
        this.score += 200;
        this.effects.push({
          type: 'coin',
          x: block.x + 0.3,
          y: block.y + 1,
          w: 0.4,
          h: 0.65,
          vx: 0,
          vy: 6,
          life: 0.65,
        });
        this.event('coin', 'Collected a block coin', {
          coins: this.coins,
          blockId: block.id,
        });
      }
    } else this.event('bump', 'Bumped a brick', { blockId: block.id });
    for (const enemy of this.enemies) {
      if (
        enemy.alive &&
        horizontalOverlap(enemy, block) &&
        Math.abs(enemy.y - (block.y + block.h)) < 0.1
      )
        this.defeatEnemy(enemy, 'block');
    }
  }

  defeatEnemy(enemy, reason) {
    if (!enemy.alive) return;
    enemy.alive = false;
    enemy.squashed = true;
    enemy.deadAge = 0;
    enemy.vx = 0;
    this.score += 100;
    this.effects.push({
      type: 'score',
      x: enemy.x,
      y: enemy.y + 1,
      value: 100,
      vx: 0,
      vy: 1.2,
      life: 0.7,
    });
    this.event(
      'stomp',
      `Defeated a Goomba ${reason === 'stomp' ? 'from above' : 'with a block'}`,
      { enemyId: enemy.id, reason },
    );
  }

  hurt(reason) {
    const player = this.player;
    if (this.over || player.invincible > 0) return;
    if (player.power === 'big') {
      player.power = 'small';
      player.h = 0.94;
      player.invincible = 1.7;
      this.event('damage', 'Lost mushroom power', { reason });
    } else this.die(reason);
  }

  die(reason) {
    if (this.over) return;
    this.dead = true;
    this.over = true;
    this.running = false;
    this.status = 'dead';
    this.reason = reason;
    this.lives = Math.max(0, this.lives - 1);
    this.player.dead = true;
    this.player.animation = 'dead';
    this.event('death', reason, { lives: this.lives });
  }

  win() {
    if (this.over) return;
    this.won = true;
    this.over = true;
    this.running = false;
    this.status = 'won';
    this.reason = 'Reached the flag';
    this.score += 1000 + Math.ceil(this.timeRemaining) * 10;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.animation = 'victory';
    this.event('win', 'World 1-1 cleared', {
      score: this.score,
      time: this.time,
    });
  }

  step(dt) {
    this.status = 'playing';
    this.time += dt;
    this.timeRemaining = Math.max(0, 400 - this.time);
    if (this.timeRemaining <= 0) {
      this.die('Time ran out');
      return;
    }
    const player = this.player;
    player.invincible = Math.max(0, player.invincible - dt);
    player.coyote = player.onGround ? 0.08 : Math.max(0, player.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const direction =
      this.control.direction === 'left'
        ? -1
        : this.control.direction === 'right'
          ? 1
          : 0;
    const target =
      direction * (this.control.speed === 'run' ? RUN_SPEED : WALK_SPEED);
    const acceleration = player.onGround ? (direction ? 45 : 55) : 24;
    player.vx += clamp(
      target - player.vx,
      -acceleration * dt,
      acceleration * dt,
    );
    if (direction) player.facing = direction;
    if (this.jumpBuffer > 0 && player.coyote > 0) {
      player.vy = JUMP_SPEED;
      player.onGround = false;
      player.coyote = 0;
      this.jumpBuffer = 0;
      this.event('jump', 'Jumped', { x: player.x, y: player.y });
    }
    if (!this.control.jump && player.vy > 5.8) player.vy = 5.8;
    player.vy = Math.max(-20, player.vy - GRAVITY * dt);
    const motion = this.moveBody(player, dt, true);
    player.x = clamp(player.x, 0, this.level.width - player.w);
    this.maxX = Math.max(this.maxX, player.x);
    if (player.y < -3) {
      this.die('Fell into a pit');
      return;
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        enemy.deadAge += dt;
        continue;
      }
      if (!enemy.active && enemy.x < player.x + 21 && enemy.x > player.x - 3)
        enemy.active = true;
      if (!enemy.active) continue;
      const vx = enemy.vx;
      enemy.vy = Math.max(-18, enemy.vy - GRAVITY * dt);
      const collision = this.moveBody(enemy, dt);
      if (collision.hitX) enemy.vx = -vx;
      if (enemy.y < -4 || enemy.x < player.x - 35) {
        enemy.alive = false;
        continue;
      }
      if (overlap(player, enemy)) {
        if (motion.previousY >= enemy.y + enemy.h - 0.12 && player.vy < 0) {
          this.defeatEnemy(enemy, 'stomp');
          player.y = enemy.y + enemy.h;
          player.vy = this.control.jump ? 10 : 7;
          player.onGround = false;
        } else this.hurt('Touched a Goomba from the side');
      }
      if (this.over) return;
    }

    for (const item of this.items) {
      if (!item.alive) continue;
      item.age += dt;
      if (item.emerging > 0) {
        item.emerging = Math.max(0, item.emerging - dt);
        item.y = item.baseY + item.h * (1 - item.emerging / 0.6);
        continue;
      }
      const vx = item.vx;
      item.vy = Math.max(-18, item.vy - GRAVITY * dt);
      const collision = this.moveBody(item, dt);
      if (collision.hitX) item.vx = -vx;
      if (overlap(player, item)) {
        item.alive = false;
        player.power = 'big';
        const tall = { ...player, h: 1.78 };
        if (!this.solids.some((solid) => !solid.broken && overlap(tall, solid)))
          player.h = 1.78;
        this.score += 1000;
        this.effects.push({
          type: 'growth',
          x: player.x,
          y: player.y + player.h,
          value: 1000,
          vx: 0,
          vy: 0.8,
          life: 0.8,
        });
        this.event('power', 'Mushroom collected: Super Mario', {
          power: 'big',
        });
      }
      if (item.y < -4 || item.age > 40 || item.x < player.x - 35)
        item.alive = false;
    }
    if (player.power === 'big' && player.h < 1.78) {
      const tall = { ...player, h: 1.78 };
      if (!this.solids.some((solid) => !solid.broken && overlap(tall, solid)))
        player.h = 1.78;
    }
    for (const block of this.solids) block.bump = Math.max(0, block.bump - dt);
    for (const effect of this.effects) {
      effect.life -= dt;
      effect.x += (effect.vx || 0) * dt;
      effect.y += (effect.vy || 0) * dt;
      if (effect.type === 'brick' || effect.type === 'coin')
        effect.vy -= 16 * dt;
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
    player.animation = !player.onGround
      ? 'jump'
      : Math.abs(player.vx) > 0.15
        ? 'run'
        : 'idle';
    if (
      player.x + player.w >= this.level.goal.flagX &&
      player.y + player.h >= this.level.groundY
    )
      this.win();
  }

  observe() {
    const p = this.player;
    const visibleSolids = this.solids.filter(
      (solid) =>
        !solid.broken &&
        solid.type !== 'ground' &&
        solid.x + solid.w > p.x - 2 &&
        solid.x < p.x + 16,
    );
    const obstacles = visibleSolids
      .filter(
        (solid) =>
          solid.x + solid.w > p.x + p.w &&
          solid.y < p.y + p.h - 0.05 &&
          solid.y + solid.h > p.y + 0.15,
      )
      .sort((a, b) => a.x - b.x || b.h - a.h);
    const nextObstacle = obstacles[0];
    const overhead = this.solids
      .filter(
        (solid) =>
          !solid.broken &&
          horizontalOverlap(p, solid) &&
          solid.y >= p.y + p.h - EPSILON,
      )
      .sort((a, b) => a.y - b.y)[0];
    const gaps = this.level.pits.filter(
      (gap) => gap.x + gap.w > p.x && gap.x < p.x + 20,
    );
    const nextGap = gaps[0];
    const enemies = this.enemies.filter(
      (enemy) => enemy.alive && enemy.x > p.x - 3 && enemy.x < p.x + 16,
    );
    const nearestEnemy = [...enemies].sort(
      (a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x),
    )[0];
    return {
      level: this.level.id,
      status: this.status,
      timeRemaining: rounded(this.timeRemaining),
      coins: this.coins,
      self: {
        x: rounded(p.x),
        y: rounded(p.y),
        vx: rounded(p.vx),
        vy: rounded(p.vy),
        w: p.w,
        h: p.h,
        onGround: p.onGround,
        power: p.power,
        jumpHeld: this.control.jump,
        control: { ...this.control },
      },
      goal: {
        flagX: this.level.goal.flagX,
        distanceX: rounded(Math.max(0, this.level.goal.flagX - p.x)),
      },
      geometry: {
        groundTopY: this.level.groundY,
        nextObstacle: nextObstacle
          ? {
              type: nextObstacle.type,
              dx: rounded(nextObstacle.x - p.x - p.w),
              width: nextObstacle.w,
              topY: nextObstacle.y + nextObstacle.h,
              heightAboveFeet: rounded(nextObstacle.y + nextObstacle.h - p.y),
            }
          : null,
        overheadBlock: overhead
          ? {
              id: overhead.id,
              type: overhead.type,
              clearance: rounded(overhead.y - p.y - p.h),
              content: overhead.used ? null : overhead.content,
              used: overhead.used,
            }
          : null,
        nextGap: nextGap
          ? { distance: rounded(nextGap.x - p.x - p.w), width: nextGap.w }
          : null,
        nearestEnemy: nearestEnemy
          ? {
              dx: rounded(nearestEnemy.x - p.x - p.w),
              dy: rounded(nearestEnemy.y - p.y),
              vx: nearestEnemy.vx,
            }
          : null,
      },
      nearby: {
        solids: visibleSolids.slice(0, 14).map((solid) => ({
          id: solid.id,
          type: solid.type,
          dx: rounded(solid.x - p.x),
          dy: rounded(solid.y - p.y),
          w: solid.w,
          h: solid.h,
          topY: solid.y + solid.h,
          used: solid.used,
        })),
        gaps: gaps.map((gap) => ({ dx: rounded(gap.x - p.x), width: gap.w })),
        enemies: enemies.map((enemy) => ({
          id: enemy.id,
          type: enemy.type,
          dx: rounded(enemy.x - p.x),
          dy: rounded(enemy.y - p.y),
          vx: enemy.vx,
          w: enemy.w,
          h: enemy.h,
        })),
        items: this.items
          .filter((item) => item.alive && Math.abs(item.x - p.x) < 16)
          .map((item) => ({
            type: item.type,
            dx: rounded(item.x - p.x),
            dy: rounded(item.y - p.y),
          })),
      },
      units: {
        position: 'tiles; x right, y up; entity origin bottom-left',
        velocity: 'tiles/second',
        time: 'seconds',
      },
    };
  }

  scriptedAction() {
    const p = this.player;
    const { geometry } = this.observe();
    if (this.over) return { direction: 'still', jump: false, speed: 'walk' };
    const obstacle = geometry.nextObstacle;
    const ahead = this.enemies
      .filter(
        (e) =>
          e.alive &&
          e.x + e.w > p.x &&
          e.x < p.x + 6 &&
          Math.abs(e.y - p.y) < 3,
      )
      .sort((a, b) => a.x - b.x)[0];
    const enemy = ahead
      ? { dx: ahead.x - p.x - p.w, dy: ahead.y - p.y, vx: ahead.vx }
      : null;
    const gap = geometry.nextGap;
    let jump = !p.onGround && p.vy > 0;
    if (p.onGround && !this.control.jump) {
      const obstacleThreshold = obstacle
        ? Math.max(1.2, obstacle.heightAboveFeet * 1.03)
        : 0;
      jump = Boolean(
        (obstacle && obstacle.dx < obstacleThreshold && obstacle.dx > -0.05) ||
          (gap && gap.distance < 2.5 && gap.distance > -0.8) ||
          (enemy &&
            enemy.dx > -0.7 &&
            enemy.dx < 2.2 &&
            Math.abs(enemy.dy) < 1),
      );
    }
    const brakingForLanding =
      !p.onGround &&
      p.vy < 0 &&
      enemy &&
      enemy.dx > 0.05 &&
      enemy.dx < 5 &&
      p.y < ahead.y + ahead.h + 2.8;
    const landingBeforeGap =
      !p.onGround &&
      p.vy < 0 &&
      gap &&
      gap.distance < 3.3 &&
      gap.distance > -0.7 &&
      p.y > this.level.groundY + 1.2;
    return {
      direction: brakingForLanding
        ? 'left'
        : landingBeforeGap
          ? 'still'
          : 'right',
      jump,
      speed: 'run',
    };
  }

  summary() {
    return {
      level: this.level.id,
      time: this.time,
      timeRemaining: this.timeRemaining,
      status: this.status,
      won: this.won,
      dead: this.dead,
      reason: this.reason,
      x: this.player.x,
      progress: clamp(this.maxX / this.level.goal.flagX, 0, 1),
      coins: this.coins,
      score: this.score,
      lives: this.lives,
      power: this.player.power,
      defeatedEnemies: this.enemies.filter((enemy) => enemy.squashed).length,
    };
  }
}
