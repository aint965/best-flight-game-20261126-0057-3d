// The static 3D world: sky, sea, terrain, river, runways, trees, volcano, clouds.
// Everything here is built once at boot and never recomputed per frame — the only things that
// move are the plane, the rings and the clouds' slow drift is baked into their placement.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { ISLANDS, RUNWAYS, LIGHTHOUSE, groundAt, onRunwayPlateau } from './world.js';
import { createRandom, fbm2, valueNoise } from './random.js';
import { SEED } from './world.js';

// The HIGH midday sun — nearly overhead, a touch west and south (late-November
// noon over Indonesia). Shadows are short and fall east-north; the cockpit glare
// fires when the pilot looks UP into it, not west into a sunset. It used to be
// low in the west (-0.9, 0.22, -0.28); the sunset version stays in git (eab0844).
// Exported for the cockpit glare: the glare quad's opacity follows how directly
// the pilot is looking into it.
export const SUN_DIR = new THREE.Vector3(-0.18, 0.90, 0.38).normalize();
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

  // The sun's glow: a soft radial sprite, high in the sky at midday — whiter
  // and smaller than the low sunset disc was.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 252, 240, 1)');
  grad.addColorStop(0.25, 'rgba(255, 244, 200, 0.5)');
  grad.addColorStop(1, 'rgba(255, 240, 190, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  glow.position.copy(SUN_DIR).multiplyScalar(8200);
  glow.scale.set(2400, 2400, 1);
  scene.add(glow);

  // Midday light: a strong near-white sun from high above, a blue sky bounce
  // from above and a warm ground bounce from below, pale-blue fog.
  // Stage G: the sun now casts REAL shadows (PCFSoftShadowMap in our vendored
  // three r160 — the gamedev skill threejs-materials-lighting says r160 gets
  // PCFSoft, since PCFShadowMap only turns soft in r182+; the sharpness comes
  // from the 2048 map on a tight frustum, not from the filter). Until now every
  // shadow in the game was a painted fake (blob under the plane, ellipse under
  // the clouds, a translucent plane over the panel). The shadow camera is a
  // 640 m orthographic box that RIDES the plane (updateSunShadow, called every
  // frame from main.js): a static camera over an 11 km world would smear one
  // texel over metres, but a camera that follows the plane keeps the texels
  // small where the camera looks — tree shadows on the grass, the plane's
  // shadow on the strip, the lighthouse tower on the shore. Bias -0.0005 +
  // normalBias 0.5 against acne (one assignment only — an earlier draft had a
  // second pair below that silently overwrote these).
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Stage G (skill threejs-materials-lighting): shadow acne is tuned out with a
  // small negative bias plus a normal bias — the terrain's 61 m vertex spacing
  // would otherwise shimmer with acne stripes in the noon sun. normalBias 0.5 m
  // is ~1.5 texels at this frustum, small enough that no shadow visibly floats.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  sun.shadow.camera.left = -320;
  sun.shadow.camera.right = 320;
  sun.shadow.camera.top = 320;
  sun.shadow.camera.bottom = -320;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 2200;
  scene.add(sun);
  scene.add(sun.target);
  // Stage G: the light/shadow contrast is stronger — the sun is brighter and
  // the ambient bounces are weaker, so the lit side reads bright and warm and
  // the shadow side reads deep and cool, instead of one flat grey. The camera
  // fill light in main.js drops with it (0.5 -> 0.35) for the same reason.
  scene.add(new THREE.HemisphereLight(0x9cc8f0, 0x7a8a58, 0.65));
  scene.fog = new THREE.Fog(PALETTE.fog, 1800, 9500);
  return sun;
}

/** Move the shadow camera with the plane: the light sits 900 m out along the
 *  sun direction, the target sits on the plane, so the 640 m shadow box always
 *  covers the ground the camera is looking at. Called every frame from main.js
 *  (and before every staged paint), or the shadows would lag a frame behind. */
export function updateSunShadow(sun, x, y, z) {
  sun.position.set(x + SUN_DIR.x * 900, y + SUN_DIR.y * 900, z + SUN_DIR.z * 900);
  sun.target.position.set(x, y, z);
}

/** A seeded speckle canvas, tiled over the terrain so close ground has grain: the
 *  terrain mesh is one vertex per ~61 m, so vertex colours alone interpolate into a
 *  flat olive field in the foreground. The texture is near-white (0.70–1.15) so it
 *  only adds grain, never a new hue. Stage E: stronger contrast and bigger dots
 *  (the Stage D grain was too fine to read in the landing foreground). */
function speckleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const rng = createRandom(SEED + 41);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  // Stage G: the grain was too polite to read in the landing foreground — a
  // wider brightness range (0.62–1.20, was 0.70–1.15) and more, bigger dots, so
  // close grass has visible grain instead of a smooth olive wash.
  for (let i = 0; i < 16000; i += 1) {
    const g = Math.floor(255 * rng.range(0.62, 1.2));
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    const s = rng.next() < 0.6 ? 1 : rng.next() < 0.8 ? 2 : 3;
    ctx.fillRect(Math.floor(rng.next() * 256), Math.floor(rng.next() * 256), s, s);
  }
  for (let i = 0; i < 90; i += 1) {
    const v = rng.range(0.85, 1.0);
    ctx.fillStyle = `rgba(${Math.floor(255 * v)},${Math.floor(255 * v)},${Math.floor(255 * v)},0.5)`;
    ctx.beginPath();
    ctx.arc(rng.next() * 256, rng.next() * 256, rng.range(4, 12), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(230, 167); // one tile ≈ 48 m
  return tex;
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
      // Stage G: the mottling is pushed a touch harder (fine 0.50, speckle
      // 0.18 — was 0.45/0.12) so the ground has visible variation even where
      // no bush or tree sits on it.
      const t = clamp(0.5 + 0.5 * n + fine * 0.5 + speckle * 0.18, 0, 1);
      if (t < 0.5) c.copy(cGrassA).lerp(cGrassDark, t * 1.1);
      else c.copy(cGrassA).lerp(cGrassB, (t - 0.5) * 2);
      // Stage F, second pass: the dark patches were multiplied by 0.58 — deep pits
      // that read darker than the trees standing on them, which broke the
      // tree/ground match. 0.72 keeps the mottling without dropping the ground out
      // of the trees' lightness band.
      if (fbm2(wx, wz, SEED + 17) > 0.22) c.multiplyScalar(0.72);
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
        // Stage G: the ash cap was a smooth pale dome — fine noise breaks it
        // into rock and ash, dark speckles read as boulders, and the rim ring
        // is irregular now (it used to be a perfect circle of bright pixels).
        c.offsetHSL(0, 0, (valueNoise(wx, wz, 9, SEED + 33) - 0.5) * 0.3);
        if (valueNoise(wx, wz, 25, SEED + 37) > 0.62) c.lerp(cRockDark, 0.55);
        if (h > 535 && h < 565) c.lerp(cRim, 0.45 * (0.6 + 0.4 * Math.sin(ang * 5 + n * 3)));
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: speckleTexture() }));
  mesh.position.set(TERRAIN_CENTER.x, 0, TERRAIN_CENTER.z);
  // Stage G: the terrain both casts and receives the real shadows — the volcano
  // throws shade on its own lower slopes, hills shade the ground behind them.
  // (It does NOT self-shadow the crater floor into black: the sun is nearly
  // overhead, and normalBias 2 m keeps the coarse mesh from acne-ing.)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildSea(scene, rng) {
  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(7500, 48),
    new THREE.MeshPhongMaterial({ color: PALETTE.sea, shininess: 180, specular: 0xffffff }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(TERRAIN_CENTER.x, 0.15, TERRAIN_CENTER.z);
  scene.add(sea);

  // Sun glitter: bright quads on the water, elongated ALONG the sun's line (east-
  // west) so they read as streaks, not planks — and dimmed per quad so the band
  // fades with distance from the path centreline and from the sun in the west.
  // Stage D: the scattered quads are much smaller and fewer (the Stage C ones read
  // as white confetti in the cover foreground), the band is a bright core line with
  // a softer halo, and the colour is per-quad (additive blending: dimmer colour =
  // dimmer glitter). Stage F, second pass: white at midday, not warm gold.
  const glitterMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const quads = [];
  const warm = new THREE.Color(0xffffff);
  for (let i = 0; i < 120; i += 1) {
    // Sparse sparkle away from the path: small, dim, never a plank.
    const g = new THREE.PlaneGeometry(rng.range(3, 6), rng.range(0.8, 1.5));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(rng.range(-5200, 2200), 0.3, rng.range(-2600, 2200));
    const col = warm.clone().multiplyScalar(rng.range(0.25, 0.5));
    quads.push({ geometry: g, matrix: m, color: col });
  }
  for (let i = 0; i < 220; i += 1) {
    // The band core: long thin streaks along the path, brightest toward the sun.
    // Stage E: shorter and hair-thin (was 14–30 m) — the Stage D streaks still read
    // as white scratches in the cover foreground at close range.
    const x = rng.range(-800, 4200);
    const z = -150 + rng.range(-110, 110);
    const g = new THREE.PlaneGeometry(rng.range(8, 18), rng.range(0.8, 1.5));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(x, 0.32, z);
    const fadeZ = 1 - Math.min(1, Math.abs(z + 150) / 110) * 0.7;
    const fadeX = 1 - Math.min(1, Math.max(0, x - 800) / 3400) * 0.75;
    const col = warm.clone().multiplyScalar(0.95 * fadeZ * fadeX);
    quads.push({ geometry: g, matrix: m, color: col });
  }
  for (let i = 0; i < 140; i += 1) {
    // The halo: shorter, dimmer streaks just off the core line.
    const x = rng.range(-800, 3600);
    const z = -150 + (rng.next() < 0.5 ? -1 : 1) * rng.range(110, 220);
    const g = new THREE.PlaneGeometry(rng.range(5, 12), rng.range(0.8, 1.5));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(x, 0.31, z);
    const col = warm.clone().multiplyScalar(rng.range(0.2, 0.45));
    quads.push({ geometry: g, matrix: m, color: col });
  }
  const glitter = new THREE.Mesh(mergePartsColor(quads), glitterMat);
  scene.add(glitter);

  // The sun path: one long soft streak of white midday light on the water,
  // brightest toward the western horizon and fading as it runs east — it reads
  // from any camera angle, where a view-dependent specular highlight would not.
  // Stage C stretches it east past the volcano (its tail now crosses the cover
  // frame's sea) with a longer fade. Second pass: the tail was too faint to read —
  // the mid gradient is brighter now. Stage F, second pass: white, not warm gold,
  // and dimmer (0.4) — a high sun makes a softer, whiter path than a low one.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(255, 252, 240, 0.9)');
  grad.addColorStop(0.45, 'rgba(255, 250, 225, 0.6)');
  grad.addColorStop(0.75, 'rgba(255, 250, 225, 0.28)');
  grad.addColorStop(1, 'rgba(255, 250, 225, 0)');
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
      map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.4,
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
    // Stage G: the strip receives the plane's real shadow on final — the
    // landing frame shows the aircraft's own shade on the asphalt.
    asphalt.receiveShadow = true;
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
  // Stage G: OLD GROWTH — ~50 big trees in tight clusters, the way a real forest
  // grows (a few elders towering over the rest, not 650 identical saplings).
  // They are extra entries in the same instanced meshes, flagged by scale > 1.8
  // and a darker colour; the clusters sit where the dossier frames look.
  const clusterCenters = [[-420, 480], [180, 700], [-650, -350], [1250, -500], [1750, -1150], [300, -650]];
  for (const [cx, cz] of clusterCenters) {
    for (let i = 0; i < 8; i += 1) {
      const x = cx + rng.range(-110, 110);
      const z = cz + rng.range(-110, 110);
      const h = groundAt(x, z);
      if (h < 3 || h > 42) continue;
      if (onRunwayPlateau(x, z)) continue;
      if (distToRiver(x, z) < 32) continue;
      spots.push([x, h, z, rng.range(1.9, 2.6)]);
    }
  }
  const trunkGeo = new THREE.CylinderGeometry(0.45, 0.75, 3, 5);
  const coneGeo = new THREE.ConeGeometry(3.4, 9, 6);
  const cone2Geo = new THREE.ConeGeometry(2.3, 6, 6);
  const cone3Geo = new THREE.ConeGeometry(1.5, 4, 6);
  // Stage H: a fourth, small top cone for the old-growth giants only — the
  // layered crown reads taller and less like a stacked Christmas tree.
  const cone4Geo = new THREE.ConeGeometry(1.0, 3.5, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const cones = new THREE.InstancedMesh(coneGeo, leafMat, spots.length);
  const cones2 = new THREE.InstancedMesh(cone2Geo, leafMat, spots.length);
  const cones3 = new THREE.InstancedMesh(cone3Geo, leafMat, spots.length);
  const cones4 = new THREE.InstancedMesh(cone4Geo, leafMat, spots.length);
  // Stage G: every tree casts a real shadow now (sun + shadow map), so a forest
  // reads as a forest from the air instead of a flat green carpet.
  trunks.castShadow = true;
  cones.castShadow = true;
  cones2.castShadow = true;
  cones3.castShadow = true;
  cones4.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach(([x, h, z, scale], i) => {
    // Stage G: no two trees share a silhouette any more — the width, height and
    // depth scales jitter independently (0.85–1.3), so the cones are squat, tall,
    // wide or narrow at random instead of 650 copies of one cone.
    const sx = scale * rng.range(0.85, 1.2);
    const sy = scale * rng.range(0.85, 1.3);
    const sz = scale * rng.range(0.85, 1.2);
    const giant = scale > 1.8;
    s.set(sx, sy, sz);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    p.set(x, h + 1.5 * sy, z);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    // Stage H: the crown LEANS — each tree's upper cones are offset sideways
    // in one fixed direction (golden-angle from the tree index, so no rng is
    // consumed and the Stage G forest keeps its exact spots), growing with
    // height: the stack stops being a perfectly vertical Christmas tree and
    // reads as a pine that grew against the wind. The base cone stays on the
    // trunk; the lean is only in the crown.
    const leanA = (i * 2.39996) % (Math.PI * 2);
    const leanX = Math.cos(leanA);
    const leanZ = Math.sin(leanA);
    p.set(x, h + (3 + 4.5) * sy, z);
    m.compose(p, q, s);
    cones.setMatrixAt(i, m);
    p.set(x + leanX * 0.4 * sx, h + (3 + 8) * sy, z + leanZ * 0.4 * sx);
    m.compose(p, q, s);
    cones2.setMatrixAt(i, m);
    // A third, smaller top cone on ~60% of trees: a layered crown, not a smooth
    // two-cone Christmas tree. Giants always get one — they are the layered ones.
    const hasTop = giant || rng.next() < 0.6;
    if (hasTop) {
      p.set(x + leanX * 0.8 * sx, h + (3 + 11) * sy, z + leanZ * 0.8 * sx);
      m.compose(p, q, s);
      cones3.setMatrixAt(i, m);
    } else {
      s.set(0, 0, 0);
      p.set(x, h, z);
      m.compose(p, q, s);
      cones3.setMatrixAt(i, m);
    }
    // Stage H: giants get a fourth, smallest top cone, leaning furthest — the
    // old-growth crowns are the layered ones. Other trees hide theirs at
    // zero scale, the same pattern as cones3.
    if (giant) {
      p.set(x + leanX * 1.1 * sx, h + (3 + 13.5) * sy, z + leanZ * 1.1 * sx);
      s.set(sx, sy, sz);
      m.compose(p, q, s);
      cones4.setMatrixAt(i, m);
    } else {
      s.set(0, 0, 0);
      p.set(x, h, z);
      m.compose(p, q, s);
      cones4.setMatrixAt(i, m);
    }
    // Stage F, second pass — the tree/ground mismatch: pines were HSL(0.33–0.37,
    // 0.55, 0.28–0.40), a saturated pure green, while the ground is a muted
    // yellow-olive (hue ~0.28, sat 0.30–0.38). Now hue 0.29–0.32, sat 0.42,
    // lightness 0.30–0.42 — the same yellow-green family as the grass, a touch
    // darker and richer, so the trees sit in the ground instead of floating on it.
    // Stage G KEEPS that palette exactly (the user only asked for shape, not
    // colour); giants are the same hue, just darker (lightness 0.24–0.30).
    if (giant) col.setHSL(0.29 + rng.next() * 0.02, 0.42, 0.24 + rng.next() * 0.06);
    else col.setHSL(0.29 + rng.next() * 0.03, 0.42, 0.30 + rng.next() * 0.12);
    cones.setColorAt(i, col);
    cones2.setColorAt(i, col);
    cones3.setColorAt(i, col);
    cones4.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate = true;
  cones2.instanceMatrix.needsUpdate = true;
  cones3.instanceMatrix.needsUpdate = true;
  cones4.instanceMatrix.needsUpdate = true;
  if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
  if (cones2.instanceColor) cones2.instanceColor.needsUpdate = true;
  if (cones3.instanceColor) cones3.instanceColor.needsUpdate = true;
  if (cones4.instanceColor) cones4.instanceColor.needsUpdate = true;
  scene.add(trunks);
  scene.add(cones);
  scene.add(cones2);
  scene.add(cones3);
  scene.add(cones4);
}

/** Near-camera ground detail: bushes, rocks and flower dots on the two low islands,
 *  denser where the dossier frames look (south of the home strip, south-west of
 *  Karang) — the vertex-coloured ground is one vertex per ~61 m, so close grass reads
 *  flat without something sitting on it. Visual only: the sim never sees this. */
function buildDetail(scene, rng) {
  const zones = [
    // [x0, x1, z0, z1, bushes, rocks, flowers]
    // Stage G: the two foreground zones are denser still (the landing and hop
    // frames look straight across them, and the lower half of shots 2 and 4 was
    // still reading as a smooth carpet) — and a new grass-tuft layer (below)
    // puts something ankle-high on the ground itself.
    [-500, 500, 150, 950, 200, 70, 230], // home south foreground (landing frame)
    [850, 1750, -650, -200, 160, 60, 180], // Karang south-west foreground (hop frame)
    [-900, 900, -900, 900, 60, 20, 60], // home island general
    [900, 2100, -1500, -300, 50, 15, 50], // Karang general
  ];
  const bushes = [];
  const rocks = [];
  const flowers = [];
  for (const [x0, x1, z0, z1, nb, nr, nf] of zones) {
    let guard = 0;
    let placed = 0;
    while (placed < nb + nr + nf && guard < 6000) {
      guard += 1;
      const x = rng.range(x0, x1);
      const z = rng.range(z0, z1);
      const h = groundAt(x, z);
      if (h < 3 || h > 42) continue;
      if (onRunwayPlateau(x, z)) continue;
      if (distToRiver(x, z) < 18) continue;
      if (placed < nb) bushes.push([x, h, z, rng.range(0.8, 1.6)]);
      else if (placed < nb + nr) rocks.push([x, h, z, rng.range(0.6, 1.4)]);
      else flowers.push([x, h, z, rng.range(0.7, 1.3)]);
      placed += 1;
    }
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const bushGeo = new THREE.IcosahedronGeometry(1.6, 0);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
  bushes.forEach(([x, h, z, scale], i) => {
    s.set(scale, scale * 0.7, scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    p.set(x, h + 0.8 * scale, z);
    m.compose(p, q, s);
    bushMesh.setMatrixAt(i, m);
    // Same family as the pines and the grass (hue ~0.28–0.32, sat 0.42) — the
    // bushes are the transition between tree and ground, so they must not be a
    // third green of their own.
    col.setHSL(0.28 + rng.next() * 0.04, 0.42, 0.28 + rng.next() * 0.1);
    bushMesh.setColorAt(i, col);
  });
  const rockGeo = new THREE.DodecahedronGeometry(1.1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
  rocks.forEach(([x, h, z, scale], i) => {
    s.set(scale, scale * 0.7, scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    p.set(x, h + 0.4 * scale, z);
    m.compose(p, q, s);
    rockMesh.setMatrixAt(i, m);
    col.setHSL(0.08, 0.08, 0.45 + rng.next() * 0.2);
    rockMesh.setColorAt(i, col);
  });
  const flowerGeo = new THREE.SphereGeometry(0.5, 6, 5);
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowers.length);
  const petal = [0xf2d13c, 0xf4ede0, 0xe87a9e, 0xff8c42];
  flowers.forEach(([x, h, z, scale], i) => {
    s.set(scale, scale, scale);
    q.identity();
    p.set(x, h + 0.45 * scale, z);
    m.compose(p, q, s);
    flowerMesh.setMatrixAt(i, m);
    col.setHex(petal[i % petal.length]);
    flowerMesh.setColorAt(i, col);
  });
  for (const mesh of [bushMesh, rockMesh, flowerMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
  // Stage G: GRASS TUFTS — ankle-high cones scattered thick in the two
  // foreground zones only, where the camera flies low. The terrain mesh is one
  // vertex per ~61 m, so without something standing on it the near ground is a
  // smooth wash no matter how strong the speckle is; 700 tufts give the lower
  // half of the landing and hop frames something to catch the light. Same
  // yellow-green family as the grass (hue 0.28–0.32, sat 0.42) — never a new
  // green of their own. They cast real shadows too, so the foreground has
  // texture from the light as well as from the geometry.
  const tufts = [];
  for (const [x0, x1, z0, z1, count] of [[-500, 500, 150, 950, 380], [850, 1750, -650, -200, 320]]) {
    let guard = 0;
    let placed = 0;
    while (placed < count && guard < 4000) {
      guard += 1;
      const x = rng.range(x0, x1);
      const z = rng.range(z0, z1);
      const h = groundAt(x, z);
      if (h < 3 || h > 42) continue;
      if (onRunwayPlateau(x, z)) continue;
      if (distToRiver(x, z) < 18) continue;
      tufts.push([x, h, z, rng.range(0.7, 1.5)]);
      placed += 1;
    }
  }
  const tuftGeo = new THREE.ConeGeometry(0.45, 0.9, 5);
  const tuftMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tufts.length);
  tuftMesh.castShadow = true;
  tufts.forEach(([x, h, z, scale], i) => {
    s.set(scale * rng.range(0.8, 1.3), scale, scale * rng.range(0.8, 1.3));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI * 2);
    p.set(x, h + 0.35 * scale, z);
    m.compose(p, q, s);
    tuftMesh.setMatrixAt(i, m);
    col.setHSL(0.28 + rng.next() * 0.04, 0.42, 0.30 + rng.next() * 0.15);
    tuftMesh.setColorAt(i, col);
  });
  tuftMesh.instanceMatrix.needsUpdate = true;
  if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true;
  scene.add(tuftMesh);
  // Bushes and rocks cast real shadows now as well.
  bushMesh.castShadow = true;
  rockMesh.castShadow = true;
}

function buildVolcanoDetails(scene) {
  const v = ISLANDS[2];
  // Stage G: the crater floor was one flat dark disc — now it is a canvas of
  // rocky speckle with a bright rim ring, so the summit reads as broken rock
  // from the cover frame instead of a painted circle.
  const craterCanvas = document.createElement('canvas');
  craterCanvas.width = 128;
  craterCanvas.height = 128;
  const cctx = craterCanvas.getContext('2d');
  cctx.fillStyle = '#3a3230';
  cctx.fillRect(0, 0, 128, 128);
  const craterRng = createRandom(SEED + 51);
  for (let i = 0; i < 500; i += 1) {
    const g = Math.floor(craterRng.range(40, 110));
    cctx.fillStyle = `rgb(${g},${Math.floor(g * 0.92)},${Math.floor(g * 0.85)})`;
    const r = craterRng.range(1, 4);
    cctx.beginPath();
    cctx.arc(craterRng.next() * 128, craterRng.next() * 128, r, 0, Math.PI * 2);
    cctx.fill();
  }
  cctx.strokeStyle = 'rgba(232, 226, 212, 0.85)';
  cctx.lineWidth = 5;
  cctx.beginPath();
  cctx.arc(64, 64, 60, 0, Math.PI * 2);
  cctx.stroke();
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(120, 24),
    new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(craterCanvas) }),
  );
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(v.x, 556, v.z); // the crater floor, not the rim
  scene.add(crater);
  // The volcano stands BARE now — crater, ash cap, strata, no tower. The
  // lighthouse used to stand on its west shoulder (a 120 m tower on a 650 m
  // mountain); it lives on the coast now, in buildLighthouse below.
}

/** The lighthouse — on the SOUTH TIP of Pulau Karang (LIGHTHOUSE, world.js),
 *  guarding the strait, not on the volcano. A real lighthouse stands on a rocky
 *  shore at sea level, and a 120 m tower on a 650 m volcano read as a monument
 *  on a mountain. This one is a 32 m coastal tower on a rock plinth at the
 *  water's edge: white with red bands, a cottage, a lamp and a beam that sweeps
 *  the sea surface west down the strait toward the home strip, where the planes
 *  fly. The minimap reads the same LIGHTHOUSE constant, so its marker can never
 *  drift from the tower.
 *  Stage I: the lamp is a LIGHT, not a fixture — it is OFF in daylight. A
 *  lighthouse lamp burning at noon is wrong (the user caught it in the Stage H
 *  cover shot: a beam sweeping the sea under a bright midday sun). The beam,
 *  the glow and the lit lamp core all switch together through setLight(), which
 *  buildWorld hands to main.js: on only for the Storm Courier (dark sky by the
 *  front), off for the two daylight missions. The tower, bands, cottage and
 *  plinth are the landmark and never change; the minimap marker is a map
 *  symbol, not a light, and is untouched. Default state is OFF. */
function buildLighthouse(scene) {
  const lx = LIGHTHOUSE.x;
  const lz = LIGHTHOUSE.z;
  const gy = groundAt(lx, lz);
  const house = new THREE.Group();
  // The shore here is beach-flat (groundAt ≈ 0 ± 2 m), so the tower stands on a
  // rock plinth that rises out of the water whatever the exact beach height is:
  // the plinth top is always ~6 m above sea level, the lamp ~41 m.
  const baseY = Math.max(gy, -1);
  house.position.set(lx, baseY, lz);
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 13, 8, 10),
    new THREE.MeshLambertMaterial({ color: 0x6a625a }),
  );
  plinth.position.y = 4;
  plinth.castShadow = true;
  house.add(plinth);
  // Shore rocks around the plinth, breaking the waterline.
  const rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x5e564e });
  for (const [rx, rz, s] of [[-11, 4, 1.4], [10, -6, 1.1], [6, 10, 0.9], [-7, -10, 1.2]]) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(rx, 0.5, rz);
    rock.scale.setScalar(s);
    rock.rotation.y = rx * 0.7;
    house.add(rock);
  }
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.6, 32, 10),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  tower.position.y = 8 + 16;
  // Stage G: the tower throws a real shadow on the shore now — a white tower
  // with a sharp dark twin on the sand is what makes it read as solid at noon.
  tower.castShadow = true;
  tower.receiveShadow = true;
  house.add(tower);
  for (const [by, br] of [[8 + 11, 3.4], [8 + 23, 3.0]]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(br, br, 2.5, 10),
      new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
    );
    band.position.y = by;
    house.add(band);
  }
  // Stage I: the lamp room glass is DARK by day (an unlit lamp), bright only
  // when the light is on — a MeshBasic sphere is lit by definition, so it can
  // never be the daylight state. setLight() below swaps the material.
  const lampGlassMat = new THREE.MeshLambertMaterial({ color: 0x2f3e46 });
  const lampLitMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 10, 8),
    lampGlassMat,
  );
  lamp.position.y = 8 + 33;
  house.add(lamp);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 2.6, 10),
    new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
  );
  roof.position.y = 8 + 35.2;
  house.add(roof);
  const cottage = new THREE.Mesh(
    new THREE.BoxGeometry(8, 4.5, 6),
    new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
  );
  cottage.position.set(11, 8 + 2.25, 5);
  cottage.castShadow = true;
  house.add(cottage);
  const cottageRoof = new THREE.Mesh(
    new THREE.ConeGeometry(6, 3.4, 4),
    new THREE.MeshLambertMaterial({ color: 0xc23b2a }),
  );
  cottageRoof.position.set(11, 8 + 6.2, 5);
  cottageRoof.rotation.y = Math.PI / 4;
  house.add(cottageRoof);
  // The beam sweeps the SEA, not the sky: it points west-south-west down the
  // strait toward the home strip — the group is yawed ~9.5° south of west, the
  // direction from the lighthouse to the home strip — and tilts ~5° down so its
  // far end kisses the water 400 m out. Stage I: it starts OFF (visible =
  // false) and only setLight(true) shows it — at midday it used to sit there
  // as a faint haze (opacity 0.18), which is exactly the wrong look the user
  // caught: a beam has no business burning under a bright sun.
  const beamGroup = new THREE.Group();
  beamGroup.rotation.y = 0.165;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(26, 400, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  // ConeGeometry's apex is at +Y/2: rotate -90° about Z to lay the axis along X
  // with the apex east, tilt 5° so the far (west) end drops, then centre the cone
  // half its length out from the lamp.
  beam.rotation.z = -Math.PI / 2 + 0.09;
  beam.position.set(-199, 8 + 33 - 17, 0);
  beamGroup.add(beam);
  beamGroup.visible = false;
  house.add(beamGroup);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 246, 216, 0.9)');
  grad.addColorStop(1, 'rgba(255, 246, 216, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 8 + 33;
  glow.scale.set(50, 50, 1);
  // Stage I: the halo starts OFF with the beam — a glowing lamp room at noon
  // is the same mistake as the beam.
  glow.visible = false;
  house.add(glow);
  scene.add(house);
  // Stage I: one switch for the whole lamp — beam, halo and lit core together,
  // so the three can never disagree about whether the light is on. main.js
  // calls this from reset() with (missionId === 'storm').
  let lightOn = false;
  return {
    get isOn() { return lightOn; },
    setLight(on) {
      lightOn = !!on;
      beamGroup.visible = lightOn;
      glow.visible = lightOn;
      lamp.material = lightOn ? lampLitMat : lampGlassMat;
    },
  };
}

/** True when a cloud centre would sit in front of the volcano hero or the
 *  lighthouse in one of the two frames that show them — the cover (camera ~790 m
 *  east of home, looking east at the volcano, with the lighthouse on Karang's
 *  south tip low mid-frame) or the rings shot (camera looking east-south-east at
 *  the lighthouse on the coast). Stage D added bigger clouds and one landed right
 *  over the mountain in both frames, hiding the hero and the lighthouse it was
 *  meant to show. */
function blocksHero(cx, cy, cz) {
  // Cover cone: from the far camera behind the staged cover plane — the plane
  // starts at (1000, 145, -180) heading east, the far camera sits 36 m behind
  // it at ~(964, 152, -180) — axis east. The volcano's angular box from
  // there is roughly ha -15°..+22°, va -3°..+9°; the margins allow for cloud size.
  // (Stage G moved the cover staging 400 m east so the coastal lighthouse reads
  // bigger; the cone origin moved with it. Stage H moves the staging 80 m
  // north so the third ring is whole in frame; the cone origin moves again.)
  const dx = cx - 964;
  const dy = cy - 152;
  const dz = cz + 180;
  if (dx > 300 && dx < 3600) {
    const ha = Math.atan2(dz, dx);
    const va = Math.atan2(dy, dx);
    if (ha > -0.38 && ha < 0.45 && va > -0.10 && va < 0.28) return true;
  }
  // Cover lighthouse cone: from the same camera toward the lighthouse lamp
  // (1500, 41, -250) — a cloud within ~4.4° of that sightline, 300–1500 m out,
  // would sit on the tower in the frame.
  const ldx = cx - 964;
  const ldy = cy - 152;
  const ldz = cz + 180;
  const lvLen = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
  const laLen = Math.sqrt(536 * 536 + 111 * 111 + 70 * 70);
  if (lvLen > 300 && lvLen < 1500) {
    const cos = (ldx * 536 + ldy * -111 + ldz * -70) / (lvLen * laLen);
    if (cos > 0.997) return true;
  }
  // Rings-shot cone: from (428, 118, -343) toward the lighthouse lamp (1500, 41, -250).
  const vx = cx - 428;
  const vy = cy - 118;
  const vz = cz + 343;
  const ax = 1072;
  const ay = -77;
  const az = 93;
  const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const aLen = Math.sqrt(ax * ax + ay * ay + az * az);
  if (vLen > 100 && vLen < 2850) {
    const cos = (vx * ax + vy * ay + vz * az) / (vLen * aLen);
    if (cos > 0.9945) return true; // within ~6° of the lighthouse sightline
  }
  return false;
}

/** True when a cloud centre would be clipped by the TOP edge of the hop frame:
 *  the Island Hop shot looks north-east from ~(1300, 88, -470) along heading 0.436,
 *  level, with a 62° vertical field of view — so a cloud high above the sightline
 *  and close enough reads as a big shape cut off at the top of the frame (Stage D's
 *  shot 2 had exactly that). Anything more than ~18° above the sightline, within
 *  ~40° of it horizontally and 150–3000 m out, is re-rolled. */
function blocksHop(cx, cy, cz) {
  const dx = cx - 1300;
  const dy = cy - 88;
  const dz = cz + 470;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 150 || dist > 3000) return false;
  const hd = Math.sqrt(dx * dx + dz * dz);
  if (hd < 50) return dy > 0;
  const cosH = (dx * 0.422 + dz * -0.906) / hd;
  if (cosH < 0.766) return false; // more than ~40° off the sightline
  const elev = Math.atan2(dy, hd);
  return elev > 0.314; // more than ~18° above the sightline: top-edge territory
}

function buildClouds(scene, rng) {
  // Cumulus, not flat discs: each cluster is a stack of near-spherical puffs with
  // taller tower puffs on top, and the puffs are shaded by height — soft pale grey
  // at the base, white at the crown — so a cloud reads as a volume from below and
  // the side. Stage E: 12–18 puffs per cluster (was 9–13) with wider size variety,
  // including wide flat "anvil" puffs so a cluster is not one repeated ellipsoid,
  // and a lighter base colour so the underside reads soft grey, never dark slate.
  // Five hero clouds sit at fixed spots — three in the north-east sky the Island
  // Hop frame looks at (it was empty), two over the western sea.
  // Stage D: 9–13 puffs per cluster (was 6–9), 1–3 towers, a per-cluster size scale
  // for shape variety, 10-puff heroes — plus soft cloud shadows on the sea and the
  // flat home plateau. Stage F, second pass: a high midday sun throws SHORT
  // shadows, just east and a touch north of the cloud — the old offset (1.5× the
  // cloud's height east) was a long sunset shadow and would read as a smear
  // nowhere near its cloud at noon.
  const cBase = new THREE.Color(0xdfe3ec);
  const cMid = new THREE.Color(0xeef0f5);
  const cTop = new THREE.Color(0xffffff);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.92,
    emissive: 0x8a94a8, emissiveIntensity: 0.35,
  });
  function cluster(cx, cy, cz, puffs) {
    const parts = [];
    const scale = rng.range(0.7, 1.4);
    const towers = 1 + Math.floor(rng.next() * 3);
    for (let i = 0; i < puffs; i += 1) {
      const tower = i < towers;
      const anvil = !tower && rng.next() < 0.25;
      const g = new THREE.SphereGeometry(1, 10, 8);
      const m = new THREE.Matrix4();
      const sx = (tower ? rng.range(40, 62) : anvil ? rng.range(110, 170) : rng.range(55, 115)) * scale;
      const sy = (tower ? rng.range(36, 55) : anvil ? rng.range(13, 22) : rng.range(22, 42)) * scale;
      const sz = (tower ? rng.range(35, 52) : anvil ? rng.range(45, 80) : rng.range(38, 68)) * scale;
      m.makeScale(sx, sy, sz);
      const px = cx + rng.range(-80, 80) * scale;
      const py = cy + (tower ? rng.range(14, 30) : rng.range(-12, 12));
      const pz = cz + rng.range(-55, 55) * scale;
      m.setPosition(px, py, pz);
      const t = tower ? 1 : clamp((py - (cy - 14)) / 34, 0, 1);
      const col = new THREE.Color().copy(cBase).lerp(cMid, t);
      if (tower) col.copy(cTop);
      parts.push({ geometry: g, matrix: m, color: col });
    }
    return new THREE.Mesh(mergePartsColor(parts), mat);
  }
  const clusters = 18;
  const shadowSpots = [];
  for (let c = 0; c < clusters; c += 1) {
    // Re-roll a centre that would hide the volcano hero or the lighthouse (see
    // blocksHero), or be clipped by the top edge of the hop frame (blocksHop);
    // at most 8 tries, then accept it — a cloud is better than a hang.
    let cx;
    let cy;
    let cz;
    let guard = 0;
    do {
      cx = rng.range(-3200, 5600);
      cz = rng.range(-3200, 2600);
      cy = c < 5 ? rng.range(140, 210) : rng.range(280, 540);
      guard += 1;
    } while (guard < 8 && (blocksHero(cx, cy, cz) || blocksHop(cx, cy, cz)));
    const puffs = 12 + Math.floor(rng.next() * 7);
    scene.add(cluster(cx, cy, cz, puffs));
    if (shadowSpots.length < 9 && groundAt(cx, cz) < 0.5) shadowSpots.push([cx, cy, cz]);
  }
  // Hero clouds at fixed spots, so the frames that need sky always have it.
  // Stage E: a hero that would be clipped by the hop frame's top edge is pushed
  // east and down until it clears the sightline — a fixed cloud must never be the
  // one cut off at the top of shot 2.
  const heroes = [
    [2600, 320, -1200], [3400, 390, -800], [4200, 300, -1500],
    [-1800, 300, -600], [-2400, 390, 800],
  ];
  for (let [hx, hy, hz] of heroes) {
    let guard = 0;
    while (guard < 4 && (blocksHero(hx, hy, hz) || blocksHop(hx, hy, hz))) {
      hx += 500;
      hy -= 60;
      guard += 1;
    }
    scene.add(cluster(hx, hy, hz, 12));
  }

  // Cloud shadows: soft dark ellipses on the flat sea (and, where the ground is a
  // flat plateau, on land) — a radial-gradient texture, so the edge fades instead of
  // cutting a hard disc. Static, like the clouds themselves.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const sgrad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  sgrad.addColorStop(0, 'rgba(10, 20, 30, 0.55)');
  sgrad.addColorStop(0.6, 'rgba(10, 20, 30, 0.25)');
  sgrad.addColorStop(1, 'rgba(10, 20, 30, 0)');
  sctx.fillStyle = sgrad;
  sctx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, opacity: 0.3, depthWrite: false,
  });
  for (const [sx, sy, sz] of shadowSpots) {
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), shadowMat);
    sh.rotation.x = -Math.PI / 2;
    const w = rng.range(180, 320);
    sh.scale.set(w, w * rng.range(0.55, 0.75), 1);
    // Just east and a touch north of the cloud, as a high midday sun throws it.
    sh.position.set(sx + sy * 0.35, 0.6, sz - sy * 0.25);
    scene.add(sh);
  }
  // Two shadows on the flat home plateau, where the ground is level enough that a
  // flat ellipse cannot clip into a slope.
  for (const [px, pz] of [[-350, 550], [420, 650]]) {
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.scale.set(240, 150, 1);
    sh.position.set(px, groundAt(px, pz) + 1.5, pz);
    scene.add(sh);
  }
}

/** The storm front: a ragged wall of dark cloud closing in from the east. The loop
 *  slides it west as the Storm Courier clock runs down; it starts hidden and only
 *  the storm mission shows it. Stage E: darker, denser and taller than fair-weather
 *  cloud — near-black slate with a bruised underbelly, 34 puffs — so the front
 *  reads as a threat at a glance, not as ordinary cumulus. */
function buildStormWall(scene, rng) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x232a3a, transparent: true, opacity: 0.95 });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x161c26, transparent: true, opacity: 0.97 });
  for (let i = 0; i < 34; i += 1) {
    const g = new THREE.SphereGeometry(1, 10, 8);
    const m = new THREE.Matrix4();
    const s = rng.range(180, 420);
    m.makeScale(s, rng.range(150, 320), rng.range(120, 240));
    m.setPosition(
      rng.range(-120, 120),
      rng.range(60, 460),
      -3400 + i * 210 + rng.range(-80, 80),
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
  const sun = buildSky(scene);
  buildTerrainMesh(scene);
  buildSea(scene, rng);
  buildRiver(scene);
  buildRunways(scene);
  buildTrees(scene, rng);
  buildDetail(scene, rng);
  buildVolcanoDetails(scene);
  const lighthouseLight = buildLighthouse(scene);
  buildClouds(scene, rng);
  const stormWall = buildStormWall(scene, rng);
  return { stormWall, sun, lighthouseLight };
}
