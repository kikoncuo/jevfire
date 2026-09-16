// Original, code-drawn pixel artwork. No ROM sprites, textures, or image CDN.
const TILE = 32;
const WIDTH = 960;
const HEIGHT = 448;
const PALETTE = {
  ink: '#3c2936',
  sky: '#83bcf4',
  lightSky: '#b2dcfa',
  cloud: '#fff6dc',
  cloudShade: '#d8eafa',
  brick: '#d07341',
  brickLight: '#f2a456',
  brickDark: '#8d4637',
  gold: '#ffcf54',
  goldLight: '#fff29d',
  goldDark: '#d48332',
  red: '#e9473e',
  redDark: '#a52936',
  blue: '#326dc8',
  blueDark: '#244b89',
  skin: '#f8c499',
  hair: '#654032',
  shoe: '#56352f',
  green: '#42bd66',
  greenLight: '#9ce773',
  greenDark: '#23734f',
};

const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['110', '001', '111', '100', '111'],
  3: ['110', '001', '011', '001', '110'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '110', '001', '110'],
  6: ['011', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '110'],
  '+': ['000', '010', '111', '010', '000'],
};

function surface(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable on this device.');
  context.imageSmoothingEnabled = false;
  const fill = (color, x, y, w, h) => {
    context.fillStyle = color;
    context.fillRect(
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
    );
  };
  paint(context, fill);
  return canvas;
}

function groundTile() {
  return surface(TILE, TILE, (_ctx, fill) => {
    fill(PALETTE.brickDark, 0, 0, 32, 32);
    fill(PALETTE.ink, 0, 0, 32, 2);
    fill(PALETTE.brickLight, 0, 2, 32, 3);
    fill(PALETTE.brick, 2, 6, 28, 24);
    fill('#e38947', 3, 7, 15, 11);
    fill('#e48b4c', 20, 7, 9, 17);
    fill(PALETTE.brickDark, 17, 6, 3, 13);
    fill(PALETTE.brickDark, 3, 17, 16, 3);
    fill(PALETTE.brickDark, 8, 19, 3, 11);
    fill(PALETTE.brickDark, 19, 24, 11, 3);
    fill('#f3a656', 3, 7, 11, 2);
    fill('#f3a656', 21, 7, 6, 2);
    fill('#bd633d', 3, 28, 27, 2);
  });
}

function brickTile(castle = false) {
  return surface(TILE, TILE, (_ctx, fill) => {
    fill(PALETTE.ink, 0, 0, 32, 32);
    for (let row = 0; row < 3; row += 1) {
      const y = row * 10 + 1;
      const offset = row % 2 ? -8 : 0;
      for (let x = offset; x < 32; x += 16) {
        fill(castle ? '#c88152' : PALETTE.brick, x + 1, y, 14, 8);
        fill(castle ? '#e7ac71' : PALETTE.brickLight, x + 1, y, 14, 2);
        fill(castle ? '#986043' : PALETTE.brickDark, x + 1, y + 6, 14, 2);
      }
    }
    fill(PALETTE.brickDark, 0, 31, 32, 1);
  });
}

function questionTile(frame = 0, used = false) {
  return surface(TILE, TILE, (_ctx, fill) => {
    fill(PALETTE.ink, 1, 0, 30, 32);
    fill(PALETTE.ink, 0, 1, 32, 30);
    fill(used ? '#9b6b4f' : PALETTE.goldDark, 2, 2, 28, 28);
    fill(
      used ? '#bf946a' : [PALETTE.gold, '#f6bc48', '#e8aa3e'][frame],
      3,
      3,
      25,
      24,
    );
    fill(used ? '#d1a87d' : PALETTE.goldLight, 3, 3, 24, 2);
    fill(used ? '#d1a87d' : '#ffe788', 3, 3, 2, 24);
    for (const x of [5, 25]) {
      for (const y of [5, 25])
        fill(used ? '#7e5948' : PALETTE.goldDark, x, y, 2, 2);
    }
    if (used) return;
    const glyph = [
      '01110',
      '11011',
      '00011',
      '00110',
      '00100',
      '00000',
      '00100',
    ];
    glyph.forEach((row, y) =>
      [...row].forEach((pixel, x) => {
        if (pixel === '1') {
          fill(PALETTE.goldDark, 10 + x * 3, 7 + y * 3, 3, 3);
          fill(PALETTE.ink, 9 + x * 3, 6 + y * 3, 3, 3);
        }
      }),
    );
  });
}

function stairTile() {
  return surface(TILE, TILE, (_ctx, fill) => {
    fill(PALETTE.ink, 0, 0, 32, 32);
    fill('#db8b4d', 2, 2, 28, 28);
    fill('#f4b96b', 2, 2, 28, 4);
    fill('#efaa5d', 2, 5, 4, 24);
    fill('#a0543a', 27, 6, 3, 24);
    fill('#a0543a', 6, 27, 23, 3);
    fill('#d18047', 8, 8, 15, 15);
  });
}

function marioSprite(big, pose = 'idle') {
  const height = big ? 58 : 32;
  return surface(32, height, (_ctx, fill) => {
    const torsoY = 17;
    const hipY = big ? 36 : 24;
    const feetY = height - 4;
    const step = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0;
    const jump = pose === 'jump' || pose === 'dead';

    // An original red cap, wide nose, moustache and blue-overall silhouette.
    fill(PALETTE.redDark, 10, 0, 14, 8);
    fill(PALETTE.red, 9, 1, 15, 5);
    fill(PALETTE.red, 5, 5, 24, 3);
    fill('#fff0d9', 17, 2, 5, 4);
    fill(PALETTE.redDark, 18, 3, 1, 2);
    fill(PALETTE.redDark, 20, 3, 1, 2);
    fill(PALETTE.redDark, 19, 4, 1, 1);
    fill(PALETTE.hair, 7, 8, 9, 10);
    fill(PALETTE.skin, 13, 8, 13, 10);
    fill(PALETTE.skin, 11, 11, 4, 6);
    fill(PALETTE.skin, 24, 11, 6, 4);
    fill(PALETTE.ink, 22, 9, 2, 4);
    fill(PALETTE.hair, 18, 14, 11, 3);
    fill('#e6a57d', 14, 17, 10, 2);
    fill(PALETTE.redDark, 9, torsoY, 14, hipY - torsoY + 3);
    fill(PALETTE.red, 10, torsoY, 12, hipY - torsoY);
    const armY = jump ? torsoY - 4 : torsoY + 1 + step;
    fill(PALETTE.red, 5, armY, 5, big ? 13 : 7);
    fill(PALETTE.red, 23, jump ? 14 : torsoY + 2 - step, 4, big ? 12 : 5);
    fill('#fff1df', 4, armY + (big ? 10 : 5), 6, 5);
    fill('#fff1df', 24, jump ? 9 : hipY - 1 - step, 5, 5);
    fill(PALETTE.blueDark, 9, hipY, 15, 5);
    fill(PALETTE.blue, 10, hipY - 2, 13, 6);
    fill(PALETTE.blue, 12, torsoY + 2, 3, hipY - torsoY);
    fill(PALETTE.blue, 20, torsoY + 2, 3, hipY - torsoY);
    fill(PALETTE.goldLight, 12, hipY - 2, 2, 2);
    fill(PALETTE.goldLight, 20, hipY - 2, 2, 2);
    const leftFootY = jump ? feetY - 3 : feetY - Math.max(0, step) * 2;
    const rightFootY = jump ? feetY - 1 : feetY - Math.max(0, -step) * 2;
    const leftX = jump ? 6 : 8 - step * 2;
    const rightX = jump ? 20 : 18 + step * 2;
    fill(
      PALETTE.blueDark,
      leftX + 2,
      hipY + 3,
      6,
      Math.max(2, leftFootY - hipY - 1),
    );
    fill(PALETTE.blue, rightX, hipY + 3, 5, Math.max(2, rightFootY - hipY - 1));
    fill(PALETTE.shoe, leftX, leftFootY, 9, 4);
    fill(PALETTE.shoe, rightX, rightFootY, 9, 4);
    fill('#8b5340', leftX + 1, leftFootY, 7, 1);
    fill('#8b5340', rightX + 1, rightFootY, 7, 1);
  });
}

function goombaSprite(frame = 0) {
  return surface(32, 32, (_ctx, fill) => {
    fill(PALETTE.ink, 10, 2, 12, 3);
    fill(PALETTE.ink, 6, 5, 20, 4);
    fill(PALETTE.ink, 3, 9, 26, 6);
    fill(PALETTE.ink, 1, 15, 30, 7);
    fill('#a4603d', 9, 5, 14, 5);
    fill('#b56e42', 6, 9, 20, 10);
    fill('#cf8b51', 4, 14, 24, 7);
    fill('#edb577', 7, 21, 18, 7);
    fill('#fff2d5', 7, 12, 7, 8);
    fill('#fff2d5', 18, 12, 7, 8);
    fill(PALETTE.ink, 11, 13, 3, 7);
    fill(PALETTE.ink, 18, 13, 3, 7);
    fill(PALETTE.ink, 6, 10, 6, 2);
    fill(PALETTE.ink, 21, 10, 5, 2);
    fill('#fff2d5', 8, 23, 3, 3);
    fill('#fff2d5', 21, 23, 3, 3);
    fill(PALETTE.shoe, frame ? 3 : 5, 27, 10, 5);
    fill(PALETTE.shoe, frame ? 20 : 18, 27, 10, 5);
  });
}

function mushroomSprite() {
  return surface(32, 32, (_ctx, fill) => {
    fill(PALETTE.ink, 11, 1, 10, 3);
    fill(PALETTE.ink, 6, 4, 20, 4);
    fill(PALETTE.ink, 2, 8, 28, 10);
    fill(PALETTE.ink, 0, 15, 32, 6);
    fill(PALETTE.red, 9, 4, 14, 5);
    fill(PALETTE.red, 4, 8, 24, 10);
    fill(PALETTE.red, 2, 16, 28, 3);
    fill('#fff5e4', 12, 5, 8, 9);
    fill('#fff5e4', 3, 12, 6, 6);
    fill('#fff5e4', 24, 12, 5, 6);
    fill(PALETTE.ink, 8, 20, 16, 11);
    fill('#ffdfae', 10, 21, 12, 9);
    fill('#edb97e', 10, 28, 12, 2);
    fill(PALETTE.ink, 13, 22, 2, 4);
    fill(PALETTE.ink, 18, 22, 2, 4);
  });
}

function coinSprite(frame) {
  return surface(32, 32, (_ctx, fill) => {
    const widths = [16, 11, 5, 11];
    const width = widths[frame];
    const x = Math.floor((32 - width) / 2);
    fill(PALETTE.goldDark, x + 2, 3, Math.max(1, width - 4), 26);
    fill(PALETTE.goldDark, x, 6, width, 20);
    fill(PALETTE.gold, x + 2, 6, Math.max(1, width - 4), 20);
    fill(PALETTE.goldLight, x + 2, 7, Math.max(1, Math.floor(width / 4)), 16);
    if (width > 6) fill('#e5a536', x + width - 5, 9, 2, 14);
  });
}

function cloudSprite() {
  return surface(128, 64, (_ctx, fill) => {
    fill(PALETTE.cloudShade, 8, 30, 112, 26);
    fill(PALETTE.cloudShade, 26, 16, 32, 40);
    fill(PALETTE.cloudShade, 52, 6, 36, 48);
    fill(PALETTE.cloudShade, 88, 22, 24, 30);
    fill(PALETTE.cloud, 12, 26, 104, 24);
    fill(PALETTE.cloud, 29, 13, 27, 32);
    fill(PALETTE.cloud, 55, 3, 30, 42);
    fill(PALETTE.cloud, 87, 20, 22, 26);
    fill('#fffdf0', 58, 3, 24, 5);
    fill('#fffdf0', 31, 13, 18, 4);
  });
}

function hillSprite(width, height, near) {
  return surface(width, height, (_ctx, fill) => {
    const color = near ? '#51af83' : '#7fb99c';
    const light = near ? '#73cb91' : '#9bd0af';
    for (let y = 0; y < height; y += 8) {
      const ratio = y / height;
      const inset = Math.floor((width * (1 - Math.sqrt(ratio))) / 16) * 8;
      fill(color, inset, y, width - inset * 2, 8);
      if (inset + 8 < width / 2) fill(light, inset, y, 8, 8);
    }
    if (near) {
      fill('#348d6c', width * 0.44, height * 0.65, 5, 13);
      fill('#348d6c', width * 0.59, height * 0.65, 5, 13);
      fill('#429f78', width * 0.69, height * 0.82, 5, 8);
    }
  });
}

function bushSprite() {
  return surface(96, 32, (_ctx, fill) => {
    fill('#2d835d', 0, 17, 96, 15);
    fill('#2d835d', 10, 8, 26, 24);
    fill('#2d835d', 35, 0, 29, 32);
    fill('#2d835d', 62, 10, 25, 22);
    fill('#59c36e', 4, 18, 88, 10);
    fill('#59c36e', 13, 9, 20, 17);
    fill('#59c36e', 38, 2, 23, 24);
    fill('#59c36e', 65, 12, 19, 14);
    fill('#a4e580', 15, 9, 13, 3);
    fill('#a4e580', 40, 3, 15, 3);
    fill('#2d835d', 44, 16, 3, 6);
    fill('#2d835d', 54, 16, 3, 6);
  });
}

function makeAssets() {
  const mario = {};
  for (const size of ['small', 'big']) {
    for (const pose of ['idle', 'walk1', 'walk2', 'jump', 'dead']) {
      mario[`${size}:${pose}`] = marioSprite(size === 'big', pose);
    }
  }
  return {
    ground: groundTile(),
    brick: brickTile(),
    castle: brickTile(true),
    stair: stairTile(),
    used: questionTile(0, true),
    question: [0, 1, 2].map((frame) => questionTile(frame)),
    coin: [0, 1, 2, 3].map(coinSprite),
    goomba: [0, 1].map(goombaSprite),
    mushroom: mushroomSprite(),
    cloud: cloudSprite(),
    hillFar: hillSprite(224, 128, false),
    hillNear: hillSprite(160, 88, true),
    bush: bushSprite(),
    mario,
  };
}

/**
 * Canvas2D view of the simulation's Y-up, bottom-left tile coordinates.
 * The camera and artwork never change the game state or movement controls.
 */
export class MarioRenderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable on this device.');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.style.imageRendering = 'pixelated';
    this.assets = makeAssets();
    this.cameraPx = 0;
    this.cameraX = 0;
    this.lastTime = game.time || 0;
    this.winElapsed = 0;
    this.disposed = false;
    this.reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.sky = this.ctx.createLinearGradient(0, 0, 0, HEIGHT);
    this.sky.addColorStop(0, PALETTE.sky);
    this.sky.addColorStop(1, PALETTE.lightSky);
    this.render(0);
  }

  worldToScreen(x, y) {
    return {
      x: Math.round(x * TILE - this.cameraPx),
      y: Math.round(HEIGHT - y * TILE),
    };
  }

  get viewport() {
    return { x: this.cameraX, y: 0, w: WIDTH / TILE, h: HEIGHT / TILE };
  }

  visible(object, margin = 2) {
    return (
      object.x + (object.w ?? 1) >= this.cameraX - margin &&
      object.x <= this.cameraX + WIDTH / TILE + margin
    );
  }

  render(dt = 0) {
    if (this.disposed) return;
    const game = this.game;
    const player = game.player;
    if (!player) return;
    const elapsed = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    const time = Number.isFinite(game.time) ? game.time : 0;
    if (time < this.lastTime) {
      this.cameraPx = 0;
      this.winElapsed = 0;
    }
    if (game.won) this.winElapsed += elapsed;
    else this.winElapsed = 0;
    this.lastTime = time;
    const maxCamera = Math.max(0, (game.level?.width ?? 212) * TILE - WIDTH);
    const desired = Math.max(
      0,
      Math.min(maxCamera, (player.x + player.w / 2) * TILE - WIDTH * 0.3),
    );
    // Keep the early run anchored, then ease the player into the left third.
    // A reset or teleport snaps instead of sweeping across the whole level.
    if (Math.abs(desired - this.cameraPx) > WIDTH || elapsed === 0)
      this.cameraPx = desired;
    else
      this.cameraPx += (desired - this.cameraPx) * (1 - Math.exp(-elapsed * 7));
    this.cameraPx = Math.max(0, Math.min(maxCamera, this.cameraPx));
    this.cameraX = this.cameraPx / TILE;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    this.drawBackground();
    this.drawCastle();
    this.drawFlag();
    for (const item of game.items || []) {
      if (item.alive !== false && this.visible(item)) this.drawItem(item, time);
    }
    for (const solid of game.solids || game.level?.solids || []) {
      if (!solid.broken && this.visible(solid)) this.drawSolid(solid, time);
    }
    for (const enemy of game.enemies || []) {
      if (this.visible(enemy) && (enemy.alive !== false || enemy.squashed))
        this.drawEnemy(enemy, time);
    }
    this.drawMario(player, time);
    for (const effect of game.effects || []) {
      if (effect.life !== undefined && effect.life <= 0) continue;
      if (this.visible(effect)) this.drawEffect(effect, time);
    }
    ctx.globalAlpha = 1;
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const ground = HEIGHT - (this.game.level?.groundY ?? 1) * TILE;
    for (let i = -1; i < 4; i += 1) {
      const cloudX = Math.round(i * 370 + 78 - ((this.cameraPx * 0.14) % 370));
      const cloudY = [64, 102, 48, 82][((i % 4) + 4) % 4];
      ctx.drawImage(this.assets.cloud, cloudX, cloudY);
    }
    for (let i = -1; i < 4; i += 1) {
      const x = Math.round(i * 460 + 140 - ((this.cameraPx * 0.23) % 460));
      ctx.drawImage(this.assets.hillFar, x, ground - 128);
    }
    for (let i = -1; i < 5; i += 1) {
      const x = Math.round(i * 340 + 30 - ((this.cameraPx * 0.42) % 340));
      ctx.drawImage(this.assets.hillNear, x, ground - 88);
    }
    // Bushes sit at world positions and never obscure the walking surface.
    const first = Math.floor(this.cameraX / 18) - 1;
    for (let i = first; i < first + 4; i += 1) {
      const worldX = i * 18 + 7;
      const overlapsPit = (this.game.level?.pits || []).some(
        (pit) => worldX < pit.x + pit.w && worldX + 3 > pit.x,
      );
      if (!overlapsPit)
        ctx.drawImage(
          this.assets.bush,
          Math.round(worldX * TILE - this.cameraPx),
          ground - 32,
        );
    }
  }

  drawSolid(solid, time) {
    const ctx = this.ctx;
    const width = solid.w ?? 1;
    const height = solid.h ?? 1;
    const top = this.worldToScreen(solid.x, solid.y + height);
    const pixelW = Math.round(width * TILE);
    const pixelH = Math.round(height * TILE);
    if (solid.type === 'pipe') {
      this.drawPipe(top.x, top.y, pixelW, pixelH);
      return;
    }
    const sprite =
      solid.type === 'ground'
        ? this.assets.ground
        : solid.type === 'stair'
          ? this.assets.stair
          : solid.type === 'question'
            ? solid.used
              ? this.assets.used
              : this.assets.question[Math.floor(time * 4) % 3]
            : this.assets.brick;
    let bump = 0;
    if (Number.isFinite(solid.bump) && solid.bump > 0)
      bump = Math.round(Math.sin(Math.min(1, solid.bump / 0.18) * Math.PI) * 6);
    const firstX = Math.max(0, Math.floor((-top.x - TILE) / TILE));
    const lastX = Math.min(Math.ceil(width), Math.ceil((WIDTH - top.x) / TILE));
    for (let x = firstX; x < lastX; x += 1) {
      for (let y = 0; y < Math.ceil(height); y += 1) {
        const drawW = Math.min(TILE, pixelW - x * TILE);
        const drawH = Math.min(TILE, pixelH - y * TILE);
        if (drawW > 0 && drawH > 0)
          ctx.drawImage(
            sprite,
            0,
            0,
            drawW,
            drawH,
            top.x + x * TILE,
            top.y + y * TILE - bump,
            drawW,
            drawH,
          );
      }
    }
  }

  drawPipe(x, y, width, height) {
    const ctx = this.ctx;
    const fill = (color, xx, yy, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(xx, yy, w, h);
    };
    fill(PALETTE.ink, x + 4, y + 11, width - 8, height - 11);
    fill(PALETTE.greenDark, x + 6, y + 13, width - 12, height - 13);
    fill(PALETTE.green, x + 9, y + 13, width - 20, height - 13);
    fill(PALETTE.greenLight, x + 12, y + 13, 6, height - 13);
    fill('#72d973', x + 21, y + 13, 3, height - 13);
    fill('#299352', x + width - 19, y + 13, 5, height - 13);
    fill(PALETTE.ink, x, y, width, 16);
    fill(PALETTE.green, x + 2, y + 2, width - 4, 12);
    fill(PALETTE.greenLight, x + 2, y + 2, width - 4, 3);
    fill('#aff08b', x + 6, y + 5, 7, 7);
    fill(PALETTE.greenDark, x + width - 11, y + 5, 7, 9);
    fill('#248a50', x + 3, y + 12, width - 6, 2);
  }

  drawItem(item, time) {
    const width = (item.w ?? 0.9) * TILE;
    const height = (item.h ?? 0.9) * TILE;
    const point = this.worldToScreen(item.x, item.y + (item.h ?? 0.9));
    const sprite =
      item.type === 'mushroom'
        ? this.assets.mushroom
        : this.assets.coin[Math.floor(time * 8) % 4];
    this.ctx.drawImage(
      sprite,
      point.x,
      point.y,
      Math.round(width),
      Math.round(height),
    );
  }

  drawEnemy(enemy, time) {
    const ctx = this.ctx;
    const width = (enemy.w ?? 0.8) * TILE;
    const height = (enemy.h ?? 0.8) * TILE;
    const squashed = enemy.squashed || enemy.alive === false;
    if (squashed && (enemy.deadAge ?? 0) > 0.55) return;
    const drawH = squashed ? Math.max(6, height / 4) : height;
    const point = this.worldToScreen(enemy.x, enemy.y);
    ctx.drawImage(
      this.assets.goomba[Math.floor(time * 7 + enemy.x) % 2],
      point.x - 2,
      point.y - Math.round(drawH),
      Math.round(width + 4),
      Math.round(drawH),
    );
  }

  drawMario(player, time) {
    const ctx = this.ctx;
    const big = player.power === 'big' || player.h > 1.2;
    const pose =
      player.dead || this.game.dead
        ? 'dead'
        : !player.onGround
          ? 'jump'
          : Math.abs(player.vx || 0) > 0.3
            ? ['walk1', 'idle', 'walk2'][
                Math.floor(time * (6 + Math.abs(player.vx) * 0.6)) % 3
              ]
            : 'idle';
    const sprite = this.assets.mario[`${big ? 'big' : 'small'}:${pose}`];
    const center = this.worldToScreen(player.x + player.w / 2, player.y);
    const width = Math.max(28, Math.round(player.w * TILE + 7));
    const height = Math.round(player.h * TILE);
    ctx.save();
    if (player.invincible > 0)
      ctx.globalAlpha = this.reducedMotion
        ? 0.8
        : 0.65 + 0.35 * Math.sin(time * 12) ** 2;
    ctx.translate(center.x, center.y);
    ctx.scale(player.facing === -1 ? -1 : 1, 1);
    ctx.drawImage(sprite, -Math.floor(width / 2), -height, width, height);
    ctx.restore();
  }

  drawFlag() {
    const goal = this.game.level?.goal;
    if (!goal || !this.visible({ x: goal.flagX, w: 1 }, 3)) return;
    const ctx = this.ctx;
    const bottom = this.worldToScreen(goal.flagX, this.game.level.groundY ?? 1);
    const top = this.worldToScreen(goal.flagX, goal.flagTopY ?? 10);
    ctx.fillStyle = '#3b805f';
    ctx.fillRect(top.x - 2, top.y, 5, bottom.y - top.y);
    ctx.fillStyle = '#e6efd1';
    ctx.fillRect(top.x - 1, top.y, 2, bottom.y - top.y);
    ctx.fillStyle = PALETTE.goldDark;
    ctx.fillRect(top.x - 5, top.y - 8, 10, 8);
    ctx.fillStyle = PALETTE.goldLight;
    ctx.fillRect(top.x - 3, top.y - 8, 6, 6);
    const descent = this.game.won ? Math.min(1, this.winElapsed / 1.1) : 0;
    const flagY = Math.round(top.y + 7 + (bottom.y - top.y - 30) * descent);
    ctx.fillStyle = PALETTE.cloud;
    for (let row = 0; row < 9; row += 1) {
      const width = 28 - Math.abs(row - 4) * 4;
      ctx.fillRect(top.x - width, flagY + row * 2, width, 2);
    }
    ctx.fillStyle = PALETTE.greenDark;
    ctx.fillRect(top.x - 15, flagY + 6, 6, 6);
    ctx.fillRect(top.x - 18, flagY + 8, 12, 2);
    ctx.drawImage(this.assets.stair, bottom.x - 15, bottom.y - 16, 32, 16);
  }

  drawCastle() {
    const goal = this.game.level?.goal;
    if (!goal || !this.visible({ x: goal.castleX, w: 5 })) return;
    const ctx = this.ctx;
    const base = this.worldToScreen(goal.castleX, this.game.level.groundY ?? 1);
    const brick = this.assets.castle;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 5; col += 1)
        ctx.drawImage(brick, base.x + col * TILE, base.y - (row + 1) * TILE);
    }
    for (let col = 1; col < 4; col += 1)
      ctx.drawImage(brick, base.x + col * TILE, base.y - 4 * TILE);
    for (let col = 0; col < 10; col += 2)
      ctx.drawImage(brick, base.x + col * 16, base.y - 3 * TILE - 14, 16, 16);
    for (let col = 2; col < 8; col += 2)
      ctx.drawImage(brick, base.x + col * 16, base.y - 4 * TILE - 14, 16, 16);
    ctx.fillStyle = '#643c34';
    ctx.fillRect(base.x + 62, base.y - 56, 36, 56);
    ctx.fillStyle = '#372f37';
    ctx.fillRect(base.x + 68, base.y - 50, 24, 50);
    ctx.fillRect(base.x + 72, base.y - 56, 16, 6);
    ctx.fillStyle = '#432e31';
    for (const x of [19, 127]) {
      ctx.fillRect(base.x + x, base.y - 74, 14, 22);
      ctx.fillRect(base.x + x + 3, base.y - 78, 8, 4);
    }
    ctx.fillRect(base.x + 74, base.y - 118, 12, 18);
    ctx.fillStyle = '#efe5b8';
    ctx.fillRect(base.x + 80, base.y - 176, 3, 34);
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(base.x + 83, base.y - 174, 19, 11);
    ctx.fillRect(base.x + 83, base.y - 163, 13, 3);
  }

  drawEffect(effect, time) {
    const ctx = this.ctx;
    const point = this.worldToScreen(effect.x, effect.y);
    if (effect.type === 'coin') {
      ctx.drawImage(
        this.assets.coin[Math.floor(time * 12) % 4],
        point.x - 12,
        point.y - 24,
        24,
        24,
      );
    } else if (effect.type === 'brick') {
      const size = Math.max(
        5,
        Math.round((effect.w ?? effect.size ?? 0.28) * TILE),
      );
      ctx.drawImage(
        this.assets.brick,
        2,
        3,
        14,
        12,
        point.x,
        point.y - size,
        size,
        size,
      );
    } else if (effect.type === 'score') {
      const value = String(
        effect.text ?? effect.value ?? effect.score ?? '100',
      );
      this.drawPixelNumber(value, point.x, point.y - 8);
    } else if (effect.type === 'growth') {
      ctx.fillStyle = PALETTE.goldLight;
      const radius = 8 + Math.floor((1 - Math.min(1, effect.life ?? 0)) * 18);
      for (const [x, y] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        ctx.fillRect(point.x + x * radius - 2, point.y + y * radius - 2, 4, 4);
      }
    }
  }

  drawPixelNumber(value, centerX, y) {
    const ctx = this.ctx;
    const size = 2;
    const x = Math.round(centerX - (value.length * 4 * size - size) / 2);
    for (let i = 0; i < value.length; i += 1) {
      const glyph = DIGITS[value[i]];
      if (!glyph) continue;
      glyph.forEach((row, rowIndex) =>
        [...row].forEach((pixel, colIndex) => {
          if (pixel !== '1') return;
          const left = x + i * 4 * size + colIndex * size;
          const top = y + rowIndex * size;
          ctx.fillStyle = PALETTE.ink;
          ctx.fillRect(left + 1, top + 1, size + 1, size + 1);
          ctx.fillStyle = PALETTE.cloud;
          ctx.fillRect(left, top, size, size);
        }),
      );
    }
  }

  dispose() {
    this.disposed = true;
    this.assets = null;
  }
}
