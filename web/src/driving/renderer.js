import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  PIT_ENTRY,
  PIT_STOP,
  PIT_EXIT,
  PIT_LANE,
  TRACK_LENGTH,
  TRACK_STRAIGHT,
  trackPose,
} from './track.js';

const COLORS = {
  paper: 0xebe8dc,
  earth: 0xaaa88c,
  grass: 0x929f73,
  grassLight: 0xa1ad83,
  asphalt: 0x363d3b,
  runoff: 0xc6c4b0,
  ink: 0x1e2b2c,
  white: 0xf3eee0,
  red: 0xd95038,
  tree: 0x5b7758,
};

const CAR_CAPACITY = 16;
const VEC = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();
const QUATERNION = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const EFFECT_SCALE = new THREE.Vector3();

function box(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function merged(parts) {
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return geometry;
}

function cabin() {
  const points = [
    [-0.94, 1.0, -1.23],
    [0.94, 1.0, -1.23],
    [0.94, 1.0, 1.25],
    [-0.94, 1.0, 1.25],
    [-0.77, 1.83, -0.79],
    [0.77, 1.83, -0.79],
    [0.77, 1.83, 0.55],
    [-0.77, 1.83, 0.55],
  ];
  const triangles = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  for (let i = 0; i < triangles.length; i += 3) {
    [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      triangles.flatMap((index) => points[index]),
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function wheelGeometry(radius, width, materialOffset = 0) {
  const parts = [];
  for (const x of [-1.09 - materialOffset, 1.09 + materialOffset]) {
    for (const z of [-1.47, 1.48]) {
      parts.push(
        new THREE.CylinderGeometry(radius, radius, width, 10)
          .rotateZ(Math.PI / 2)
          .translate(x, 0.48, z),
      );
    }
  }
  return merged(parts);
}

function ribbon(startLane, endLane, start = 0, end = TRACK_LENGTH, y = 0.08) {
  const segments = Math.max(1, Math.ceil((end - start) / 1.8));
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const distance = start + ((end - start) * i) / segments;
    const a = trackPose(distance, startLane);
    const b = trackPose(distance, endLane);
    positions.push(a.x, y, a.z, b.x, y, b.z);
    if (i < segments) {
      const j = i * 2;
      indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function stadiumShape(lane) {
  const points = [];
  for (let d = 0; d < TRACK_LENGTH; d += 2) {
    const p = trackPose(d, lane);
    points.push(new THREE.Vector2(p.x, -p.z));
  }
  return new THREE.Shape(points);
}

function numberTexture(number, color, selected, retired = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = retired ? '#c4c2b8' : selected ? '#1e2b2c' : '#f8f4e8';
  ctx.fillRect(0, 0, 96, 72);
  ctx.strokeStyle = '#1e2b2c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 92, 68);
  ctx.fillStyle = new THREE.Color(color).getStyle();
  ctx.fillRect(4, 4, 10, 64);
  ctx.fillStyle = selected && !retired ? '#fff9eb' : '#1e2b2c';
  ctx.font = '700 46px "Arial", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number).padStart(2, '0'), 54, 38);
  if (retired) {
    ctx.fillStyle = '#a83c2f';
    ctx.beginPath();
    ctx.moveTo(76, 4);
    ctx.lineTo(92, 4);
    ctx.lineTo(92, 20);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Lightweight fixed-camera circuit. The UI owns the animation clock and simulation. */
export class DrivingRenderer {
  constructor(canvas, game, { onSelect = () => {} } = {}) {
    this.canvas = canvas;
    this.game = game;
    this.onSelect = onSelect;
    this.selectedId = game.drivers?.[0]?.id ?? 'nova';
    this.width = 1;
    this.height = 1;
    this.worldPerPixel = 1;
    this.disposed = false;
    this.resources = new Set();
    this.carParts = [];
    this.effectParts = [];
    this.tags = new Map();
    this.poseById = new Map();
    this.skidMarks = [];
    this.spinWasActive = new Map();
    this.lastEffectTime = 0;
    this.screenTargets = [];
    this.pointer = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.paper);
    this.camera = new THREE.OrthographicCamera(-130, 130, 90, -90, 1, 700);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;

    this.scene.add(new THREE.HemisphereLight(0xfff9e9, 0x6f8063, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(90, 180, 60);
    this.scene.add(sun);
    this.buildCircuit();
    this.buildCars();
    this.buildRaceEffects();
    this.buildSelection();
    this.bindInteraction();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.draw(0, 0);
  }

  material(color, extra = {}) {
    const material = new THREE.MeshLambertMaterial({ color, ...extra });
    this.resources.add(material);
    return material;
  }

  addMesh(geometry, material, parent = this.scene) {
    this.resources.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  buildCircuit() {
    const ground = new THREE.ExtrudeGeometry(stadiumShape(5.4), {
      depth: 1.6,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.8,
      bevelThickness: 0.55,
      curveSegments: 1,
    })
      .rotateX(-Math.PI / 2)
      .translate(0, -2.25, 0);
    this.addMesh(ground, this.material(COLORS.earth));
    const turf = new THREE.ShapeGeometry(stadiumShape(5.3))
      .rotateX(-Math.PI / 2)
      .translate(0, -0.04, 0);
    this.addMesh(turf, this.material(COLORS.grass));
    this.addMesh(
      ribbon(-1.2, 3.2, 0, TRACK_LENGTH, 0),
      this.material(COLORS.runoff, { side: THREE.DoubleSide }),
    );
    this.addMesh(
      ribbon(-0.51, 2.51),
      this.material(COLORS.asphalt, { side: THREE.DoubleSide }),
    );
    // Mown infield stripes are geometry, avoiding texture fetches and GPU uploads.
    const stripes = [];
    for (let z = -42; z <= 42; z += 14) {
      stripes.push(box(45, 0.025, 6.5, 0, 0, z));
    }
    this.addMesh(merged(stripes), this.material(COLORS.grassLight));

    const white = [];
    const red = [];
    const stripeMaterial = this.material(COLORS.white, {
      side: THREE.DoubleSide,
    });
    white.push(ribbon(-0.5, -0.46, 0, TRACK_LENGTH, 0.11));
    for (const [start, end] of [
      [0, PIT_ENTRY - 4],
      [PIT_ENTRY + 28, PIT_EXIT - 22],
      [PIT_EXIT + 6, TRACK_LENGTH],
    ]) {
      white.push(ribbon(2.46, 2.5, start, end, 0.11));
    }
    for (let d = 0; d < TRACK_LENGTH; d += 10) {
      for (const lane of [0.5, 1.5]) {
        white.push(
          ribbon(
            lane - 0.018,
            lane + 0.018,
            d,
            Math.min(d + 4.5, TRACK_LENGTH),
            0.115,
          ),
        );
      }
    }
    for (let d = 0, index = 0; d < TRACK_LENGTH; d += 4, index += 1) {
      for (const [a, b] of [
        [-0.76, -0.52],
        [2.52, 2.76],
      ]) {
        if (
          a > 2 &&
          ((d >= PIT_ENTRY - 4 && d < PIT_ENTRY + 28) ||
            (d >= PIT_EXIT - 22 && d < PIT_EXIT + 6))
        )
          continue;
        const geometry = ribbon(a, b, d, Math.min(d + 4, TRACK_LENGTH), 0.12);
        (index % 2 ? white : red).push(geometry);
      }
    }
    this.addMesh(merged(white), stripeMaterial);
    this.addMesh(
      merged(red),
      this.material(COLORS.red, { side: THREE.DoubleSide }),
    );

    const checks = [[], []];
    for (let lane = 0; lane < 15; lane += 1) {
      for (let row = 0; row < 2; row += 1) {
        checks[(lane + row) % 2].push(
          ribbon(
            -0.5 + lane * 0.2,
            -0.5 + (lane + 1) * 0.2,
            row * 0.9,
            0.9 + row * 0.9,
            0.125,
          ),
        );
      }
    }
    this.addMesh(merged(checks[0]), stripeMaterial);
    this.addMesh(
      merged(checks[1]),
      this.material(COLORS.ink, { side: THREE.DoubleSide }),
    );

    // Low perimeter barriers leave the cars visible, unlike tall opaque walls.
    const barriers = [];
    const posts = [];
    for (let d = 0; d < TRACK_LENGTH; d += 9) {
      if (d >= PIT_ENTRY - 4 && d < PIT_EXIT + 8) continue;
      const p = trackPose(d, 3.45);
      barriers.push(
        box(0.4, 0.82, 6.8).rotateY(p.heading).translate(p.x, 0.42, p.z),
      );
      posts.push(box(0.6, 1.16, 0.6, p.x, 0.58, p.z));
    }
    this.addMesh(merged(barriers), this.material(0xe1dfcd));
    this.addMesh(merged(posts), this.material(0x7c8880));
    this.buildPitLane();
    this.buildWetSector();
    this.buildPaddock();
    this.buildLandscaping();
  }

  buildPitLane() {
    // These joins match the simulation's outside-lane entry (12 m), service
    // stop (60 m), and merge back onto the circuit (90 m).
    const entryJoin = PIT_ENTRY + 18;
    const exitJoin = PIT_EXIT - 20;
    const centerLane = (d) =>
      d < entryJoin
        ? THREE.MathUtils.lerp(2, PIT_LANE, (d - PIT_ENTRY) / 18)
        : d > exitJoin
          ? THREE.MathUtils.lerp(PIT_LANE, 2, (d - exitJoin) / 20)
          : PIT_LANE;
    const positions = [];
    const indices = [];
    const white = [];
    for (let d = PIT_ENTRY, i = 0; d <= PIT_EXIT; d += 2, i += 1) {
      for (const side of [-0.5, 0.5]) {
        const p = trackPose(d, centerLane(d) + side);
        positions.push(p.x, 0.083, p.z);
      }
      if (d < PIT_EXIT) {
        const j = i * 2;
        indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        for (const side of [-0.47, 0.47]) {
          const a = trackPose(d, centerLane(d) + side);
          const b = trackPose(d + 2, centerLane(d + 2) + side);
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          white.push(
            box(0.13, 0.022, length)
              .rotateY(Math.atan2(b.x - a.x, b.z - a.z))
              .translate((a.x + b.x) / 2, 0.103, (a.z + b.z) / 2),
          );
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.addMesh(geometry, this.material(0x606861, { side: THREE.DoubleSide }));
    this.addMesh(merged(white), this.material(0xe6ddb3));
    const stop = trackPose(PIT_STOP, PIT_LANE);
    const boxPaint = merged([
      box(4.2, 0.025, 0.17, stop.x, 0.125, stop.z - 3.6),
      box(4.2, 0.025, 0.17, stop.x, 0.125, stop.z + 3.6),
      box(0.17, 0.025, 7.2, stop.x - 2.1, 0.125, stop.z),
      box(0.17, 0.025, 7.2, stop.x + 2.1, 0.125, stop.z),
    ]);
    this.addMesh(boxPaint, this.material(0xf4cb5f));
    this.addMesh(
      merged([
        box(3.2, 0.22, 8, 55, 3.3, stop.z),
        box(0.2, 3.1, 0.2, 56, 1.55, stop.z - 3.2),
        box(0.2, 3.1, 0.2, 56, 1.55, stop.z + 3.2),
      ]),
      this.material(COLORS.white),
    );
    this.addMesh(
      merged([
        box(1.1, 1.3, 1.3, 55, 0.7, stop.z + 2),
        box(0.5, 0.9, 0.5, 53.8, 0.65, stop.z - 2),
        box(0.5, 0.9, 0.5, 53.8, 0.65, stop.z + 2.4),
      ]),
      this.material(COLORS.red),
    );

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e7be54';
    ctx.fillRect(0, 0, 160, 72);
    ctx.fillStyle = '#263936';
    ctx.font = '900 48px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIT', 80, 39);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthWrite: false,
    });
    this.resources.add(texture);
    this.resources.add(material);
    const sign = new THREE.Sprite(material);
    sign.position.set(55, 3.6, -26);
    sign.scale.set(7.5, 3.4, 1);
    this.scene.add(sign);
    this.addMesh(
      box(0.16, 3.3, 0.16, 55, 1.65, -26),
      this.material(COLORS.ink),
    );
  }

  buildWetSector() {
    this.wetRoad = this.addMesh(
      new THREE.BufferGeometry(),
      this.material(0x526b70, { side: THREE.DoubleSide }),
    );
    this.wetSheen = this.addMesh(
      new THREE.BufferGeometry(),
      this.material(0x849b9e, { side: THREE.DoubleSide }),
    );
    this.wetSectorKey = null;
    this.updateWetSector();
  }

  updateWetSector() {
    const sector = this.game.wetSector;
    this.wetRoad.visible = !!sector;
    this.wetSheen.visible = !!sector;
    if (!sector) return;
    const key = `${sector.start}:${sector.end}`;
    if (key === this.wetSectorKey) return;
    this.wetSectorKey = key;
    for (const mesh of [this.wetRoad, this.wetSheen]) {
      this.resources.delete(mesh.geometry);
      mesh.geometry.dispose();
    }
    this.wetRoad.geometry = ribbon(
      -0.455,
      2.455,
      sector.start,
      sector.end,
      0.094,
    );
    const sheen = [];
    for (let i = 0; i < 5; i += 1) {
      const start = sector.start + 8 + i * 19;
      const lane = 0.1 + (i % 3) * 0.77;
      sheen.push(
        ribbon(
          lane - 0.1,
          lane + 0.09,
          start,
          Math.min(start + 12, sector.end - 3),
          0.099,
        ),
      );
    }
    this.wetSheen.geometry = merged(sheen);
    this.resources.add(this.wetRoad.geometry);
    this.resources.add(this.wetSheen.geometry);
  }

  buildPaddock() {
    const concrete = this.material(0xc3c3b0);
    const ivory = this.material(COLORS.white);
    const dark = this.material(COLORS.ink);
    const red = this.material(COLORS.red);
    const glass = this.material(0x718e94);

    this.addMesh(box(22, 0.13, 42, -11, 0.11, -22), concrete);
    this.addMesh(box(11, 4.4, 23, -16, 2.25, -19), ivory);
    this.addMesh(box(12.5, 0.6, 24.5, -15.8, 4.65, -19), red);
    const garages = [];
    const dividers = [];
    for (const z of [-27, -19, -11]) {
      garages.push(box(0.03, 3.0, 5.8, -10.47, 1.58, z));
      dividers.push(box(5, 0.03, 0.15, -6.5, 0.2, z - 3.5));
    }
    this.addMesh(merged(garages), dark);
    this.addMesh(merged(dividers), ivory);

    // The glass control room is the tallest object, set well inside the circuit.
    this.addMesh(box(4.5, 6.5, 5, -15, 3.25, -36), ivory);
    this.addMesh(box(6.8, 2.25, 7.5, -15, 7.0, -36), glass);
    this.addMesh(box(7.2, 0.45, 8.0, -15, 8.3, -36), ivory);
    this.addMesh(box(0.13, 3.8, 0.13, -15, 10.3, -36), dark);
    this.addMesh(box(0.14, 1.6, 2.2, -15, 11.05, -34.85), red);

    // Three rows of open grandstands, with individually colored tiny seats.
    const terraces = [];
    for (let row = 0; row < 3; row += 1) {
      terraces.push(
        box(
          2.6,
          1.2 + row * 0.85,
          28,
          -16 - row * 2.1,
          (1.2 + row * 0.85) / 2,
          24,
        ),
      );
    }
    this.addMesh(merged(terraces), concrete);
    const seatColors = [0xc94a36, 0xf0e7ce, 0x476b7c];
    seatColors.forEach((color, colorIndex) => {
      const seats = [];
      for (let row = 0; row < 3; row += 1) {
        for (let seat = 0; seat < 17; seat += 1) {
          if ((seat + row * 2) % 3 !== colorIndex) continue;
          seats.push(
            box(
              0.8,
              0.7,
              0.75,
              -16 - row * 2.1,
              1.58 + row * 0.85,
              12 + seat * 1.5,
            ),
          );
        }
      }
      this.addMesh(merged(seats), this.material(color));
    });
    this.addMesh(
      merged([
        box(0.22, 5.7, 0.22, -23, 2.85, 9),
        box(0.22, 5.7, 0.22, -23, 2.85, 39),
        box(9.5, 0.3, 31, -19, 5.8, 24),
      ]),
      ivory,
    );

    const signCanvas = document.createElement('canvas');
    signCanvas.width = 768;
    signCanvas.height = 192;
    const context = signCanvas.getContext('2d');
    context.fillStyle = '#f4eedc';
    context.fillRect(0, 0, 768, 192);
    context.fillStyle = '#2d3c35';
    context.font = 'italic 900 87px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText('SLIPSTREAM', 384, 115);
    context.fillStyle = '#d95038';
    context.fillRect(112, 143, 544, 8);
    const texture = new THREE.CanvasTexture(signCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.resources.add(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    this.resources.add(material);
    this.addMesh(
      new THREE.PlaneGeometry(25, 6.25)
        .rotateX(-Math.PI / 2)
        .rotateY(Math.PI / 2)
        .translate(7, 0.07, -4),
      material,
    );
  }

  buildLandscaping() {
    const trunks = [];
    const leaves = [];
    const shrubs = [];
    const treePoints = [
      [13, 22, 1.0],
      [17, 34, 0.8],
      [9, 43, 0.9],
      [18, -26, 0.8],
      [-11, 69, 0.85],
      [13, 72, 1.1],
      [-4, -70, 1.0],
      [12, -68, 0.8],
      [16, 56, 0.9],
      [18, -40, 0.7],
      [-50, -10, 0.9],
      [-50, 35, 0.8],
    ];
    treePoints.forEach(([x, z, scale], i) => {
      trunks.push(
        new THREE.CylinderGeometry(0.28, 0.4, 2.9 * scale, 5).translate(
          x,
          1.45 * scale,
          z,
        ),
      );
      leaves.push(
        new THREE.IcosahedronGeometry(2.7 * scale, 0)
          .scale(1, 1.25, 1)
          .rotateY(i)
          .translate(x, 4.0 * scale, z),
      );
      shrubs.push(
        new THREE.IcosahedronGeometry(1.0, 0)
          .scale(1.5, 0.6, 1)
          .translate(x + 2.7, 0.45, z + 1.2),
      );
    });
    this.addMesh(merged(trunks), this.material(0x756b53));
    this.addMesh(
      merged(leaves),
      this.material(COLORS.tree, { flatShading: true }),
    );
    this.addMesh(
      merged(shrubs),
      this.material(0x788e64, { flatShading: true }),
    );

    const cones = [];
    const bases = [];
    for (let i = 0; i < 7; i += 1) {
      const x = -2;
      const z = -37 + i * 4.5;
      cones.push(new THREE.ConeGeometry(0.34, 1.0, 5).translate(x, 0.55, z));
      bases.push(box(0.85, 0.08, 0.85, x, 0.08, z));
    }
    this.addMesh(merged(cones), this.material(0xe8753f));
    this.addMesh(merged(bases), this.material(COLORS.ink));

    // A few irregular gravel patches break up the perfectly uniform lawn.
    const gravel = [];
    for (let i = 0; i < 22; i += 1) {
      const d = (i * TRACK_LENGTH) / 22 + 2;
      const p = trackPose(d, 4.7);
      gravel.push(
        new THREE.CircleGeometry(0.5 + (i % 3) * 0.2, 5)
          .rotateX(-Math.PI / 2)
          .scale(2, 1, 1)
          .translate(p.x, 0.015, p.z),
      );
    }
    this.addMesh(merged(gravel), this.material(0xc0bc9d));
  }

  instancedPart(geometry, material, { pickable = true } = {}) {
    this.resources.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, CAR_CAPACITY);
    mesh.count = 0;
    mesh.frustumCulled = false;
    // InstancedMesh caches its first raycast bounds. Use a circuit-sized sphere
    // so moving cars remain clickable after leaving their starting positions.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 180);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.pickable = pickable;
    this.scene.add(mesh);
    this.carParts.push(mesh);
    return mesh;
  }

  buildCars() {
    this.paint = this.instancedPart(
      merged([
        box(2.12, 0.58, 4.62, 0, 0.75, 0),
        box(1.91, 0.22, 1.34, 0, 1.04, 1.57),
        box(1.99, 0.12, 0.66, 0, 1.01, -1.9),
        box(1.62, 0.1, 1.48, 0, 1.85, -0.11),
        box(0.12, 0.65, 0.16, -0.82, 1.4, -0.34),
        box(0.12, 0.65, 0.16, 0.82, 1.4, -0.34),
        box(0.25, 0.18, 0.32, -1.13, 1.16, 0.72),
        box(0.25, 0.18, 0.32, 1.13, 1.16, 0.72),
      ]),
      this.material(0xffffff),
    );
    this.instancedPart(cabin(), this.material(0x567984));
    this.instancedPart(wheelGeometry(0.46, 0.3), this.material(0x202627));
    this.instancedPart(
      wheelGeometry(0.22, 0.025, 0.17),
      this.material(0xb9c1bb),
    );
    this.instancedPart(
      merged([
        box(2.05, 0.2, 0.18, 0, 0.51, 2.3),
        box(2.08, 0.19, 0.18, 0, 0.5, -2.3),
        box(0.72, 0.19, 0.035, 0, 0.76, 2.33),
        box(0.12, 0.09, 0.39, -1.08, 0.98, -0.35),
        box(0.12, 0.09, 0.39, 1.08, 0.98, -0.35),
      ]),
      this.material(COLORS.ink),
    );
    this.instancedPart(
      merged([
        box(0.43, 0.16, 0.05, -0.74, 0.94, 2.32),
        box(0.43, 0.16, 0.05, 0.74, 0.94, 2.32),
        box(0.29, 0.025, 1.22, -0.2, 1.16, 1.56),
        box(0.29, 0.025, 1.43, -0.2, 1.91, -0.11),
      ]),
      this.material(COLORS.white),
    );
    this.brakeLamps = this.instancedPart(
      merged([
        box(0.51, 0.18, 0.08, -0.7, 0.92, -2.32),
        box(0.51, 0.18, 0.08, 0.7, 0.92, -2.32),
      ]),
      this.material(0xffffff),
    );
    this.shadow = this.instancedPart(
      new THREE.PlaneGeometry(2.8, 5.25)
        .rotateX(-Math.PI / 2)
        .translate(0.2, 0.15, -0.1),
      this.material(0x102020, {
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
      }),
      { pickable: false },
    );
  }

  effectPart(geometry, material, capacity) {
    this.resources.add(geometry);
    this.resources.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.effectParts.push(mesh);
    return mesh;
  }

  buildRaceEffects() {
    const flare = (width, length) => {
      const positions = [];
      for (const x of [-0.7, 0.7]) {
        positions.push(
          x - width,
          0.35,
          -2.3,
          x + width,
          0.35,
          -2.3,
          x,
          0.35,
          -length,
        );
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      return geometry;
    };
    this.boostFlare = this.effectPart(
      flare(0.55, 10.5),
      new THREE.MeshBasicMaterial({
        color: 0x46dbe3,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
      CAR_CAPACITY,
    );
    this.boostCore = this.effectPart(
      flare(0.21, 6),
      new THREE.MeshBasicMaterial({
        color: 0xe2ffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      CAR_CAPACITY,
    );
    this.smoke = this.effectPart(
      new THREE.IcosahedronGeometry(1.0, 0),
      new THREE.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        flatShading: true,
      }),
      CAR_CAPACITY * 3,
    );
    this.skids = this.effectPart(
      merged([
        box(0.21, 0.016, 5.8, -0.88, 0.155, 0),
        box(0.21, 0.016, 5.8, 0.88, 0.155, 0),
      ]),
      new THREE.MeshBasicMaterial({
        color: 0x1c2625,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
      32,
    );
  }

  updateRaceEffects(cars) {
    const time = this.game.time;
    if (time < this.lastEffectTime) {
      this.skidMarks.length = 0;
      this.spinWasActive.clear();
    }
    this.lastEffectTime = time;
    let boostCount = 0;
    let smokeCount = 0;
    cars.forEach((car, index) => {
      const pose = this.poseById.get(car.id);
      const spinning = !!car.spinning;
      if (spinning && !this.spinWasActive.get(car.id)) {
        const heading = trackPose(car.distance, car.lanePosition).heading;
        this.skidMarks.push({
          x: pose.x,
          z: pose.z,
          heading: heading + 0.18,
          born: time,
        });
        if (this.skidMarks.length > 32) this.skidMarks.shift();
      }
      this.spinWasActive.set(car.id, spinning);
      if (car.boosting && !car.retired && !car.finished && !spinning) {
        VEC.set(pose.x, 0.12, pose.z);
        QUATERNION.setFromAxisAngle(UP, pose.heading);
        MATRIX.compose(VEC, QUATERNION, ONE);
        this.boostFlare.setMatrixAt(boostCount, MATRIX);
        this.boostCore.setMatrixAt(boostCount, MATRIX);
        boostCount += 1;
      }
      if (car.damage > 35 || spinning || car.retired) {
        for (let puff = 0; puff < 3; puff += 1) {
          const age = (time * 0.8 + puff / 3 + index * 0.11) % 1;
          const forward = spinning
            ? -age * 3.5
            : 1.4 - age * Math.min(5, car.speed * 0.3);
          const side = Math.sin(age * 5 + index) * 0.6;
          const scale = (0.3 + age * 1.25) * (car.retired ? 1.25 : 1);
          VEC.set(
            pose.x +
              Math.sin(pose.heading) * forward +
              Math.cos(pose.heading) * side,
            1.5 + age * (spinning ? 1.2 : 4),
            pose.z +
              Math.cos(pose.heading) * forward -
              Math.sin(pose.heading) * side,
          );
          QUATERNION.setFromAxisAngle(UP, age + index);
          MATRIX.compose(
            VEC,
            QUATERNION,
            EFFECT_SCALE.set(scale, scale, scale),
          );
          this.smoke.setMatrixAt(smokeCount, MATRIX);
          this.smoke.setColorAt(
            smokeCount,
            new THREE.Color(
              car.damage > 35 || car.retired ? 0x667170 : 0xc5c4b8,
            ),
          );
          smokeCount += 1;
        }
      }
    });
    this.skidMarks = this.skidMarks.filter((mark) => time - mark.born < 12);
    this.skidMarks.forEach((mark, index) => {
      VEC.set(mark.x, 0, mark.z);
      QUATERNION.setFromAxisAngle(UP, mark.heading);
      MATRIX.compose(VEC, QUATERNION, ONE);
      this.skids.setMatrixAt(index, MATRIX);
    });
    this.boostFlare.count = boostCount;
    this.boostCore.count = boostCount;
    this.smoke.count = smokeCount;
    this.skids.count = this.skidMarks.length;
    this.effectParts.forEach((part) => {
      part.instanceMatrix.needsUpdate = true;
    });
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }

  buildSelection() {
    const material = new THREE.MeshBasicMaterial({
      color: COLORS.white,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    this.resources.add(material);
    this.selection = this.addMesh(
      new THREE.RingGeometry(3.1, 3.35, 40).rotateX(-Math.PI / 2),
      material,
    );
    this.selection.position.y = 0.16;
  }

  ensureTag(car) {
    if (this.tags.has(car.id)) return this.tags.get(car.id);
    const normal = numberTexture(car.number, car.color, false);
    const selected = numberTexture(car.number, car.color, true);
    const retired = numberTexture(car.number, car.color, false, true);
    this.resources.add(normal);
    this.resources.add(selected);
    this.resources.add(retired);
    const material = new THREE.SpriteMaterial({
      map: normal,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
    this.resources.add(material);
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    const tag = { sprite, normal, selected, retired, rect: null };
    this.tags.set(car.id, tag);
    return tag;
  }

  draw(_now, _dt) {
    if (this.disposed) return;
    const cars = this.game.cars.slice(0, CAR_CAPACITY);
    this.visibleCars = cars;
    this.poseById.clear();
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      const pose =
        Number.isFinite(car.x) &&
        Number.isFinite(car.z) &&
        Number.isFinite(car.heading)
          ? { x: car.x, z: car.z, heading: car.heading }
          : trackPose(car.distance, car.lanePosition ?? car.lane ?? 1);
      this.poseById.set(car.id, pose);
      VEC.set(pose.x, 0.13, pose.z);
      QUATERNION.setFromAxisAngle(UP, pose.heading);
      MATRIX.compose(VEC, QUATERNION, ONE);
      this.carParts.forEach((part) => part.setMatrixAt(i, MATRIX));
      this.paint.setColorAt(
        i,
        new THREE.Color(car.color || 0x939b9b).multiplyScalar(
          car.retired ? 0.3 : 1 - Math.min(100, car.damage || 0) * 0.004,
        ),
      );
      this.brakeLamps.setColorAt(
        i,
        new THREE.Color(car.braking || car.assisting ? 0xff3824 : 0x852d24),
      );
    }
    for (const part of this.carParts) {
      part.count = cars.length;
      part.instanceMatrix.needsUpdate = true;
    }
    if (this.paint.instanceColor) this.paint.instanceColor.needsUpdate = true;
    if (this.brakeLamps.instanceColor)
      this.brakeLamps.instanceColor.needsUpdate = true;
    const selectedPose = this.poseById.get(this.selectedId);
    this.selection.visible = !!selectedPose;
    if (selectedPose)
      this.selection.position.set(selectedPose.x, 0.16, selectedPose.z);
    this.updateWetSector();
    this.updateRaceEffects(cars);
    this.updateTags(cars.filter((car) => car.controlled));
    this.scene.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
  }

  project(point) {
    VEC.copy(point).project(this.camera);
    return {
      x: ((VEC.x + 1) * this.width) / 2,
      y: ((1 - VEC.y) * this.height) / 2,
      z: VEC.z,
    };
  }

  updateTags(drivers) {
    const tagWidth = this.width < 500 ? 24 : 28;
    const tagHeight = tagWidth * 0.75;
    const occupied = [];
    const carsOnScreen = this.visibleCars.map((car) => {
      const pose = this.poseById.get(car.id);
      return {
        id: car.id,
        ...this.project(new THREE.Vector3(pose.x, 1.4, pose.z)),
      };
    });
    const ordered = [...drivers].sort(
      (a, b) => (b.id === this.selectedId) - (a.id === this.selectedId),
    );
    this.screenTargets = [];
    for (const car of ordered) {
      const pose = this.poseById.get(car.id);
      const body = this.project(new THREE.Vector3(pose.x, 1.6, pose.z));
      const tag = this.ensureTag(car);
      const offsets = [
        [0, -26],
        [27, -19],
        [-27, -19],
        [0, -45],
        [33, 9],
        [-33, 9],
        [0, 29],
      ];
      let best;
      let bestScore = Infinity;
      for (const [dx, dy] of offsets) {
        const cx = THREE.MathUtils.clamp(
          body.x + dx,
          tagWidth / 2 + 4,
          this.width - tagWidth / 2 - 4,
        );
        const cy = THREE.MathUtils.clamp(
          body.y + dy,
          tagHeight / 2 + 4,
          this.height - tagHeight / 2 - 4,
        );
        const candidate = {
          x: cx - tagWidth / 2,
          y: cy - tagHeight / 2,
          width: tagWidth,
          height: tagHeight,
        };
        let score = (Math.abs(dx) + Math.abs(dy)) * 0.01;
        for (const previous of occupied) {
          const w = Math.max(
            0,
            Math.min(candidate.x + tagWidth, previous.x + previous.width + 3) -
              Math.max(candidate.x, previous.x - 3),
          );
          const h = Math.max(
            0,
            Math.min(
              candidate.y + tagHeight,
              previous.y + previous.height + 3,
            ) - Math.max(candidate.y, previous.y - 3),
          );
          score += w * h;
        }
        for (const other of carsOnScreen) {
          if (
            other.x > candidate.x - 6 &&
            other.x < candidate.x + tagWidth + 6 &&
            other.y > candidate.y - 6 &&
            other.y < candidate.y + tagHeight + 6
          )
            score += 400;
        }
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      occupied.push(best);
      tag.rect = best;
      const centerX = best.x + tagWidth / 2;
      const centerY = best.y + tagHeight / 2;
      VEC.set(
        (centerX / this.width) * 2 - 1,
        1 - (centerY / this.height) * 2,
        body.z,
      ).unproject(this.camera);
      tag.sprite.position.copy(VEC);
      tag.sprite.scale.set(
        tagWidth * this.worldPerPixel,
        tagHeight * this.worldPerPixel,
        1,
      );
      tag.sprite.material.map = car.retired
        ? tag.retired
        : car.id === this.selectedId
          ? tag.selected
          : tag.normal;
      tag.sprite.visible = true;
      this.screenTargets.push({
        id: car.id,
        body,
        tag: {
          x: centerX,
          y: centerY,
          width: tagWidth,
          height: tagHeight,
          visible: true,
        },
      });
    }
  }

  select(id) {
    this.selectedId = id;
  }

  resetCamera() {
    const tall = this.width / this.height < 1.03;
    this.camera.position.set(tall ? 0 : 175, 280, tall ? 180 : 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    const aspect = this.width / this.height;
    const spanX = tall ? 123 : TRACK_STRAIGHT + 122;
    const spanY = tall ? 201 : 125;
    const viewHeight = Math.max(spanY, spanX / aspect);
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.worldPerPixel = viewHeight / this.height;
  }

  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.renderer.setSize(this.width, this.height, false);
    this.resetCamera();
  }

  pickBody(x, y) {
    this.mouse.set((x / this.width) * 2 - 1, 1 - (y / this.height) * 2);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.carParts.filter((part) => part.userData.pickable),
      false,
    );
    const first = hits[0];
    if (!first) return null;
    const car = this.visibleCars[first.instanceId];
    return car?.controlled ? car.id : null;
  }

  pick(x, y) {
    for (const target of this.screenTargets) {
      const tag = this.tags.get(target.id).rect;
      if (
        x >= tag.x &&
        x <= tag.x + tag.width &&
        y >= tag.y &&
        y <= tag.y + tag.height
      )
        return target.id;
    }
    return this.pickBody(x, y);
  }

  bindInteraction() {
    const localPoint = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    this.onPointerDown = (event) => {
      if (event.button !== 0) return;
      const point = localPoint(event);
      this.pointer = {
        id: event.pointerId,
        ...point,
        maxMovement: 0,
        target: this.pick(point.x, point.y),
      };
    };
    this.onPointerMove = (event) => {
      const point = localPoint(event);
      if (this.pointer?.id === event.pointerId) {
        this.pointer.maxMovement = Math.max(
          this.pointer.maxMovement,
          Math.hypot(point.x - this.pointer.x, point.y - this.pointer.y),
        );
      }
      if (!this.pointer)
        this.canvas.style.cursor = this.pick(point.x, point.y)
          ? 'pointer'
          : 'default';
    };
    this.onPointerUp = (event) => {
      const pointer = this.pointer;
      this.pointer = null;
      if (
        pointer?.id === event.pointerId &&
        pointer.maxMovement < 7 &&
        pointer.target
      ) {
        this.select(pointer.target);
        this.onSelect(pointer.target);
      }
    };
    this.onPointerCancel = () => {
      this.pointer = null;
      this.canvas.style.cursor = 'default';
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerCancel);
  }

  /** Viewport coordinates, measured from the actual rendered car and tag geometry. */
  selectionTargets() {
    const rect = this.canvas.getBoundingClientRect();
    return this.screenTargets.map((target) => {
      const pose = this.poseById.get(target.id);
      let body = target.body;
      let visible = false;
      for (const [side, forward, height] of [
        [0, 0, 1.94],
        [0, 1.75, 1.2],
        [0, -1.8, 1.15],
        [-0.7, 0, 1.8],
        [0.7, 0, 1.8],
      ]) {
        const point = this.project(
          new THREE.Vector3(
            pose.x +
              Math.cos(pose.heading) * side +
              Math.sin(pose.heading) * forward,
            height,
            pose.z -
              Math.sin(pose.heading) * side +
              Math.cos(pose.heading) * forward,
          ),
        );
        if (this.pick(point.x, point.y) === target.id) {
          body = point;
          visible = true;
          break;
        }
      }
      const tag = {
        ...target.tag,
        x: rect.left + target.tag.x,
        y: rect.top + target.tag.y,
      };
      return {
        id: target.id,
        selected: target.id === this.selectedId,
        body: { x: rect.left + body.x, y: rect.top + body.y, visible },
        tag,
        nameplate: tag,
      };
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerCancel);
    [...this.carParts, ...this.effectParts].forEach((part) => part.dispose());
    this.resources.forEach((resource) => resource.dispose());
    this.resources.clear();
    this.renderer.dispose();
  }
}
