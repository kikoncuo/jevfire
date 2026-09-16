// Original, hand-authored World 1-1-style course. No ROM or extracted map data.
// Positions are tile units; x points right, y up; rectangles use bottom-left.
export const TILE_SIZE = 16;
export const LEVEL_WIDTH = 212;
const pits = [
  { x: 69, w: 3 },
  { x: 86, w: 3 },
  { x: 153, w: 3 },
];
const solids = [];
let groundStart = 0;
for (const pit of [...pits, { x: LEVEL_WIDTH, w: 0 }]) {
  solids.push({
    id: `ground-${groundStart}`,
    type: 'ground',
    x: groundStart,
    y: 0,
    w: pit.x - groundStart,
    h: 1,
  });
  groundStart = pit.x + pit.w;
}
const block = (x, y, type = 'brick', content = null) =>
  solids.push({
    id: `block-${x}-${y}`,
    type,
    x,
    y,
    w: 1,
    h: 1,
    content,
    used: false,
    broken: false,
  });
const pipe = (x, h) =>
  solids.push({ id: `pipe-${x}`, type: 'pipe', x, y: 1, w: 2, h });
block(16, 4, 'question', 'coin');
for (const x of [20, 22, 24]) block(x, 4);
block(21, 4, 'question', 'mushroom');
block(23, 4, 'question', 'coin');
block(22, 8, 'question', 'coin');
pipe(28, 2);
pipe(38, 3);
pipe(46, 4);
pipe(57, 4);
for (const x of [77, 78, 79])
  block(x, 4, x === 78 ? 'question' : 'brick', x === 78 ? 'mushroom' : null);
for (let x = 80; x <= 87; x++) block(x, 8);
for (const x of [91, 92, 93]) block(x, 8);
block(94, 8, 'question', 'coin');
block(94, 4);
for (const x of [100, 101]) block(x, 4);
for (const x of [106, 109, 112]) block(x, 4, 'question', 'coin');
block(109, 8, 'question', 'mushroom');
block(118, 4);
for (const x of [121, 122, 123]) block(x, 8);
for (const x of [128, 129, 130, 131])
  block(
    x,
    8,
    x === 129 || x === 130 ? 'question' : 'brick',
    x === 129 || x === 130 ? 'coin' : null,
  );
const staircase = (x, heights) =>
  heights.forEach((h, i) =>
    solids.push({
      id: `stair-${x + i}`,
      type: 'stair',
      x: x + i,
      y: 1,
      w: 1,
      h,
    }),
  );
staircase(134, [1, 2, 3, 4]);
staircase(140, [4, 3, 2, 1]);
staircase(148, [1, 2, 3, 4, 4]);
staircase(156, [4, 3, 2, 1]);
pipe(163, 2);
for (const x of [169, 170, 171, 172])
  block(x, 4, x === 170 ? 'question' : 'brick', x === 170 ? 'coin' : null);
pipe(179, 2);
staircase(183, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
solids.push({ id: 'flag-base', type: 'stair', x: 198, y: 1, w: 1, h: 1 });

const enemies = [
  22, 40, 51, 54, 80, 83, 96, 103, 114, 117, 124, 127, 173, 176,
].map((x, index) => ({
  id: `goomba-${index + 1}`,
  type: 'goomba',
  x,
  y: x === 83 ? 9 : 1,
  w: 0.8,
  h: 0.8,
  vx: -1.35,
  vy: 0,
}));
const decorations = [
  ...[5, 33, 64, 94, 125, 161, 194].map((x, i) => ({
    type: 'hill',
    x,
    y: 1,
    w: i % 2 ? 8 : 5,
    h: i % 2 ? 3 : 2,
  })),
  ...[11, 26, 43, 61, 92, 118, 145, 166, 191, 207].map((x, i) => ({
    type: 'cloud',
    x,
    y: 10 + (i % 3),
    w: 3 + (i % 2),
    h: 1.3,
  })),
  ...[13, 37, 60, 97, 119, 145, 166].map((x, i) => ({
    type: 'bush',
    x,
    y: 1,
    w: 2 + (i % 3),
    h: 0.7,
  })),
];
export const LEVEL = Object.freeze({
  id: '1-1',
  width: LEVEL_WIDTH,
  height: 15,
  groundY: 1,
  spawn: Object.freeze({ x: 3, y: 1 }),
  goal: Object.freeze({ flagX: 198, flagTopY: 10, castleX: 204 }),
  pits: Object.freeze(pits.map(Object.freeze)),
  solids: Object.freeze(solids.map(Object.freeze)),
  enemies: Object.freeze(enemies.map(Object.freeze)),
  decorations: Object.freeze(decorations.map(Object.freeze)),
});
