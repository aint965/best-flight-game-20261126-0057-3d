// The static 3D world: sky, sea, terrain, river, runways, trees, volcano, clouds.
// Everything here is built once at boot and never recomputed per frame — the only things that
// move are the plane, the rings and the clouds' slow drift is baked into their placement.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { ISLANDS, RUNWAYS, groundAt, onRunwayPlateau } from './world.js';
import { createRandom, fbm2, valueNoise } from './random.js';
import { SEED } from './world.js';

const SUN_DIR = new THREE.Vector3(-0.9, 0.22, -0.28).normalize();
const TERRAIN_CENTER = { x: 1350, z: -450 };

/** The home island's river, from its spring pond down to the north-west shore.
 *  Stage C, second pass: it used to flow south-west, which put it outside the
 *  landing frame (the camera looks north) — now it meanders north-west across the
 *  island, passing just west of the strip, so the landing frame shows it as a
 *  winding band crossing the whole shot. It never crosses the asphalt: the closest
 *  point (30, 150) stays 15 m east of the strip edge. */
const RIVER_POINTS = [
  [140, 280], [90, 220], [30, 150], [-50, 90], [-110, 20], [-180, -60],
  [-280, -180], [-420, -330], [-560, -480], [-700, -620], [-820, -760],
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

/** Merge parts that also carry a constant colour each (cloud puffs): positions, normals,
 *  index and a per-vertex colour attribute. */
function mergePartsColor(parts) {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index.count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
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
      colors[(vOff + i) * 3] = p.color.r;
      colors[(vOff + i) * 3 + 1] = p.color.g;
      colors[(vOff + i) * 3 + 2] = p.color.b;
    }
    const idx = p.geometry.index;
    for (let i = 0; i < idx.count; i += 1) index[iOff + i] = idx.array[i] + vOff;
    vOff += pos.count;
    iOff += idx.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
  const cGrassDark = new THREE.Color(PALETTE.grassDark);
  const cRock = new THREE.Color(PALETTE.rock);
  const cRockDark = new THREE.Color(PALETTE.rockDark);
  const cAsh = new THREE.Color(PALETTE.ash);
  const cSeabed = new THREE.Color(PALETTE.seabed);
  const cRim = new THREE.Color(0xe8e2d4);
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
    // Grass: three stops across the rolling noise plus dark patches and fine grain,
    // so the ground reads mottled instead of one flat olive field. Stage C deepens
    // the mottling (the landing foreground was still flat olive) with a finer speckle
    // octave and darker, more frequent patches.
    const fine = valueNoise(wx, wz, 55, SEED + 13);
    const speckle = valueNoise(wx, wz, 12, SEED + 23);
    if (h < 0.3) c.copy(cSeabed);
    else if (h < 3.2) c.copy(cSand).lerp(cGrassA, smoothstep(1.2, 3.2, h));
    else {
      const t = clamp(0.5 + 0.5 * n + fine * 0.45 + speckle * 0.12, 0, 1);
      if (t < 0.5) c.copy(cGrassA).lerp(cGrassDark, t * 1.1);
      else c.copy(cGrassA).lerp(cGrassB, (t - 0.5) * 2);
      if (fbm2(wx, wz, SEED + 17) > 0.3) c.multiplyScalar(0.65);
      c.offsetHSL(0, 0, fine * 0.12 + speckle * 0.03);
    }
    if (slope > 0.45) c.lerp(cRock, smoothstep(0.45, 0.9, slope));
    const dvx = wx - volcano.x;
    const dvz = wz - volcano.z;
    if (dvx * dvx + dvz * dvz < volcano.radius * volcano.radius) {
      // The volcano is rock, not a smooth brown cone: wide height bands the mesh can
      // actually resolve, dark radial gullies running down the slope, and a pale ash
      // cap with a bright rim ring around the crater. Stage C pushes the band and
      // gully contrast harder (the Stage B strata read, but softly).
      const ang = Math.atan2(dvz, dvx);
      const streak = 0.5 + 0.5 * valueNoise(ang * 14, h * 0.08, 1, SEED + 31);
      if (h > 420) {
        c.copy(cAsh).lerp(cRock, 0.12 + 0.15 * n);
        if (h > 535 && h < 565) c.lerp(cRim, 0.45);
      } else if (h > 120) {
        const band = 0.5 + 0.5 * Math.sin(h * 0.065 + n * 2.2);
        c2.copy(cRockDark).lerp(cAsh, band * 0.8);
        c.lerp(c2, 0.9);
        c.multiplyScalar(0.7 + 0.6 * streak);
      } else {
        c.lerp(cRock, 0.4);
        c.multiplyScalar(0.75 + 0.5 * streak);
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
    new THREE.MeshPhongMaterial({ color: PALETTE.sea, shininess: 180, specular: 0xffd9a0 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(TERRAIN_CENTER.x, 0.15, TERRAIN_CENTER.z);
  scene.add(sea);

  // Sun glitter: a band of bright quads on the water toward the setting sun, big
  // enough to read at a kilometre (the Stage A quads were sub-pixel and invisible).
  // Stage C adds a dense glitter BAND along the sun's line (z ≈ -150, running east
  // from the sunset toward the volcano), so the cover frame — which looks east,
  // away from the sun — still shows a glitter path on the sea leading to the hero.
  const glitterMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b0, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const quads = [];
  for (let i = 0; i < 420; i += 1) {
    const g = new THREE.PlaneGeometry(rng.range(14, 34), rng.range(3, 7));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(rng.range(-5200, 2200), 0.3, rng.range(-2600, 2200));
    quads.push({ geometry: g, matrix: m });
  }
  for (let i = 0; i < 200; i += 1) {
    // Stage C, second pass: 10-20 m long and 2-4 m wide — the first pass used
    // 18-44 m quads and they read as white planks scattered on the water.
    const g = new THREE.PlaneGeometry(rng.range(10, 20), rng.range(2, 4));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(rng.range(-500, 3800), 0.32, -150 + rng.range(-200, 200));
    quads.push({ geometry: g, matrix: m });
  }
  const glitter = new THREE.Mesh(mergeParts(quads), glitterMat);
  scene.add(glitter);

  // The sun path: one long soft streak of warm light on the water, brightest toward
  // the western horizon and fading as it runs east — it reads from any camera angle,
  // where a view-dependent specular highlight would not. Stage C stretches it east
  // past the volcano (its tail now crosses the cover frame's sea) with a longer fade.
  // Second pass: the tail was too faint to read — the mid gradient is brighter now.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(255, 220, 150, 0.9)');
  grad.addColorStop(0.45, 'rgba(255, 200, 120, 0.65)');
  grad.addColorStop(0.75, 'rgba(255, 200, 120, 0.3)');
  grad.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);
  const gradY = ctx.createLinearGradient(0, 0, 0, 128);
  gradY.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradY.addColorStop(0.25, 'rgba(0, 0, 0, 0)');
  gradY.addColorStop(0.75, 'rgba(0, 0, 0, 0)');
  gradY.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gradY;
  ctx.fillRect(0, 0, 512, 128);
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(9100, 1400),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  path.rotation.x = -Math.PI / 2;
  // The canvas gradient is bright at its left edge, which maps to the plane's -x end:
  // the bright end sits at the western horizon and fades east.
  path.position.set(-650, 0.35, -150);
  scene.add(path);
}

function riverRibbon(width, yLift, color, opacity) {
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
    const y = groundAt(x, z) + yLift;
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
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color, side: THREE.DoubleSide, transparent: true, opacity,
  }));
}

function buildRiver(scene) {
  // Stage C: 14 m wide, not 20 — the Stage B river read as a wide blue lake in the
  // landing frame. A thinner, lighter highlight ribbon rides on top so the water
  // reads as a winding river, not a pond; the spring pond shrinks with it.
  scene.add(riverRibbon(14, 0.5, 0x4aa8d8, 0.95));
  scene.add(riverRibbon(5, 0.65, 0x8fd0f0, 0.85));

  // The spring pond the river starts from.
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(14, 20),
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
  ctx.font = '900 96px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.9)';
  ctx.strokeText(text, 128, 68);
  ctx.fillStyle = '#f2f2e8';
  ctx.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function buildRunways(scene) {
  for (const r of RUNWAYS) {
    const group = new THREE.Group();
    // The whole strip sits 0.12 above the plateau: at a kilometre the depth buffer
    // cannot tell 0.06 m of separation apart, so Stage A markings z-fought with the
    // asphalt and vanished. Markings ride higher still, for the same reason.
    group.position.set(r.x, r.height + 0.12, r.z);
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
      dash.position.set(0, 0.15, d);
      group.add(dash);
    }
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.2, r.length - 10), markMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(side * (r.width / 2 - 1.5), 0.15, 0);
      group.add(edge);
      for (const end of [-1, 1]) {
        for (let b = -1; b <= 1; b += 1) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(3, 16), markMat);
          bar.rotation.x = -Math.PI / 2;
          bar.position.set(b * 6, 0.15, end * (r.length / 2 - 26));
          group.add(bar);
        }
      }
    }
    // numbers[0] is the heading the strip is named for: it belongs at the approach
    // end (local +z, the end a pilot on that heading sees first) and reads upright
    // from there; numbers[1] mirrors it at the far end. Stage A had them swapped,
    // so "36" sat at the far end, upside down from the approach.
    for (let i = 0; i < 2; i += 1) {
      const num = new THREE.Mesh(
        // Stage C: 34 x 17 m, not 26 x 13 — "36" read but small at thumbnail size.
        new THREE.PlaneGeometry(34, 17),
        new THREE.MeshBasicMaterial({ map: numberTexture(r.numbers[i]), transparent: true }),
      );
      num.rotation.x = -Math.PI / 2;
      num.rotation.z = i === 0 ? 0 : Math.PI;
      num.position.set(0, 0.18, (i === 0 ? 1 : -1) * (r.length / 2 - 52));
      group.add(num);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    const lightGeo = new THREE.SphereGeometry(1.3, 6, 5);
    for (let d = -r.length / 2 + 10; d <= r.length / 2 - 10; d += 45) {
      for (const side of [-1, 1]) {
        const light = new THREE.Mesh(lightGeo, lightMat);
        light.position.set(side * (r.width / 2 + 2), 0.9, d);
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

  // The lighthouse on the volcano's WEST shoulder, facing the cover camera and the
  // incoming plane: a 60 m tower, white with two red bands, a red roof and a big warm
  // lamp, on a white terrace with the keeper's cottage beside it. Stage B's 24 m tower
  // on the north shoulder read as a single pink glow dot from 3 km — this one is tall
  // enough, wide enough and bright enough to read as a tower, not a dot.
  const lx = v.x - 550;
  const lz = v.z - 100;
  const gy = groundAt(lx, lz);
  const house = new THREE.Group();
  house.position.set(lx, gy, lz);
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 19, 6, 10),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  skirt.position.y = 3;
  house.add(skirt);
  const tower = new THREE.Mesh(
    // Second pass: 24 m wide at the base, not 14 — the 60 m tower was tall enough
    // but only ~3 px wide from the cover camera, so it still read as a dot.
    new THREE.CylinderGeometry(9, 12, 60, 10),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  tower.position.y = 30;
  house.add(tower);
  for (const by of [18, 42]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(12.5, 12.5, 4, 10),
      new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
    );
    band.position.y = by;
    house.add(band);
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(5, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
  );
  lamp.position.y = 62;
  house.add(lamp);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(12, 6, 10),
    new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
  );
  roof.position.y = 68;
  house.add(roof);
  const cottage = new THREE.Mesh(
    new THREE.BoxGeometry(9, 5, 7),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  cottage.position.set(12, 2.5, 5);
  house.add(cottage);
  const cottageRoof = new THREE.Mesh(
    new THREE.ConeGeometry(6.5, 3.5, 4),
    new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
  );
  cottageRoof.position.set(12, 6.7, 5);
  cottageRoof.rotation.y = Math.PI / 4;
  house.add(cottageRoof);
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
  glow.position.y = 62;
  glow.scale.set(130, 130, 1);
  house.add(glow);
  scene.add(house);
}

function buildClouds(scene, rng) {
  // Cumulus, not flat discs: each cluster is a stack of near-spherical puffs with
  // taller tower puffs on top, and the puffs are shaded by height — pale grey at the
  // base, white at the crown — so a cloud reads as a volume from below and the side.
  // Stage C: more puffs per cluster, taller towers, and an emissive lift so a cloud
  // never goes black on its shadow side (Stage B's shot 4 showed clouds as dark
  // blobs). Five hero clouds sit at fixed spots — three in the north-east sky the
  // Island Hop frame looks at (it was empty), two over the western sea.
  const cBase = new THREE.Color(0xc9cedb);
  const cMid = new THREE.Color(0xe8ebf2);
  const cTop = new THREE.Color(0xffffff);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.92,
    emissive: 0x707684, emissiveIntensity: 0.45,
  });
  function cluster(cx, cy, cz, puffs) {
    const parts = [];
    const towers = rng.next() < 0.5 ? 2 : 1;
    for (let i = 0; i < puffs; i += 1) {
      const tower = i < towers;
      const g = new THREE.SphereGeometry(1, 10, 8);
      const m = new THREE.Matrix4();
      const sx = tower ? rng.range(40, 62) : rng.range(55, 115);
      const sy = tower ? rng.range(36, 55) : rng.range(22, 42);
      const sz = tower ? rng.range(35, 52) : rng.range(38, 68);
      m.makeScale(sx, sy, sz);
      const px = cx + rng.range(-80, 80);
      const py = cy + (tower ? rng.range(14, 30) : rng.range(-12, 12));
      const pz = cz + rng.range(-55, 55);
      m.setPosition(px, py, pz);
      const t = tower ? 1 : clamp((py - (cy - 14)) / 34, 0, 1);
      const col = new THREE.Color().copy(cBase).lerp(cMid, t);
      if (tower) col.copy(cTop);
      parts.push({ geometry: g, matrix: m, color: col });
    }
    return new THREE.Mesh(mergePartsColor(parts), mat);
  }
  const clusters = 16;
  for (let c = 0; c < clusters; c += 1) {
    const cx = rng.range(-3200, 5600);
    const cz = rng.range(-3200, 2600);
    const cy = c < 5 ? rng.range(140, 210) : rng.range(280, 540);
    const puffs = 6 + Math.floor(rng.next() * 4);
    scene.add(cluster(cx, cy, cz, puffs));
  }
  // Hero clouds at fixed spots, so the frames that need sky always have it.
  const heroes = [
    [2600, 320, -1200], [3400, 390, -800], [4200, 300, -1500],
    [-1800, 300, -600], [-2400, 390, 800],
  ];
  for (const [hx, hy, hz] of heroes) scene.add(cluster(hx, hy, hz, 7));
}

/** The storm front: a ragged wall of dark cloud closing in from the east. The loop
 *  slides it west as the Storm Courier clock runs down; it starts hidden and only
 *  the storm mission shows it. */
function buildStormWall(scene, rng) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a4152, transparent: true, opacity: 0.95 });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x272d3d, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 26; i += 1) {
    const g = new THREE.SphereGeometry(1, 10, 8);
    const m = new THREE.Matrix4();
    const s = rng.range(180, 420);
    m.makeScale(s, rng.range(120, 260), rng.range(120, 240));
    m.setPosition(
      rng.range(-120, 120),
      rng.range(60, 420),
      -2600 + i * 210 + rng.range(-80, 80),
    );
    const mesh = new THREE.Mesh(g, i % 3 === 0 ? matDark : mat);
    mesh.applyMatrix4(m);
    group.add(mesh);
  }
  group.position.set(4600, 0, 0);
  group.visible = false;
  scene.add(group);
  return group;
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
  const stormWall = buildStormWall(scene, rng);
  return { stormWall };
}
