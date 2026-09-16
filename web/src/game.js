import { UNIT_IDS, guardAction, validateDecision } from './contract.js';
export const COLORS = ['#efaf55', '#91c49e', '#8caecf'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export class Game {
  constructor() {
    this.reset();
  }
  reset() {
    this.time = 0;
    this.cores = 0;
    this.ticks = 0;
    this.running = false;
    this.base = { x: 6, y: 10 };
    this.sources = [
      { x: 2, y: 3, stock: 4 },
      { x: 6, y: 1, stock: 4 },
      { x: 10, y: 3, stock: 4 },
    ];
    this.units = UNIT_IDS.map((id, i) => ({
      id,
      x: 5 + i,
      y: 10,
      health: 100,
      carrying: false,
      action: 'hold',
      proposed: 'hold',
      reason: null,
      color: COLORS[i],
      source: i,
      trail: [],
    }));
    this.extraHazards = [];
  }
  hazards() {
    return [
      { x: 4 + Math.sin(this.time * 0.2) * 1.2, y: 5.2 },
      { x: 8, y: 5.4 + Math.cos(this.time * 0.15) },
      ...this.extraHazards,
    ];
  }
  danger(unit) {
    return this.hazards().some((h) => distance(h, unit) < 1.7);
  }
  addHazard() {
    const u = this.units[this.extraHazards.length % 3];
    this.extraHazards.push({ x: u.x + 0.65, y: u.y - 0.7 });
    if (this.extraHazards.length > 3) this.extraHazards.shift();
  }
  state() {
    return Object.fromEntries(
      this.units.map((u) => [
        u.id,
        {
          health: Math.round(u.health),
          carrying_core: u.carrying,
          in_danger: this.danger(u),
          beacon_has_supplies: this.sources[u.source].stock > 0,
          at_base: distance(u, this.base) < 1.1,
        },
      ]),
    );
  }
  apply(decision) {
    validateDecision(decision);
    for (const u of this.units) {
      u.proposed = decision[u.id];
      const guarded = guardAction(
        u,
        u.proposed,
        this.sources[u.source],
        this.danger(u),
      );
      u.action = guarded.action;
      u.reason = guarded.reason;
    }
    this.ticks++;
  }
  scripted(mission) {
    return Object.fromEntries(
      this.units.map((u) => [
        u.id,
        /hold/i.test(mission)
          ? 'hold'
          : u.carrying || u.health < 55
            ? 'return'
            : this.danger(u)
              ? 'evade'
              : 'recover',
      ]),
    );
  }
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    for (const u of this.units) {
      const source = this.sources[u.source];
      const danger = this.danger(u);
      const guard = guardAction(u, u.proposed, source, danger);
      u.action = guard.action;
      u.reason = guard.reason;
      if (danger) u.health = Math.max(1, u.health - dt * 7);
      if (distance(u, this.base) < 1.1) {
        u.health = Math.min(100, u.health + dt * 16);
        if (u.carrying) {
          u.carrying = false;
          this.cores++;
        }
      }
      let target = null;
      if (u.action === 'recover') target = source;
      if (u.action === 'return') target = this.base;
      if (u.action === 'evade') {
        const h = this.hazards().toSorted(
          (a, b) => distance(u, a) - distance(u, b),
        )[0];
        const dx = u.x - h.x,
          dy = u.y - h.y,
          len = Math.hypot(dx, dy) || 1;
        target = {
          x: Math.max(1, Math.min(11, u.x + (dx / len) * 2)),
          y: Math.max(1, Math.min(10.7, u.y + (dy / len) * 2)),
        };
      }
      if (target) {
        const d = distance(u, target);
        if (d > 0.18) {
          const step = Math.min(d, dt * 1.05);
          u.x += ((target.x - u.x) / d) * step;
          u.y += ((target.y - u.y) / d) * step;
        }
      }
      if (
        u.action === 'recover' &&
        distance(u, source) < 0.5 &&
        !u.carrying &&
        source.stock
      ) {
        source.stock--;
        u.carrying = true;
      }
      u.trail.push({ x: u.x, y: u.y });
      if (u.trail.length > 30) u.trail.shift();
    }
  }
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.w / 840, this.h / 510);
  }
  iso(x, y, z = 0) {
    return {
      x: this.w / 2 + (x - y) * 28 * this.scale,
      y: this.h * 0.23 + (x + y) * 14 * this.scale - z * this.scale,
    };
  }
  diamond(x, y, size, fill, stroke, z = 0) {
    const c = this.ctx,
      p = this.iso(x, y, z),
      w = size * 28 * this.scale,
      h = size * 14 * this.scale;
    c.beginPath();
    c.moveTo(p.x, p.y - h);
    c.lineTo(p.x + w, p.y);
    c.lineTo(p.x, p.y + h);
    c.lineTo(p.x - w, p.y);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  box(x, y, size, height, color) {
    const c = this.ctx,
      p = this.iso(x, y),
      w = size * 28 * this.scale,
      h = size * 14 * this.scale,
      z = height * this.scale;
    c.fillStyle = '#162122';
    c.beginPath();
    c.moveTo(p.x - w, p.y);
    c.lineTo(p.x, p.y + h);
    c.lineTo(p.x, p.y + h - z);
    c.lineTo(p.x - w, p.y - z);
    c.closePath();
    c.fill();
    c.fillStyle = '#263333';
    c.beginPath();
    c.moveTo(p.x, p.y + h);
    c.lineTo(p.x + w, p.y);
    c.lineTo(p.x + w, p.y - z);
    c.lineTo(p.x, p.y + h - z);
    c.closePath();
    c.fill();
    this.diamond(x, y, size, color, '#47554e', height);
  }
  text(text, p, color = '#a7b0a6', size = 10) {
    const c = this.ctx;
    c.font = `${size}px "Courier New",monospace`;
    c.fillStyle = color;
    c.textAlign = 'center';
    c.fillText(text, p.x, p.y);
  }
  draw(now) {
    const c = this.ctx,
      g = this.game;
    c.clearRect(0, 0, this.w, this.h);
    const glow = c.createRadialGradient(
      this.w * 0.5,
      this.h * 0.5,
      0,
      this.w * 0.5,
      this.h * 0.5,
      this.w * 0.65,
    );
    glow.addColorStop(0, '#23302b');
    glow.addColorStop(1, '#111918');
    c.fillStyle = glow;
    c.fillRect(0, 0, this.w, this.h);
    for (let sum = 0; sum < 25; sum++)
      for (let x = 0; x < 13; x++) {
        const y = sum - x;
        if (y < 0 || y >= 13) continue;
        const border = x === 0 || y === 0 || x === 12 || y === 12;
        this.diamond(
          x,
          y,
          1,
          border
            ? '#182321'
            : (x * 7 + y * 11) % 5 === 0
              ? '#293730'
              : '#24312c',
          '#304038',
        );
      }
    for (const [x, y, z] of [
      [0, 1, 18],
      [1, 0, 14],
      [11, 1, 28],
      [12, 2, 18],
      [1, 10, 17],
      [11, 11, 14],
      [3, 0, 12],
      [12, 9, 24],
    ])
      this.box(x, y, 0.65, z, '#384639');
    this.diamond(g.base.x, g.base.y, 1.8, '#254039', '#6c9883');
    this.box(g.base.x, g.base.y, 0.65, 12, '#50665a');
    this.text('BASE', this.iso(g.base.x, g.base.y, 29), '#abc3a8', 11);
    g.sources.forEach((s, i) => {
      this.diamond(s.x, s.y, 1.15, '#2f3931', COLORS[i]);
      this.box(s.x, s.y, 0.5, 25, '#4a5140');
      const p = this.iso(s.x, s.y, 34 + Math.sin(now * 0.002 + i) * 3);
      c.fillStyle = COLORS[i];
      c.shadowColor = COLORS[i];
      c.shadowBlur = 16 * this.scale;
      c.fillRect(
        p.x - 3 * this.scale,
        p.y - 8 * this.scale,
        6 * this.scale,
        10 * this.scale,
      );
      c.shadowBlur = 0;
      this.text(
        String(s.stock).padStart(2, '0') + ' CORES',
        this.iso(s.x, s.y, 52),
        COLORS[i],
        10,
      );
    });
    for (const h of g.hazards()) {
      const p = this.iso(h.x, h.y);
      c.save();
      c.translate(p.x, p.y);
      c.scale(1, 0.5);
      c.fillStyle = '#bd695526';
      c.strokeStyle = '#c8755c88';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(0, 0, 43 * this.scale, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
      this.box(h.x, h.y, 0.26, 12, '#b26851');
      const q = this.iso(h.x, h.y, 25);
      this.text('!', q, '#f0a17e', 15);
    }
    for (const u of g.units.toSorted((a, b) => a.x + a.y - (b.x + b.y))) {
      if (u.trail.length) {
        c.beginPath();
        u.trail.forEach((t, i) => {
          const p = this.iso(t.x, t.y);
          i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y);
        });
        c.strokeStyle = u.color + '40';
        c.lineWidth = 3 * this.scale;
        c.stroke();
      }
      const p = this.iso(u.x, u.y);
      c.fillStyle = '#0006';
      c.beginPath();
      c.ellipse(p.x, p.y, 9 * this.scale, 4 * this.scale, 0, 0, Math.PI * 2);
      c.fill();
      this.box(u.x, u.y, 0.22, 11, u.color);
      const head = this.iso(u.x, u.y, 17);
      c.fillStyle = '#dddcc8';
      c.fillRect(
        head.x - 3 * this.scale,
        head.y - 4 * this.scale,
        6 * this.scale,
        6 * this.scale,
      );
      c.strokeStyle = u.color;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(
        p.x,
        p.y + 2 * this.scale,
        12 * this.scale,
        6 * this.scale,
        0,
        0,
        Math.PI * 2,
      );
      c.stroke();
      this.text(u.id.toUpperCase(), this.iso(u.x, u.y, 33), u.color, 10);
      if (u.carrying) {
        c.fillStyle = '#f5cf74';
        c.fillRect(
          p.x + 6 * this.scale,
          p.y - 21 * this.scale,
          5 * this.scale,
          5 * this.scale,
        );
      }
    }
    for (let i = 0; i < 16; i++) {
      const t = now * 0.00004 + i * 1.7;
      const x = (Math.sin(i * 9.3) * 0.5 + 0.5) * this.w,
        y = (t * 18) % this.h;
      c.fillStyle = '#c5d1ae18';
      c.fillRect(x, y, 1.5, 1.5);
    }
  }
}
