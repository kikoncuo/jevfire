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

function label(text, color = '#344132', width = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      toneMapped: false,
    }),
  );
  sprite.scale.set(2.5, 0.625, 1);
  sprite.renderOrder = 10;
  sprite.userData = { canvas, texture, text, color, state: '' };
  paintLabel(sprite, text, color);
  return sprite;
}

function paintLabel(sprite, text, color, health = null, hunger = null) {
  const state = [
    text,
    color,
    health === null ? '' : Math.ceil(health * 20),
    hunger === null ? '' : Math.ceil(hunger * 20),
  ].join('/');
  if (state === sprite.userData.state) return;
  sprite.userData.state = state;
  const { canvas, texture } = sprite.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 27px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(243,239,221,.92)';
  ctx.strokeText(text, canvas.width / 2, 30);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, 30);
  if (health !== null) {
    ctx.fillStyle = '#3b453bcc';
    ctx.fillRect(56, 41, canvas.width - 112, 7);
    ctx.fillStyle = health < 0.35 ? '#bc573b' : '#64855d';
    ctx.fillRect(57, 42, (canvas.width - 114) * clamp(health, 0, 1), 5);
  }
  if (hunger !== null) {
    ctx.fillStyle = '#4b483c99';
    ctx.fillRect(56, 51, canvas.width - 112, 5);
    ctx.fillStyle = '#dbb364';
    ctx.fillRect(57, 52, (canvas.width - 114) * clamp(hunger, 0, 1), 3);
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
  const leaves = [material(0x6c8043), material(0x7b9150), material(0x566d39)];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4;
    const bush = mesh(
      new THREE.IcosahedronGeometry(0.47, 0),
      leaves[i % 3],
      Math.cos(a) * 0.45,
      0.38 + random() * 0.15,
      Math.sin(a) * 0.45,
    );
    bush.scale.set(1, 0.86, 1);
    group.add(bush);
  }
  const berries = new THREE.Group(),
    berryMat = material(0xa54e43);
  for (let i = 0; i < 13; i++) {
    const a = random() * Math.PI * 2,
      r = 0.35 + random() * 0.44;
    berries.add(
      mesh(
        new THREE.IcosahedronGeometry(0.09, 0),
        berryMat,
        Math.cos(a) * r,
        0.55 + random() * 0.23,
        Math.sin(a) * r,
      ),
    );
  }
  group.add(berries);
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
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
    sun.shadow.mapSize.set(2048, 2048);
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
    const flowerMats = [
      material(0xc7c790),
      material(0xaa794f),
      material(0xc9b884),
    ];
    for (let i = 0; i < 150; i++) {
      const x = random() * 34 - 1,
        z = random() * 34 - 1;
      if (Math.abs(x - 16) < 2 || (z > 15 && z < 25 && x > 9 && x < 23))
        continue;
      const flower = mesh(
        new THREE.ConeGeometry(0.075, 0.2, 4),
        flowerMats[i % 3],
        x,
        0.13,
        z,
      );
      flower.rotation.z = (random() - 0.5) * 0.6;
      flower.castShadow = false;
      this.scene.add(flower);
    }
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
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
          }
        });
        this.assets.set(name, gltf);
      }),
    );
    if (this.disposed) return;
    this.assetsReady = true;
    this.plantForest();
    this.syncObjects();
  }

  normalizedModel(name, height, animated = false) {
    const asset = this.assets.get(name);
    const model = animated
      ? cloneSkeleton(asset.scene)
      : asset.scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const dimensions = box.getSize(new THREE.Vector3());
    const scale = height / Math.max(0.01, dimensions.y);
    const group = new THREE.Group();
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
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
    for (const [x, z, height] of candidates) {
      const { group } = this.normalizedModel('tree', height);
      group.position.set(x, 0.06, z);
      group.rotation.y = random() * Math.PI * 2;
      this.scene.add(group);
    }
    for (let i = 0; i < 16; i++) {
      const x = random() * 32,
        z = random() * 32;
      if (x > 7 && x < 25 && z > 12 && z < 27) continue;
      const { group } = this.normalizedModel('rock', 0.3 + random() * 0.55);
      group.position.set(x, 0.04, z);
      group.rotation.y = random() * Math.PI;
      this.scene.add(group);
    }
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
    title.position.y = height + 0.42;
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
    title.position.y = height + 0.35;
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
        this.entities.delete(id);
      }
    }
    const structureIds = new Set(this.game.buildings.map((b) => b.id));
    for (const b of this.game.buildings)
      if (!this.structures.has(b.id)) this.createStructure(b);
    for (const [id, value] of this.structures)
      if (!structureIds.has(id)) {
        this.scene.remove(value.group);
        this.structures.delete(id);
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
      title.position.y = 1.37;
      title.scale.set(2.1, 0.525, 1);
      group.add(title);
      group.position.set(node.x, 0.025, node.y);
      this.scene.add(group);
      this.foodNodes.set(node.id, { group, plants, title });
    }
  }

  animateCharacter(entity, unit, dt, now) {
    entity.root.position.set(unit.x, 0.045, unit.y);
    const heading = Number.isFinite(unit.heading) ? unit.heading : 0;
    const difference = Math.atan2(
      Math.sin(heading - entity.model.rotation.y),
      Math.cos(heading - entity.model.rotation.y),
    );
    entity.model.rotation.y += difference * Math.min(1, dt * 11);
    let animation;
    if (entity.role === 'orc')
      animation = !unit.alive
        ? 'Death'
        : unit.activity === 'fighting'
          ? 'Punch'
          : unit.activity === 'roaming' || unit.activity === 'walking'
            ? 'Walk'
            : 'Idle';
    else
      animation = !unit.alive
        ? 'Death_A'
        : unit.activity === 'walking'
          ? 'Walking_A'
          : ['fighting', 'training'].includes(unit.activity)
            ? '1H_Melee_Attack_Chop'
            : ['building', 'repairing'].includes(unit.activity)
              ? '1H_Melee_Attack_Chop'
              : unit.activity === 'gathering'
                ? 'Interact'
                : 'Idle';
    if (animation !== entity.animation && entity.clips.has(animation)) {
      const action = entity.mixer.clipAction(entity.clips.get(animation));
      action.reset();
      action.setLoop(
        unit.alive ? THREE.LoopRepeat : THREE.LoopOnce,
        unit.alive ? Infinity : 1,
      );
      action.clampWhenFinished = !unit.alive;
      action.fadeIn(0.15).play();
      entity.action?.fadeOut(0.15);
      entity.action = action;
      entity.animation = animation;
    }
    if (this.game.running || !unit.alive)
      entity.mixer.update(dt * (unit.activity === 'walking' ? 1.2 : 1));
    // A reset reuses IDs; rewind a finished death clip on its next living action.
    const selected = unit.id === this.selectedId;
    entity.selection.visible = selected && unit.alive;
    entity.marker.visible = selected && unit.alive;
    entity.marker.position.y =
      entity.height + 0.96 + Math.sin(now * 0.003) * 0.08;
    entity.ring.visible = unit.alive;
    entity.title.visible = unit.alive || entity.role !== 'orc';
    const title = !unit.alive
      ? `${unit.name || 'Orc'} †`
      : entity.role === 'orc'
        ? `ORC · ${unit.level || 1}`
        : unit.name;
    paintLabel(
      entity.title,
      title,
      entity.role === 'orc' ? '#763d43' : '#344331',
      unit.health / unit.maxHealth,
      entity.role === 'orc' ? null : unit.hunger / 100,
    );
    entity.title.material.opacity = unit.alive ? 1 : 0.5;
  }

  draw(now, dt = 0.016) {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.syncObjects();
    for (const unit of [...this.game.units, ...this.game.orcs]) {
      const entity = this.entities.get(unit.id);
      if (entity) this.animateCharacter(entity, unit, dt, now);
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
      }
      view.model.scale.y =
        view.baseScale *
        (destroyed ? 0.23 : progress < 1 ? 0.35 + progress * 0.65 : 1);
      view.plan.visible = progress < 1 && !destroyed;
      const injured = building.health < building.maxHealth && progress >= 1;
      view.title.visible =
        building.type === 'hall' || injured || (progress > 0 && progress < 1);
      view.title.position.y =
        (destroyed ? 0.6 : progress < 1 ? 1.45 : view.height) + 0.45;
      paintLabel(
        view.title,
        destroyed
          ? 'RUINS'
          : progress < 1
            ? `BUILD ${Math.round(progress * 100)}%`
            : building.type === 'hall'
              ? 'THE HEARTH'
              : building.type.toUpperCase(),
        '#575e42',
        injured ? building.health / building.maxHealth : null,
      );
    }
    for (const node of this.game.resources) {
      const view = this.foodNodes.get(node.id);
      if (!view) continue;
      for (const plant of view.plants)
        plant.userData.berries.visible = node.food > 0;
      paintLabel(
        view.title,
        `FOOD · ${Math.floor(node.food)}`,
        node.food > 0 ? '#435d34' : '#7a755c',
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
    for (const arrow of (this.game.projectiles || []).slice(0, 32)) {
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
    positions.needsUpdate = true;
    this.projectileGeometry.setDrawRange(0, count);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
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
