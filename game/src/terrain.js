// The static 3D world: sky, sea, terrain, river, runways, trees, volcano, clouds.
// Everything here is built once at boot and never recomputed per frame — the only things that
// move are the plane, the rings and the clouds' slow drift is baked into their placement.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { ISLANDS, RUNWAYS, groundAt, onRunwayPlateau } from './world.js';
import { createRandom, fbm2 } from './random.js';
import { SEED } from './world.js';

const SUN_DIR = new THREE.Vector3(-0.9, 0.22, -0.28).normalize();
const TERRAIN_CENTER = { x: 1350, z: -450 };

/** The home island's river, from its spring pond down to the south-west shore. */
const RIVER_POINTS = [
  [140, 280], [80, 400], [-40, 500], [-180, 590], [-330, 660], [-470, 730], [-560, 800],
];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a, b, t) {
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** Merge a list of { geometry, matrix } into one BufferGeometry (positions + normals + index). */
function mergeParts(parts) {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index.count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    const nor = p.geometry.attributes.normal;
    normalMatrix.getNormalMatrix(p.matrix);
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      positions[(vOff + i) * 3] = v.x;
      positions[(vOff + i) * 3 + 1] = v.y;
      positions[(vOff + i) * 3 + 2] = v.z;
      normals[(vOff + i) * 3] = n.x;
      normals[(vOff + i) * 3 + 1] = n.y;
      normals[(vOff + i) * 3 + 2] = n.z;
    }
    const idx = p.geometry.index;
    for (let i = 0; i < idx.count; i += 1) index[iOff + i] = idx.array[i] + vOff;
    vOff += pos.count;
    iOff += idx.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

function buildSky(scene) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      mid: { value: new THREE.Color(PALETTE.skyMid) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color(PALETTE.sun) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vDir;',
      'uniform vec3 top, mid, horizon, sunDir, sunColor;',
      'void main(){',
      '  float h = clamp(vDir.y, -0.05, 1.0);',
      '  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));',
      '  col = mix(col, top, smoothstep(0.2, 0.65, h));',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);',
      '  col += sunColor * (pow(s, 220.0) * 1.2 + pow(s, 10.0) * 0.28);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 16), skyMat);
  scene.add(sky);

  // The sun's glow: a soft radial sprite sitting low in the west.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 240, 200, 1)');
  grad.addColorStop(0.25, 'rgba(255, 210, 140, 0.55)');
  grad.addColorStop(1, 'rgba(255, 170, 80, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  glow.position.copy(SUN_DIR).multiplyScalar(8200);
  glow.scale.set(3200, 3200, 1);
  scene.add(glow);

  const sun = new THREE.DirectionalLight(0xffd9a0, 1.7);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a7fc0, 0x3d5a4a, 0.75));
  scene.fog = new THREE.Fog(0xf7a56a, 1800, 9500);
}

function buildTerrainMesh(scene) {
  const geo = new THREE.PlaneGeometry(11000, 8000, 180, 130);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(PALETTE.sand);
  const cGrassA = new THREE.Color(PALETTE.grassA);
  const cGrassB = new THREE.Color(PALETTE.grassB);
  const cRock = new THREE.Color(PALETTE.rock);
  const cAsh = new THREE.Color(PALETTE.ash);
  const cSeabed = new THREE.Color(PALETTE.seabed);
  const c = new THREE.Color();
  const c2 = new THREE.Color();
  const volcano = ISLANDS[2];
  for (let i = 0; i < pos.count; i += 1) {
    const wx = pos.getX(i) + TERRAIN_CENTER.x;
    const wz = pos.getZ(i) + TERRAIN_CENTER.z;
    const h = groundAt(wx, wz);
    pos.setY(i, h);
    const slope = Math.abs(groundAt(wx + 25, wz) - groundAt(wx - 25, wz)) / 50
      + Math.abs(groundAt(wx, wz + 25) - groundAt(wx, wz - 25)) / 50;
    const n = fbm2(wx, wz, SEED + 3);
    if (h < 0.3) c.copy(cSeabed);
    else if (h < 3.2) c.copy(cSand).lerp(cGrassA, smoothstep(1.2, 3.2, h));
    else c.copy(cGrassA).lerp(cGrassB, 0.5 + 0.5 * n);
    if (slope > 0.45) c.lerp(cRock, smoothstep(0.45, 0.9, slope));
    const dvx = wx - volcano.x;
    const dvz = wz - volcano.z;
    if (dvx * dvx + dvz * dvz < volcano.radius * volcano.radius) {
      if (h > 470) c.copy(cAsh).lerp(cRock, 0.25 + 0.25 * n);
      else if (h > 120) {
        const band = 0.5 + 0.5 * Math.sin(h * 0.14 + n * 2.5);
        c2.copy(cRock).lerp(cAsh, band * 0.55);
        c.lerp(c2, 0.75);
      }
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.set(TERRAIN_CENTER.x, 0, TERRAIN_CENTER.z);
  scene.add(mesh);
}

function buildSea(scene, rng) {
  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(7500, 48),
    new THREE.MeshPhongMaterial({ color: PALETTE.sea, shininess: 140, specular: 0xffd9a0 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(TERRAIN_CENTER.x, 0.15, TERRAIN_CENTER.z);
  scene.add(sea);

  // Sun glitter: a band of small bright quads on the water toward the setting sun.
  const glitterMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b0, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const quads = [];
  for (let i = 0; i < 240; i += 1) {
    const g = new THREE.PlaneGeometry(rng.range(5, 14), rng.range(1.5, 3));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(rng.range(-4500, -300), 0.3, rng.range(-1400, 900));
    quads.push({ geometry: g, matrix: m });
  }
  const glitter = new THREE.Mesh(mergeParts(quads), glitterMat);
  scene.add(glitter);
}

function buildRiver(scene) {
  const width = 20;
  const positions = [];
  const index = [];
  for (let i = 0; i < RIVER_POINTS.length; i += 1) {
    const [x, z] = RIVER_POINTS[i];
    const [nx, nz] = RIVER_POINTS[Math.min(i + 1, RIVER_POINTS.length - 1)];
    const [px, pz] = RIVER_POINTS[Math.max(i - 1, 0)];
    let dx = nx - px;
    let dz = nz - pz;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len;
    dz /= len;
    const y = groundAt(x, z) + 0.5;
    positions.push(x - dz * width / 2, y, z + dx * width / 2);
    positions.push(x + dz * width / 2, y, z - dx * width / 2);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const river = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x4aa8d8, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
  }));
  scene.add(river);

  // The spring pond the river starts from.
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(26, 20),
    new THREE.MeshLambertMaterial({ color: 0x4aa8d8 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(RIVER_POINTS[0][0], groundAt(RIVER_POINTS[0][0], RIVER_POINTS[0][1]) + 0.5, RIVER_POINTS[0][1]);
  scene.add(pond);
}

function numberTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = '#f2f2e8';
  ctx.font = '900 96px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function buildRunways(scene) {
  for (const r of RUNWAYS) {
    const group = new THREE.Group();
    group.position.set(r.x, r.height + 0.06, r.z);
    group.rotation.y = -r.heading;
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(r.width, r.length),
      new THREE.MeshLambertMaterial({ color: PALETTE.asphalt }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    group.add(asphalt);
    const markMat = new THREE.MeshBasicMaterial({ color: PALETTE.marking });
    for (let d = -r.length / 2 + 60; d < r.length / 2 - 50; d += 60) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 26), markMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.04, d);
      group.add(dash);
    }
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.2, r.length - 10), markMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(side * (r.width / 2 - 1.5), 0.04, 0);
      group.add(edge);
      for (const end of [-1, 1]) {
        for (let b = -1; b <= 1; b += 1) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(3, 16), markMat);
          bar.rotation.x = -Math.PI / 2;
          bar.position.set(b * 6, 0.04, end * (r.length / 2 - 26));
          group.add(bar);
        }
      }
    }
    for (let i = 0; i < 2; i += 1) {
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 11),
        new THREE.MeshBasicMaterial({ map: numberTexture(r.numbers[i]), transparent: true }),
      );
      num.rotation.x = -Math.PI / 2;
      num.rotation.z = i === 0 ? Math.PI : 0;
      num.position.set(0, 0.05, (i === 0 ? -1 : 1) * (r.length / 2 - 52));
      group.add(num);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    const lightGeo = new THREE.SphereGeometry(0.9, 6, 5);
    for (let d = -r.length / 2 + 10; d <= r.length / 2 - 10; d += 45) {
      for (const side of [-1, 1]) {
        const light = new THREE.Mesh(lightGeo, lightMat);
        light.position.set(side * (r.width / 2 + 2), 0.6, d);
        group.add(light);
      }
    }
    scene.add(group);
  }
}

function distToRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i += 1) {
    const [ax, az] = RIVER_POINTS[i];
    const [bx, bz] = RIVER_POINTS[i + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
  }
  return best;
}

function buildTrees(scene, rng) {
  const spots = [];
  const boxes = [[-900, 900, -900, 900], [900, 2100, -1500, -300]];
  let guard = 0;
  while (spots.length < 650 && guard < 20000) {
    guard += 1;
    const box = boxes[guard % 2];
    const x = rng.range(box[0], box[1]);
    const z = rng.range(box[2], box[3]);
    const h = groundAt(x, z);
    if (h < 3 || h > 42) continue;
    if (onRunwayPlateau(x, z)) continue;
    if (distToRiver(x, z) < 32) continue;
    spots.push([x, h, z, rng.range(0.8, 1.5)]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.45, 0.75, 3, 5);
  const coneGeo = new THREE.ConeGeometry(3.4, 9, 6);
  const cone2Geo = new THREE.ConeGeometry(2.3, 6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const cones = new THREE.InstancedMesh(coneGeo, leafMat, spots.length);
  const cones2 = new THREE.InstancedMesh(cone2Geo, leafMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach(([x, h, z, scale], i) => {
    s.set(scale, scale, scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    p.set(x, h + 1.5 * scale, z);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    p.set(x, h + (3 + 4.5) * scale, z);
    m.compose(p, q, s);
    cones.setMatrixAt(i, m);
    p.set(x, h + (3 + 8) * scale, z);
    m.compose(p, q, s);
    cones2.setMatrixAt(i, m);
    col.setHSL(0.33 + rng.next() * 0.04, 0.55, 0.28 + rng.next() * 0.12);
    cones.setColorAt(i, col);
    cones2.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;
  cones2.instanceMatrix.needsUpdate = true;
  if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
  if (cones2.instanceColor) cones2.instanceColor.needsUpdate = true;
  scene.add(trunks);
  scene.add(cones);
  scene.add(cones2);
}

function buildVolcanoDetails(scene) {
  const v = ISLANDS[2];
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(120, 24),
    new THREE.MeshLambertMaterial({ color: 0x3a3230 }),
  );
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(v.x, 556, v.z); // the crater floor, not the rim
  scene.add(crater);

  // The lighthouse on the volcano's north shoulder.
  const lx = v.x;
  const lz = v.z - 190;
  const gy = groundAt(lx, lz);
  const house = new THREE.Group();
  house.position.set(lx, gy, lz);
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.2, 15, 10),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  tower.position.y = 7.5;
  house.add(tower);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 2.4, 10),
    new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
  );
  band.position.y = 10;
  house.add(band);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
  );
  lamp.position.y = 16.5;
  house.add(lamp);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 233, 160, 0.9)');
  grad.addColorStop(1, 'rgba(255, 233, 160, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 16.5;
  glow.scale.set(26, 26, 1);
  house.add(glow);
  scene.add(house);
}

function buildClouds(scene, rng) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const clusters = 14;
  for (let c = 0; c < clusters; c += 1) {
    const cx = rng.range(-3200, 5600);
    const cz = rng.range(-3200, 2600);
    const cy = c < 4 ? rng.range(140, 200) : rng.range(280, 520);
    const puffs = 3 + Math.floor(rng.next() * 3);
    const parts = [];
    for (let i = 0; i < puffs; i += 1) {
      const g = new THREE.SphereGeometry(1, 10, 8);
      const m = new THREE.Matrix4();
      const sx = rng.range(45, 95);
      const sy = rng.range(13, 22);
      const sz = rng.range(32, 60);
      m.makeScale(sx, sy, sz);
      m.setPosition(cx + rng.range(-70, 70), cy + rng.range(-8, 14), cz + rng.range(-50, 50));
      parts.push({ geometry: g, matrix: m });
    }
    const cloud = new THREE.Mesh(mergeParts(parts), mat);
    scene.add(cloud);
  }
}

/** Build the whole static world into the scene. */
export function buildWorld(scene) {
  const rng = createRandom(SEED + 5);
  buildSky(scene);
  buildTerrainMesh(scene);
  buildSea(scene, rng);
  buildRiver(scene);
  buildRunways(scene);
  buildTrees(scene, rng);
  buildVolcanoDetails(scene);
  buildClouds(scene, rng);
}
