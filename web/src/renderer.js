import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const ROLE_COLORS = {
  collector: 0x789b5a,
  fighter: 0xb05238,
  builder: 0xc2a152,
  orc: 0x765083,
};
const ASSET = (name) => `${import.meta.env.BASE_URL}assets/${name}.glb`;
const material = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
const clamp = THREE.MathUtils.clamp;

function mesh(geometry, mat, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function rng(seed = 261) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const ROLE_SYMBOLS = { collector: '◆', fighter: '⚔', builder: '⚒', orc: '!' };
const ACTIVITY_LABELS = {
  walking: '→ Travelling',
  gathering: '◆ Gathering',
  fighting: '⚔ Fighting',
  training: '⚔ Training',
  building: '⚒ Building',
  repairing: '⚒ Repairing',
  healing: '+ Healing ally',
  eating: '● Eating',
  resting: '☾ Resting',
  guarding: '◈ Guarding',
  waiting: '… Waiting',
  roaming: '→ Roaming',
  dead: 'Fallen',
};

function label(text, color = '#344132') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.renderOrder = 10;
  sprite.userData = {
    canvas,
    texture,
    state: '',
    pixels: 92,
    variant: 'site',
    ratio: 72 / 256,
  };
  paintLabel(sprite, text, color);
  return sprite;
}

// Compact names stay in the world; explanations and model reasoning stay in the
// inspector. Only one selected/hovered NPC gets a small numerical needs line.
function paintLabel(
  sprite,
  text,
  color,
  health = null,
  hunger = null,
  detail = '',
  numbers = '',
) {
  const variant = sprite.userData.variant;
  const healthStep = health === null ? '' : Math.round(health * 100);
  const hungerStep = hunger === null ? '' : Math.round(hunger * 100);
  const state = `${variant}|${text}|${color}|${healthStep}|${hungerStep}|${detail}|${numbers}`;
  if (state === sprite.userData.state) return;
  sprite.userData.state = state;
  const { canvas, texture } = sprite.userData;
  const selected = variant === 'selected';
  const npc = variant === 'npc' || selected;
  const tag = variant === 'tag';
  const contentHeight = selected ? 86 : npc ? 58 : tag ? 44 : 72;
  sprite.userData.ratio = contentHeight / canvas.width;
  // Keep GPU texture storage fixed; crop UVs instead of resizing an uploaded canvas.
  texture.repeat.set(1, contentHeight / 128);
  texture.offset.set(0, 1 - contentHeight / 128);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, canvas.height);
  ctx.textAlign = 'center';
  if (!npc) {
    ctx.fillStyle = 'rgba(247,242,222,.85)';
    ctx.beginPath();
    ctx.roundRect(3, 2, 250, contentHeight - 4, 6);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = '#f6f0dd';
  ctx.lineJoin = 'round';
  ctx.lineWidth = npc ? 7 : 0;
  ctx.font = `${npc ? 700 : 600} ${npc ? (selected ? 36 : 40) : tag ? 32 : 29}px "Barlow Condensed", sans-serif`;
  if (npc) ctx.strokeText(text, 128, 34, 246);
  ctx.fillText(text, 128, tag ? 32 : 34, 246);
  if (selected) {
    ctx.font = '600 24px "Barlow Condensed", sans-serif';
    ctx.strokeText(numbers, 128, 62, 246);
    ctx.fillText(numbers, 128, 62, 246);
  } else if (!npc && !tag) {
    ctx.font = '500 25px "Barlow Condensed", sans-serif';
    ctx.fillText(numbers || detail, 128, 61, 246);
  }
  if (health !== null) {
    const y = selected ? 71 : npc ? 45 : 65;
    ctx.fillStyle = '#64705599';
    ctx.fillRect(35, y, 186, 5);
    ctx.fillStyle = health < 0.35 ? '#bb5138' : '#577952';
    ctx.fillRect(35, y, 186 * clamp(health, 0, 1), 5);
    if (selected && hunger !== null) {
      ctx.fillStyle = '#aa873c';
      ctx.fillRect(35, 79, 186 * clamp(hunger, 0, 1), 3);
    }
  }
  texture.needsUpdate = true;
}

function pathMesh(points, width, color = 0xb9b494) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0.065, z)),
  );
  const vertices = [],
    indices = [];
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPoint(i / samples),
      tangent = curve.getTangent(i / samples);
    const variation = 1 + Math.sin(i * 0.72) * 0.11;
    const dx = -tangent.z * width * 0.5 * variation,
      dz = tangent.x * width * 0.5 * variation;
    vertices.push(p.x + dx, p.y, p.z + dz, p.x - dx, p.y, p.z - dz);
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const result = mesh(geometry, material(color, { side: THREE.DoubleSide }));
  result.castShadow = false;
  return result;
}

function berryBush(random) {
  const group = new THREE.Group();
  const transform = new THREE.Object3D();
  const leaves = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.47, 0),
    material(0xffffff),
    5,
  );
  const leafColor = new THREE.Color();
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.4;
    transform.position.set(
      Math.cos(angle) * 0.45,
      0.38 + random() * 0.15,
      Math.sin(angle) * 0.45,
    );
    transform.scale.set(1, 0.86, 1);
    transform.updateMatrix();
    leaves.setMatrixAt(i, transform.matrix);
    leaves.setColorAt(
      i,
      leafColor.setHex([0x6c8043, 0x7b9150, 0x566d39][i % 3]),
    );
  }
  const berries = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.09, 0),
    material(0xa54e43),
    13,
  );
  transform.scale.setScalar(1);
  for (let i = 0; i < 13; i++) {
    const angle = random() * Math.PI * 2,
      radius = 0.35 + random() * 0.44;
    transform.position.set(
      Math.cos(angle) * radius,
      0.55 + random() * 0.23,
      Math.sin(angle) * radius,
    );
    transform.updateMatrix();
    berries.setMatrixAt(i, transform.matrix);
  }
  leaves.receiveShadow = true;
  group.add(leaves, berries);
  group.userData.berries = berries;
  return group;
}

function woodenTool(role) {
  const group = new THREE.Group();
  const wood = material(0x745237),
    metal = material(0x717c7c, { metalness: 0.35 });
  group.add(
    mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.48, 6), wood, 0, -0.12, 0),
  );
  if (role === 'builder')
    group.add(mesh(new THREE.BoxGeometry(0.32, 0.14, 0.15), metal, 0, 0.12, 0));
  else {
    const bowl = mesh(
      new THREE.CylinderGeometry(0.17, 0.13, 0.23, 8),
      material(0x9b784b),
      0,
      -0.22,
      0,
    );
    group.add(bowl);
  }
  return group;
}

/** 3D presentation only. Decisions, collision, combat, and hunger live in Game. */
export class Renderer {
  constructor(canvas, game, { onSelect } = {}) {
    this.canvas = canvas;
    this.game = game;
    this.onSelect = onSelect;
    this.entities = new Map();
    this.structures = new Map();
    this.foodNodes = new Map();
    this.assets = new Map();
    this.assetsReady = false;
    this.assetBounds = new Map();
    this.worldLabels = [];
    this.lastSync = -Infinity;
    this.lastLabels = -Infinity;
    this.lastShadow = -Infinity;
    this.shadowDirty = true;
    this.lastZoom = -1;
    this.quality = 'normal';
    this.projected = new THREE.Vector3();
    this.drawCount = 0;
    this.hoveredId = null;
    this.hoveredBuildingId = null;
    this.labelRight = new THREE.Vector3();
    this.labelUp = new THREE.Vector3();
    this.labelBoxes = [];
    this.selectedId = game.units[0]?.id;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbac2aa);
    this.scene.fog = new THREE.Fog(0xbac2aa, 66, 108);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.OrthographicCamera(-20, 20, 17, -17, 0.1, 160);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minZoom = 0.7;
    this.controls.maxZoom = 2.5;
    this.controls.minPolarAngle = Math.PI / 6;
    this.controls.maxPolarAngle = Math.PI / 2.6;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.6;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.resetCamera();
    this.buildLandscape();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerDown = (event) => {
      this.down = { x: event.clientX, y: event.clientY };
    };
    this.pointerUp = (event) => {
      if (
        !this.down ||
        Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 6
      )
        return;
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(
        [...this.entities.values()]
          .filter((e) => e.role !== 'orc')
          .map((e) => e.hitbox),
        false,
      );
      if (hits.length) this.select(hits[0].object.userData.unitId, true);
    };
    this.pointerMove = (event) => {
      if (event.buttons || event.timeStamp - (this.lastHoverTime || 0) < 80)
        return;
      this.lastHoverTime = event.timeStamp;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const targets = [];
      for (const entity of this.entities.values()) targets.push(entity.hitbox);
      for (const structure of this.structures.values())
        targets.push(structure.model);
      const hit = this.raycaster.intersectObjects(targets, true)[0];
      this.hoveredId = null;
      this.hoveredBuildingId = null;
      let object = hit?.object;
      while (object) {
        if (object.userData.unitId) this.hoveredId = object.userData.unitId;
        if (object.userData.buildingId)
          this.hoveredBuildingId = object.userData.buildingId;
        object = object.parent;
      }
    };
    this.pointerLeave = () => {
      this.hoveredId = null;
      this.hoveredBuildingId = null;
    };
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointerup', this.pointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.ready = this.loadAssets();
  }

  resetCamera() {
    this.camera.position.set(42, 44, 53);
    this.controls.target.set(16, 0, 15.8);
    this.camera.zoom = 1.18;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  select(id, notify = false) {
    this.selectedId = id;
    if (notify) this.onSelect?.(id);
  }

  resize() {
    if (this.disposed) return;
    const width = this.canvas.parentElement.clientWidth || 640;
    const height = this.canvas.parentElement.clientHeight || 570;
    const size = width < 440 ? 33 : 31;
    this.camera.left = (-size * (width / height)) / 2;
    this.camera.right = (size * (width / height)) / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  buildLandscape() {
    const random = rng();
    this.scene.add(new THREE.HemisphereLight(0xfff6d9, 0x526944, 1.8));
    const sun = new THREE.DirectionalLight(0xffedc7, 2.5);
    sun.position.set(-12, 36, 12);
    sun.target.position.set(16, 0, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -29;
    sun.shadow.camera.right = 29;
    sun.shadow.camera.top = 29;
    sun.shadow.camera.bottom = -29;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 95;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun, sun.target);
    const floor = mesh(
      new THREE.PlaneGeometry(180, 180),
      material(0xbac2aa),
      16,
      -1.25,
      16,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    this.scene.add(floor);
    const base = mesh(
      new THREE.BoxGeometry(35, 1.2, 35),
      material(0x887e60),
      16,
      -0.66,
      16,
    );
    this.scene.add(base);
    const turf = mesh(
      new THREE.BoxGeometry(35.15, 0.14, 35.15),
      material(0x8f9f69),
      16,
      -0.04,
      16,
    );
    this.scene.add(turf);
    const ground = new THREE.PlaneGeometry(35.1, 35.1, 34, 34);
    ground.rotateX(-Math.PI / 2);
    const colors = [],
      green = new THREE.Color();
    for (let i = 0; i < ground.attributes.position.count; i++) {
      green.setHSL(
        0.235 + random() * 0.015,
        0.24 + random() * 0.04,
        0.43 + random() * 0.055,
      );
      green.convertSRGBToLinear();
      colors.push(green.r, green.g, green.b);
    }
    ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const top = mesh(
      ground,
      material(0xffffff, { vertexColors: true, flatShading: true }),
      16,
      0.038,
      16,
    );
    top.castShadow = false;
    this.scene.add(top);
    this.scene.add(
      pathMesh(
        [
          [16, 25],
          [16, 21],
          [16, 17],
          [16, 10],
          [18, 3],
        ],
        1.7,
      ),
    );
    this.scene.add(
      pathMesh(
        [
          [7, 17],
          [11, 18],
          [16, 20],
          [22, 18],
          [25, 16],
        ],
        1.25,
      ),
    );
    this.scene.add(
      pathMesh(
        [
          [12, 21],
          [14, 22],
          [18, 22],
          [20, 21],
        ],
        1.1,
      ),
    );
    this.scene.add(
      pathMesh(
        [
          [9, 7],
          [12, 10],
          [16, 12],
          [22, 9],
          [25, 6],
        ],
        0.9,
        0xa8aa82,
      ),
    );
    const plaza = mesh(
      new THREE.CylinderGeometry(4, 4, 0.018, 32),
      material(0xadae89),
      16,
      0.06,
      21,
    );
    plaza.castShadow = false;
    this.scene.add(plaza);
    const flowerGeometry = new THREE.ConeGeometry(0.075, 0.2, 4);
    const flowers = new THREE.InstancedMesh(
      flowerGeometry,
      material(0xffffff),
      150,
    );
    const flowerTransform = new THREE.Object3D(),
      flowerColor = new THREE.Color();
    let flowerCount = 0;
    for (let i = 0; i < 150; i++) {
      const x = random() * 34 - 1,
        z = random() * 34 - 1;
      if (Math.abs(x - 16) < 2 || (z > 15 && z < 25 && x > 9 && x < 23))
        continue;
      flowerTransform.position.set(x, 0.13, z);
      flowerTransform.rotation.z = (random() - 0.5) * 0.6;
      flowerTransform.updateMatrix();
      flowers.setMatrixAt(flowerCount, flowerTransform.matrix);
      flowers.setColorAt(
        flowerCount++,
        flowerColor.setHex([0xc7c790, 0xaa794f, 0xc9b884][i % 3]),
      );
    }
    flowers.count = flowerCount;
    this.scene.add(flowers);
    // The fire is a landmark; food and healing still follow the simulation's hall rules.
    this.fire = new THREE.Group();
    const stone = material(0x747768),
      wood = material(0x685139);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.fire.add(
        mesh(
          new THREE.DodecahedronGeometry(0.17, 0),
          stone,
          Math.cos(a) * 0.48,
          0.15,
          Math.sin(a) * 0.48,
        ),
      );
    }
    for (let i = 0; i < 3; i++) {
      const log = mesh(
        new THREE.CylinderGeometry(0.09, 0.12, 0.73, 6),
        wood,
        0,
        0.17,
        0,
      );
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i * Math.PI) / 3;
      this.fire.add(log);
    }
    this.flame = mesh(
      new THREE.ConeGeometry(0.25, 0.85, 5),
      material(0xffc463, { emissive: 0xe66e2e, emissiveIntensity: 0.8 }),
      0,
      0.5,
      0,
    );
    this.flame.castShadow = false;
    this.fire.add(this.flame);
    this.fire.position.set(16, 0.08, 22.9);
    this.scene.add(this.fire);
    this.embers = new THREE.Group();
    for (let i = 0; i < 9; i++)
      this.embers.add(
        mesh(
          new THREE.SphereGeometry(0.026, 4, 3),
          new THREE.MeshBasicMaterial({ color: 0xffd084 }),
          16,
          0.5,
          22.9,
        ),
      );
    this.scene.add(this.embers);
    const target = new THREE.Group();
    target.add(
      mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.3, 6), wood, 0, 0.6, 0),
    );
    const board = mesh(
      new THREE.CylinderGeometry(0.37, 0.37, 0.1, 12),
      material(0xbaa070),
      0,
      1,
      0,
    );
    board.rotation.x = Math.PI / 2;
    target.add(board);
    const mark = mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.105, 12),
      material(0x9d4d33),
      0,
      1,
      0.01,
    );
    mark.rotation.x = Math.PI / 2;
    target.add(mark);
    target.position.set(16, 0, 25.4);
    this.scene.add(target);
    this.createWorksites();
    const targetGeometry = new THREE.BufferGeometry();
    targetGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(6), 3),
    );
    targetGeometry.setAttribute(
      'lineDistance',
      new THREE.Float32BufferAttribute(new Float32Array(2), 1),
    );
    this.targetLine = new THREE.Line(
      targetGeometry,
      new THREE.LineDashedMaterial({
        color: 0xe7c66d,
        dashSize: 0.3,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.targetLine.renderOrder = 8;
    this.targetLine.visible = false;
    this.scene.add(this.targetLine);
    this.nameLeaders = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xeee7cb,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
      }),
    );
    this.nameLeaders.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(36), 3),
    );
    this.nameLeaders.geometry.setDrawRange(0, 0);
    this.nameLeaders.renderOrder = 9;
    this.scene.add(this.nameLeaders);
    this.projectileGeometry = new THREE.BufferGeometry();
    this.projectileGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(6 * 32), 3),
    );
    this.projectileLines = new THREE.LineSegments(
      this.projectileGeometry,
      new THREE.LineBasicMaterial({ color: 0xffdd97 }),
    );
    this.projectileGeometry.setDrawRange(0, 0);
    this.scene.add(this.projectileLines);
  }

  createWorksites() {
    const training = this.game.trainingGround || { x: 16, y: 25.4 };
    const clinic = this.game.clinic || { x: 22.5, y: 22.8 };
    const trainingDisc = mesh(
      new THREE.CircleGeometry(1.65, 32),
      new THREE.MeshBasicMaterial({
        color: 0xb28c58,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
      training.x,
      0.085,
      training.y,
    );
    trainingDisc.rotation.x = -Math.PI / 2;
    trainingDisc.castShadow = false;
    const clinicDisc = mesh(
      new THREE.CircleGeometry(1.55, 32),
      new THREE.MeshBasicMaterial({
        color: 0xb9d1b1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      clinic.x,
      0.085,
      clinic.y,
    );
    clinicDisc.rotation.x = -Math.PI / 2;
    clinicDisc.castShadow = false;
    this.scene.add(trainingDisc, clinicDisc);
    const wood = material(0x826a46),
      cloth = material(0xe5dcc1);
    const clinicProps = new THREE.Group();
    clinicProps.position.set(clinic.x, 0.07, clinic.y);
    clinicProps.add(
      mesh(new THREE.BoxGeometry(1.45, 0.16, 0.64), cloth, 0, 0.55, 0.25),
    );
    clinicProps.add(
      mesh(new THREE.BoxGeometry(0.14, 0.52, 0.54), wood, -0.55, 0.25, 0.25),
    );
    clinicProps.add(
      mesh(new THREE.BoxGeometry(0.14, 0.52, 0.54), wood, 0.55, 0.25, 0.25),
    );
    const sign = new THREE.Group();
    sign.add(
      mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.55, 6), wood, 0, 0.7, 0),
    );
    sign.add(mesh(new THREE.BoxGeometry(0.65, 0.65, 0.08), cloth, 0, 1.32, 0));
    const crossMat = material(0xa34b39);
    sign.add(
      mesh(new THREE.BoxGeometry(0.39, 0.12, 0.095), crossMat, 0, 1.32, 0.01),
    );
    sign.add(
      mesh(new THREE.BoxGeometry(0.12, 0.39, 0.1), crossMat, 0, 1.32, 0.013),
    );
    sign.position.set(1.1, 0, 0.15);
    clinicProps.add(sign);
    this.scene.add(clinicProps);
    const trainingLabel = label('⚔ TRAIN', '#765831');
    trainingLabel.position.set(training.x, 0.35, training.y + 1.5);
    trainingLabel.userData.pixels = 66;
    trainingLabel.userData.variant = 'tag';
    paintLabel(
      trainingLabel,
      '⚔ TRAIN',
      '#765831',
      null,
      null,
      'Fighters gain strength',
    );
    const clinicLabel = label('+ MEDIC', '#54704e');
    clinicLabel.position.set(clinic.x + 0.4, 0.3, clinic.y + 1.35);
    clinicLabel.userData.pixels = 66;
    clinicLabel.userData.variant = 'tag';
    paintLabel(
      clinicLabel,
      '+ MEDIC',
      '#54704e',
      null,
      null,
      'Field treatment · medics travel',
    );
    this.worldLabels.push(trainingLabel, clinicLabel);
    this.scene.add(trainingLabel, clinicLabel);
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'normal';
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.25),
    );
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.shadowDirty = true;
    this.resize();
  }

  stats() {
    return {
      draw_calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixel_ratio: this.renderer.getPixelRatio(),
      shadow_map_size: this.quality === 'low' ? 0 : 1024,
      rendered_frames: this.drawCount,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }

  scaleLabels() {
    // Pixel-sized labels remain legible when the user zooms out. Updating their
    // scale is cheap; their canvas content is independently limited to 10 Hz.
    const height = this.canvas.clientHeight || 570;
    const worldPerPixel =
      (this.camera.top - this.camera.bottom) / (height * this.camera.zoom);
    for (const title of this.worldLabels) {
      const width = title.userData.pixels * worldPerPixel;
      title.scale.set(width, width * title.userData.ratio, 1);
    }
  }

  layoutNpcLabels() {
    const width = this.canvas.clientWidth || 640,
      height = this.canvas.clientHeight || 570;
    const worldPerPixel =
      (this.camera.top - this.camera.bottom) / (height * this.camera.zoom);
    this.labelUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.labelRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const leaderPositions = this.nameLeaders.geometry.attributes.position;
    let leaderCount = 0;
    const boxes = this.labelBoxes;
    boxes.length = 0;
    // Reserve space for the hall plaque and keep names above, not over, models.
    for (const view of this.structures.values()) {
      if (!view.title.visible) continue;
      view.title.getWorldPosition(this.projected).project(this.camera);
      const w = view.title.userData.pixels,
        h = w * view.title.userData.ratio;
      boxes.push({
        x: ((this.projected.x + 1) * width) / 2,
        y: ((1 - this.projected.y) * height) / 2,
        w,
        h,
      });
    }
    const ordered = this.game.units
      .slice()
      .sort((a, b) =>
        a.id === this.selectedId
          ? -1
          : b.id === this.selectedId
            ? 1
            : a.y - b.y,
      );
    for (const unit of ordered) {
      const entity = this.entities.get(unit.id);
      if (!entity || !entity.title.visible) continue;
      const title = entity.title;
      title.position.set(0, entity.height + 0.42, 0);
      this.projected
        .set(unit.x, entity.height + 0.465, unit.y)
        .project(this.camera);
      const x = ((this.projected.x + 1) * width) / 2,
        y = ((1 - this.projected.y) * height) / 2;
      const w =
        title.userData.pixels *
        (title.userData.variant === 'selected' ? 0.95 : 0.74);
      const h = title.userData.pixels * title.userData.ratio;
      const offsets = [
        [0, 0],
        [-38, 0],
        [38, 0],
        [-38, 22],
        [38, 22],
        [0, 22],
        [-62, 22],
        [62, 22],
        [-38, 43],
        [38, 43],
      ];
      let chosen = offsets[0],
        least = Infinity;
      for (const offset of offsets) {
        const overlaps = boxes.filter(
          (box) =>
            Math.abs(x + offset[0] - box.x) < (w + box.w) / 2 + 2 &&
            Math.abs(y - offset[1] - box.y) < (h + box.h) / 2 + 2,
        ).length;
        if (overlaps < least) {
          chosen = offset;
          least = overlaps;
        }
        if (!overlaps) break;
      }
      title.position.addScaledVector(
        this.labelRight,
        chosen[0] * worldPerPixel,
      );
      title.position.addScaledVector(this.labelUp, chosen[1] * worldPerPixel);
      boxes.push({ x: x + chosen[0], y: y - chosen[1], w, h });
      if (chosen[0] || chosen[1]) {
        leaderPositions.setXYZ(
          leaderCount++,
          unit.x,
          entity.height + 0.23,
          unit.y,
        );
        leaderPositions.setXYZ(
          leaderCount++,
          unit.x + title.position.x,
          title.position.y - 0.14,
          unit.y + title.position.z,
        );
      }
    }
    leaderPositions.needsUpdate = true;
    this.nameLeaders.geometry.setDrawRange(0, leaderCount);
  }

  updateTargetLine() {
    const unit = this.game.units.find(
      (candidate) => candidate.id === this.selectedId,
    );
    const id = unit?.autoTargetId || unit?.targetId;
    let target = null;
    if (id) {
      target =
        this.game.units.find((candidate) => candidate.id === id) ||
        this.game.orcs.find((candidate) => candidate.id === id) ||
        this.game.buildings.find((candidate) => candidate.id === id) ||
        this.game.resources.find((candidate) => candidate.id === id);
      if (!target && id === 'training') target = this.game.trainingGround;
      if (!target && id === 'clinic') target = this.game.clinic;
    }
    this.targetLine.visible = !!(unit?.alive && target);
    if (!this.targetLine.visible) return;
    const positions = this.targetLine.geometry.attributes.position;
    positions.setXYZ(0, unit.x, 0.16, unit.y);
    positions.setXYZ(1, target.x, 0.16, target.y);
    positions.needsUpdate = true;
    this.targetLine.material.color.setHex(
      unit.needsOverride ? 0xe4b366 : 0xf6edd1,
    );
    const distances = this.targetLine.geometry.attributes.lineDistance;
    distances.setX(0, 0);
    distances.setX(1, Math.hypot(unit.x - target.x, unit.y - target.y));
    distances.needsUpdate = true;
  }

  async loadAssets() {
    const loader = new GLTFLoader();
    await Promise.all(
      [
        'knight',
        'rogue',
        'barbarian',
        'orc',
        'hall',
        'house',
        'tower',
        'wall',
        'tree',
        'rock',
      ].map(async (name) => {
        const gltf = await loader.loadAsync(ASSET(name));
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = ![
              'knight',
              'rogue',
              'barbarian',
              'orc',
            ].includes(name);
            child.receiveShadow = true;
            child.frustumCulled = !child.isSkinnedMesh;
          }
        });
        this.assets.set(name, gltf);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        this.assetBounds.set(name, {
          height: Math.max(0.01, box.max.y - box.min.y),
          bottom: box.min.y,
        });
      }),
    );
    if (this.disposed) return;
    this.assetsReady = true;
    this.shadowDirty = true;
    this.plantForest();
    this.syncObjects();
  }

  normalizedModel(name, height, animated = false) {
    const asset = this.assets.get(name);
    const model = animated
      ? cloneSkeleton(asset.scene)
      : asset.scene.clone(true);
    const bounds = this.assetBounds.get(name);
    const scale = height / bounds.height;
    const group = new THREE.Group();
    model.scale.setScalar(scale);
    model.position.y = -bounds.bottom * scale;
    group.add(model);
    return { group, model, asset, scale };
  }

  plantForest() {
    const random = rng(602);
    const candidates = [];
    for (let i = 0; i < 64; i++) {
      const edge = i % 4,
        along = random() * 34 - 1,
        inset = random() * 3.2 - 1;
      const x = edge === 0 ? inset : edge === 1 ? 32 - inset : along;
      const y = edge === 2 ? inset : edge === 3 ? 32 - inset : along;
      candidates.push([x, y, 2.9 + random() * 2.6]);
    }
    candidates.push(
      [4, 10, 3.9],
      [12, 4, 4.2],
      [28, 12, 4.1],
      [28, 25, 4.9],
      [6, 27, 4.6],
      [3, 23, 4.3],
    );
    this.instanceScenery('tree', candidates, random);
    const rocks = [];
    for (let i = 0; i < 16; i++) {
      const x = random() * 32,
        z = random() * 32;
      if (x > 7 && x < 25 && z > 12 && z < 27) continue;
      rocks.push([x, z, 0.3 + random() * 0.55]);
    }
    this.instanceScenery('rock', rocks, random);
  }

  instanceScenery(name, placements, random) {
    const asset = this.assets.get(name),
      bounds = this.assetBounds.get(name);
    const matrices = [];
    const transform = new THREE.Object3D();
    for (const [x, z, height] of placements) {
      const scale = height / bounds.height;
      transform.position.set(x, 0.06 - bounds.bottom * scale, z);
      transform.scale.setScalar(scale);
      transform.rotation.y = random() * Math.PI * 2;
      transform.updateMatrix();
      matrices.push(transform.matrix.clone());
    }
    asset.scene.updateMatrixWorld(true);
    const composed = new THREE.Matrix4();
    asset.scene.traverse((child) => {
      if (!child.isMesh) return;
      const batch = new THREE.InstancedMesh(
        child.geometry,
        child.material,
        placements.length,
      );
      for (let i = 0; i < matrices.length; i++) {
        composed.multiplyMatrices(matrices[i], child.matrixWorld);
        batch.setMatrixAt(i, composed);
      }
      batch.castShadow = name === 'tree';
      batch.receiveShadow = true;
      batch.computeBoundingSphere();
      this.scene.add(batch);
    });
  }

  createCharacter(unit, isOrc = false) {
    const role = isOrc ? 'orc' : unit.role;
    const name = isOrc
      ? 'orc'
      : { collector: 'rogue', fighter: 'knight', builder: 'barbarian' }[
          unit.role
        ];
    const height = isOrc ? 2.12 : 1.82;
    const { group, model, asset } = this.normalizedModel(name, height, true);
    const meshRoot = new THREE.Group();
    meshRoot.add(group);
    // Pack variants share a rig. Only the chosen role's equipment is visible.
    const equipment =
      /^(1H_|2H_|Badge_Shield|Rectangle_Shield|Round_Shield|Spike_Shield|Knife|Throwable|Barbarian_Round_Shield|Mug)/;
    model.traverse((child) => {
      if (equipment.test(child.name))
        child.visible =
          role === 'fighter' &&
          ['1H_Sword', 'Badge_Shield'].includes(child.name);
      if (role === 'builder' && child.name === 'Barbarian_Hat')
        child.visible = false;
    });
    if (!isOrc && role !== 'fighter') {
      const hand = model.getObjectByName('handslot.r');
      if (hand) hand.add(woodenTool(role));
    }
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    const blob = mesh(
      new THREE.CircleGeometry(0.48, 16),
      new THREE.MeshBasicMaterial({
        color: 0x3c4931,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      0,
      0.067,
      0,
    );
    blob.rotation.x = -Math.PI / 2;
    blob.castShadow = false;
    meshRoot.add(blob);
    const mixer = new THREE.AnimationMixer(model);
    const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
    const ring = mesh(
      new THREE.RingGeometry(0.43, 0.51, 32),
      new THREE.MeshBasicMaterial({
        color: ROLE_COLORS[role],
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
      0,
      0.075,
      0,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = false;
    const selection = mesh(
      new THREE.RingGeometry(0.62, 0.69, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe3a4,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
      0,
      0.08,
      0,
    );
    selection.rotation.x = -Math.PI / 2;
    selection.castShadow = false;
    meshRoot.add(ring, selection);
    const title = label(
      isOrc ? `ORC · ${unit.level || 1}` : unit.name,
      isOrc ? '#73404e' : '#35432c',
    );
    title.position.y = height + 0.4;
    title.userData.pixels = isOrc ? 64 : 86;
    title.userData.variant = 'npc';
    this.worldLabels.push(title);
    meshRoot.add(title);
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.8, 1.05),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hitbox.position.y = 0.8;
    hitbox.userData.unitId = unit.id;
    meshRoot.add(hitbox);
    const marker = mesh(
      new THREE.ConeGeometry(0.15, 0.3, 3),
      new THREE.MeshBasicMaterial({ color: 0xf7df9d }),
      0,
      height + 1.05,
      0,
    );
    marker.rotation.z = Math.PI;
    marker.castShadow = false;
    meshRoot.add(marker);
    this.scene.add(meshRoot);
    const entity = {
      id: unit.id,
      role,
      root: meshRoot,
      model: group,
      mixer,
      clips,
      title,
      ring,
      selection,
      marker,
      hitbox,
      height,
      lastX: unit.x,
      lastY: unit.y,
      moveSpeed: 0,
      animation: null,
      action: null,
    };
    this.entities.set(unit.id, entity);
    return entity;
  }

  createStructure(building) {
    const type = ['hall', 'house', 'wall', 'tower'].includes(building.type)
      ? building.type
      : 'house';
    const height = { hall: 3.1, house: 2.3, wall: 1.05, tower: 2.85 }[type];
    const { group, model } = this.normalizedModel(type, height);
    group.position.set(building.x, 0.04, building.y);
    model.userData.buildingId = building.id;
    if (type === 'wall') group.rotation.y = Math.PI / 2;
    model.traverse((child) => {
      if (child.isMesh)
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone();
    });
    const title = label(
      type === 'hall' ? 'THE HEARTH' : type === 'tower' ? 'DEFENSE' : '',
      '#6a674b',
    );
    title.position.y = height + 1.0;
    title.userData.pixels = type === 'hall' ? 114 : 85;
    this.worldLabels.push(title);
    group.add(title);
    const plan = mesh(
      new THREE.RingGeometry(0.8, 0.85, 4),
      new THREE.MeshBasicMaterial({
        color: 0xe5d8a9,
        transparent: true,
        opacity: 0.75,
      }),
      0,
      0.05,
      0,
    );
    plan.rotation.x = -Math.PI / 2;
    group.add(plan);
    this.scene.add(group);
    const entry = {
      group,
      model,
      title,
      plan,
      height,
      baseScale: model.scale.y,
      state: '',
    };
    this.structures.set(building.id, entry);
    this.shadowDirty = true;
    return entry;
  }

  syncObjects() {
    if (!this.assetsReady) return;
    const ids = new Set();
    for (const unit of this.game.units) {
      ids.add(unit.id);
      if (!this.entities.has(unit.id)) this.createCharacter(unit);
    }
    for (const orc of this.game.orcs) {
      ids.add(orc.id);
      if (!this.entities.has(orc.id)) this.createCharacter(orc, true);
    }
    for (const [id, entity] of this.entities) {
      if (!ids.has(id)) {
        entity.mixer.stopAllAction();
        this.scene.remove(entity.root);
        entity.title.material.map.dispose();
        entity.title.material.dispose();
        this.worldLabels.splice(this.worldLabels.indexOf(entity.title), 1);
        this.entities.delete(id);
      }
    }
    const structureIds = new Set(this.game.buildings.map((b) => b.id));
    for (const b of this.game.buildings)
      if (!this.structures.has(b.id)) this.createStructure(b);
    for (const [id, value] of this.structures)
      if (!structureIds.has(id)) {
        this.scene.remove(value.group);
        this.worldLabels.splice(this.worldLabels.indexOf(value.title), 1);
        value.title.material.map.dispose();
        value.title.material.dispose();
        this.structures.delete(id);
        this.shadowDirty = true;
      }
    for (const node of this.game.resources) {
      if (this.foodNodes.has(node.id)) continue;
      const random = rng(node.x * 1024 + node.y);
      const group = new THREE.Group();
      const plants = [];
      for (let i = 0; i < 3; i++) {
        const bush = berryBush(random);
        bush.position.set(
          Math.cos(i * 2.094) * 0.62,
          0.05,
          Math.sin(i * 2.094) * 0.62,
        );
        group.add(bush);
        plants.push(bush);
      }
      const title = label('FOOD', '#4e6645');
      title.position.y = 1.35;
      title.userData.pixels = 80;
      title.userData.variant = 'tag';
      this.worldLabels.push(title);
      group.add(title);
      group.position.set(node.x, 0.025, node.y);
      this.scene.add(group);
      this.foodNodes.set(node.id, { group, plants, title });
    }
  }

  animateCharacter(entity, unit, dt, now, updateLabel) {
    const dx = unit.x - entity.lastX,
      dy = unit.y - entity.lastY;
    const speed = Math.hypot(dx, dy) / Math.max(0.001, dt);
    entity.moveSpeed += (speed - entity.moveSpeed) * Math.min(1, dt * 12);
    entity.lastX = unit.x;
    entity.lastY = unit.y;
    entity.root.position.set(unit.x, 0.045, unit.y);
    const moving = entity.moveSpeed > 0.12;
    const heading = moving
      ? Math.atan2(dx, dy)
      : Number.isFinite(unit.heading)
        ? unit.heading
        : 0;
    const difference = Math.atan2(
      Math.sin(heading - entity.model.rotation.y),
      Math.cos(heading - entity.model.rotation.y),
    );
    entity.model.rotation.y += difference * Math.min(1, dt * 11);
    const activity = unit.activity || 'waiting';
    let animation;
    if (entity.role === 'orc')
      animation = !unit.alive
        ? 'Death'
        : moving
          ? 'Walk'
          : activity === 'fighting'
            ? 'Punch'
            : 'Idle';
    else
      animation = !unit.alive
        ? 'Death_A'
        : moving
          ? 'Walking_A'
          : activity === 'fighting' ||
              activity === 'training' ||
              activity === 'building' ||
              activity === 'repairing'
            ? '1H_Melee_Attack_Chop'
            : activity === 'gathering' ||
                activity === 'healing' ||
                activity === 'eating'
              ? 'Interact'
              : activity === 'resting'
                ? 'Sit_Floor_Idle'
                : 'Idle';
    if (animation !== entity.animation && entity.clips.has(animation)) {
      const action = entity.mixer.clipAction(entity.clips.get(animation));
      action.reset();
      action.setLoop(
        unit.alive ? THREE.LoopRepeat : THREE.LoopOnce,
        unit.alive ? Infinity : 1,
      );
      action.clampWhenFinished = !unit.alive;
      if (entity.action) {
        action.fadeIn(0.15).play();
        entity.action.fadeOut(0.15);
      } else {
        action.play();
        entity.mixer.update(0); // Show the initial idle pose even before play.
      }
      entity.action = action;
      entity.animation = animation;
    }
    // Walking follows actual position changes, not a stale high-level action.
    if (
      (this.game.running && unit.alive) ||
      (!unit.alive && entity.action?.isRunning())
    )
      entity.mixer.update(
        dt *
          (moving
            ? clamp(entity.moveSpeed / 1.7, 0.6, 1.7)
            : activity === 'eating'
              ? 0.8
              : 1),
      );
    const selected = unit.id === this.selectedId;
    entity.selection.visible = selected && unit.alive;
    entity.marker.visible = selected && unit.alive;
    entity.marker.position.y =
      entity.height + 0.3 + Math.sin(now * 0.003) * 0.08;
    entity.ring.visible = unit.alive;
    entity.title.visible = unit.alive || entity.role !== 'orc';
    entity.title.material.opacity = unit.alive ? 1 : 0.65;
    const expanded = selected || unit.id === this.hoveredId;
    entity.title.userData.pixels = expanded
      ? 102
      : entity.role === 'orc'
        ? 64
        : 86;
    entity.title.userData.variant = expanded ? 'selected' : 'npc';
    if (!updateLabel) return;
    const title = !unit.alive
      ? `${unit.name || 'Orc'} †`
      : entity.role === 'orc'
        ? `Orc ${unit.level || 1}`
        : `${ROLE_SYMBOLS[entity.role]} ${unit.name}`;
    const actionText = moving
      ? '→ Travelling'
      : ACTIVITY_LABELS[activity] || activity;
    const detail = unit.needsOverride
      ? `AUTO · ${actionText.replace(/^[^a-zA-Z]+/, '')}`
      : actionText;
    const numbers =
      entity.role === 'orc'
        ? `HP ${Math.ceil(unit.health)} / ${unit.maxHealth}`
        : `${Math.ceil(unit.health)} HP · ${Math.ceil(unit.hunger)} food`;
    paintLabel(
      entity.title,
      title,
      entity.role === 'orc' ? '#763d43' : selected ? '#253e2a' : '#344331',
      unit.health / unit.maxHealth,
      entity.role === 'orc' ? null : unit.hunger / 100,
      detail,
      numbers,
    );
  }

  draw(now, dt = 0.016) {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const updateLabel = now - this.lastLabels >= 100;
    if (updateLabel) this.lastLabels = now;
    if (now - this.lastSync >= 100) {
      this.syncObjects();
      this.lastSync = now;
    }
    for (const unit of this.game.units) {
      const entity = this.entities.get(unit.id);
      if (entity) this.animateCharacter(entity, unit, dt, now, updateLabel);
    }
    for (const unit of this.game.orcs) {
      const entity = this.entities.get(unit.id);
      if (entity) this.animateCharacter(entity, unit, dt, now, updateLabel);
    }
    for (const building of this.game.buildings) {
      const view = this.structures.get(building.id);
      if (!view) continue;
      const progress = building.progress ?? 1;
      const destroyed = !!building.destroyed;
      const state = `${progress < 1 ? 'plan' : 'done'}-${destroyed}`;
      view.group.position.set(building.x, 0.04, building.y);
      if (state !== view.state) {
        view.model.traverse((child) => {
          if (!child.isMesh) return;
          for (const mat of Array.isArray(child.material)
            ? child.material
            : [child.material]) {
            mat.transparent = progress < 1 || destroyed;
            mat.opacity = destroyed ? 0.35 : progress < 1 ? 0.27 : 1;
            mat.depthWrite = !destroyed && progress >= 1;
            mat.color.setHex(
              destroyed ? 0x686252 : progress < 1 ? 0xf4e6ba : 0xffffff,
            );
          }
          child.castShadow = progress >= 1 && !destroyed;
        });
        view.state = state;
        this.shadowDirty = true;
      }
      const scaleY =
        view.baseScale *
        (destroyed ? 0.23 : progress < 1 ? 0.35 + progress * 0.65 : 1);
      if (view.model.scale.y !== scaleY) this.shadowDirty = true;
      view.model.scale.y = scaleY;
      view.plan.visible = progress < 1 && !destroyed;
      const selectedUnit = this.game.units.find(
        (unit) => unit.id === this.selectedId,
      );
      const targeted =
        selectedUnit?.targetId === building.id ||
        selectedUnit?.autoTargetId === building.id;
      const damaged =
        progress >= 1 && building.health < building.maxHealth && !destroyed;
      view.title.visible =
        building.type === 'hall' ||
        damaged ||
        targeted ||
        this.hoveredBuildingId === building.id;
      view.title.position.y =
        (destroyed ? 0.5 : progress < 1 ? 1.45 : view.height) + 0.95;
      if (updateLabel && view.title.visible) {
        const name =
          building.type === 'hall'
            ? 'HALL · EAT'
            : building.type === 'tower'
              ? 'TOWER'
              : building.type.toUpperCase();
        paintLabel(
          view.title,
          destroyed ? `${name} · RUINS` : name,
          destroyed ? '#8d5944' : '#575e42',
          progress >= 1 ? building.health / building.maxHealth : progress,
          null,
          destroyed
            ? 'Repair unavailable'
            : progress < 1
              ? `⚒ Build ${Math.round(progress * 100)}%`
              : building.type === 'hall'
                ? `● Eat here · ${Math.floor(this.game.food)} food`
                : '⚒ Builders repair here',
          progress < 1
            ? `Build ${Math.round(progress * 100)}%`
            : `${Math.ceil(building.health)} / ${building.maxHealth} HP`,
        );
      }
    }
    for (const node of this.game.resources) {
      const view = this.foodNodes.get(node.id);
      if (!view) continue;
      for (const plant of view.plants)
        plant.userData.berries.visible = node.food > 0;
      if (updateLabel)
        paintLabel(
          view.title,
          `◆ ${Math.floor(node.food)} food`,
          node.food > 0 ? '#435d34' : '#7a755c',
          null,
          null,
          `${Math.floor(node.food)} portions remaining`,
        );
    }
    const pulse = 1 + Math.sin(now * 0.013) * 0.16;
    this.flame.scale.set(
      0.9 + Math.sin(now * 0.018) * 0.09,
      pulse,
      0.9 + Math.cos(now * 0.015) * 0.08,
    );
    this.flame.rotation.y = now * 0.001;
    this.embers.children.forEach((spark, i) => {
      const life = (now * 0.0005 + i / 9) % 1;
      spark.position.set(
        16 + Math.sin(now * 0.0013 + i) * life * 0.34,
        0.45 + life * 1.6,
        22.9 + Math.cos(now * 0.001 + i) * life * 0.3,
      );
      spark.scale.setScalar(1 - life);
    });
    const positions = this.projectileGeometry.attributes.position;
    let count = 0;
    const projectiles = this.game.projectiles || [];
    for (let i = 0; i < projectiles.length && i < 32; i++) {
      const arrow = projectiles[i];
      const fraction = clamp(
        (this.game.time - arrow.born) /
          Math.max(0.001, arrow.expires - arrow.born),
        0,
        1,
      );
      const x = THREE.MathUtils.lerp(arrow.x, arrow.targetX, fraction),
        z = THREE.MathUtils.lerp(arrow.y, arrow.targetY, fraction);
      const y = 2.2 * (1 - fraction) + Math.sin(fraction * Math.PI) * 0.8 + 0.4;
      positions.setXYZ(count++, x, y, z);
      positions.setXYZ(
        count++,
        x - (arrow.targetX - arrow.x) * 0.03,
        y + 0.08,
        z - (arrow.targetY - arrow.y) * 0.03,
      );
    }
    if (count || this.projectileGeometry.drawRange.count)
      positions.needsUpdate = true;
    this.projectileGeometry.setDrawRange(0, count);
    this.controls.update();
    this.updateTargetLine();
    this.scaleLabels();
    if (updateLabel) this.layoutNpcLabels();
    if (this.shadowDirty && now - this.lastShadow >= 350) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadow = now;
      this.shadowDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.drawCount++;
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointermove', this.pointerMove);
    this.canvas.removeEventListener('pointerleave', this.pointerLeave);
    this.controls.dispose();
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const entries = object.material
        ? Array.isArray(object.material)
          ? object.material
          : [object.material]
        : [];
      for (const value of entries) {
        materials.add(value);
        if (value.map) textures.add(value.map);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    this.renderer.dispose();
  }
}
