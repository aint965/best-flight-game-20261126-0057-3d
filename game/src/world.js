// The geography of the archipelago: pure data, no Three.js, no browser. Every height the game
// needs comes from groundAt(x, z) — the terrain mesh, the plane's shadow, the physics and the
// landing checks all ask this one function, so the world can never disagree with itself.
//
// Layout (metres, x east, z south, y up, sea level 0):
//   home island    (0, 0), radius 950 — the 36/18 strip on a grass plateau
//   Pulau Karang    (1500, -900), radius 700 — the 03/21 strip
//   volcano        (3900, 0), radius 1100, peak 650 — the hero, lighthouse on its shoulder
//   far islands    three foggy silhouettes at the map's edges
import { fbm2 } from './random.js';
import { RING } from './config.js';

export const SEED = 20261126;

export const ISLANDS = [
  { name: 'home', x: 0, z: 0, radius: 950, peak: 48, basePeak: 12, hillX: 340, hillZ: -220 },
  { name: 'karang', x: 1500, z: -900, radius: 700, peak: 55, basePeak: 12, hillX: 1720, hillZ: -1020 },
  { name: 'volcano', x: 3900, z: 0, radius: 1100, peak: 650, basePeak: 650, hillX: 3900, hillZ: 0 },
  { name: 'far-north', x: -2600, z: 1800, radius: 800, peak: 120, basePeak: 120, hillX: -2600, hillZ: 1800 },
  { name: 'far-west', x: -2200, z: -2600, radius: 900, peak: 150, basePeak: 150, hillX: -2200, hillZ: -2600 },
  { name: 'far-east', x: 5200, z: -2200, radius: 1000, peak: 180, basePeak: 180, hillX: 5200, hillZ: -2200 },
];

/** The lighthouse on the volcano's west shoulder (terrain.js builds it here). */
export const LIGHTHOUSE = { x: 3200, z: -120 };

/** Runways: flat grass plateaus the strips sit on. heading is a compass heading in radians. */
export const RUNWAYS = [
  { name: 'home', x: 0, z: 0, heading: 0, length: 650, width: 30, height: 2.4, numbers: ['36', '18'] },
  { name: 'karang', x: 1500, z: -900, heading: 0.4363323129985824, length: 600, width: 30, height: 2.4, numbers: ['03', '21'] },
];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a, b, t) {
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** Height of one island's hill at (x, z): a low dome over the whole island plus a taller
 *  hill dome on the island's hill point. The strips sit on the low dome, never on a peak,
 *  so a leveled airfield plateau can be cut into it without trench walls beside the strip. */
function islandHeight(island, x, z) {
  const dx = x - island.x;
  const dz = z - island.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= island.radius) return -4;
  const fall = 0.5 + 0.5 * Math.cos((Math.PI * d) / island.radius);
  let h = island.basePeak * Math.pow(fall, 1.25);
  const hx = x - island.hillX;
  const hz = z - island.hillZ;
  const hd = Math.sqrt(hx * hx + hz * hz);
  if (hd < island.radius * 0.55) {
    const hf = 0.5 + 0.5 * Math.cos((Math.PI * hd) / (island.radius * 0.55));
    h = Math.max(h, island.peak * hf * hf);
  }
  h += fbm2(x, z, SEED) * 6 * (d / island.radius < 0.85 ? 1 : 0.4);
  return h;
}

/** The volcano is a steep cone with a shallow crater bowl, not a rolling dome. */
function volcanoHeight(x, z) {
  const v = ISLANDS[2];
  const dx = x - v.x;
  const dz = z - v.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= v.radius) return -4;
  let h = v.peak * Math.pow(Math.max(0, 1 - d / v.radius), 1.15);
  if (d < 130) h = Math.min(h, 550 + (d / 130) * 60); // crater bowl: floor 550, rim ~562
  h += fbm2(x, z, SEED + 11) * 9 * (1 - d / v.radius);
  return h;
}

/** Distance from (x, z) to a runway's centreline, in the strip's own frame. */
export function runwayFrame(runway, x, z) {
  const dx = x - runway.x;
  const dz = z - runway.z;
  const s = Math.sin(runway.heading);
  const c = Math.cos(runway.heading);
  // Forward along the strip is (sin h, -cos h); across it is (cos h, sin h).
  const along = dx * s - dz * c;
  const across = dx * c + dz * s;
  return { along, across };
}

/** How much of a runway's flat plateau applies at (x, z): 1 on the asphalt itself,
 *  fading to 0 across the apron around it (195 m past each threshold, 145 m to each side). */
export function plateauBlend(runway, x, z) {
  const f = runwayFrame(runway, x, z);
  const bAlong = 1 - smoothstep(runway.length / 2, runway.length / 2 + 195, Math.abs(f.along));
  const bAcross = 1 - smoothstep(runway.width / 2, runway.width / 2 + 145, Math.abs(f.across));
  return Math.min(bAlong, bAcross);
}

/** True when (x, z) is on the flat plateau of a runway (the strip plus its shoulders). */
export function onRunwayPlateau(x, z) {
  for (const r of RUNWAYS) {
    if (plateauBlend(r, x, z) > 0.02) return r;
  }
  return null;
}

/** The one height function. Below 0 is seabed; the strips flatten to their plateau height. */
export function groundAt(x, z) {
  let h = -4;
  for (const island of ISLANDS) {
    const ih = island.name === 'volcano' ? volcanoHeight(x, z) : islandHeight(island, x, z);
    if (ih > h) h = ih;
  }
  for (const r of RUNWAYS) {
    const blend = plateauBlend(r, x, z);
    if (blend > 0) h = h + (r.height - h) * blend;
  }
  return h;
}

/** True when (x, z) is inside a strip's asphalt (for landing detection). */
export function onStrip(x, z) {
  for (const r of RUNWAYS) {
    const f = runwayFrame(r, x, z);
    if (Math.abs(f.along) <= r.length / 2 && Math.abs(f.across) <= r.width / 2) return r;
  }
  return null;
}

/** The Ring Run course, as { x, y, z } points from config. */
export function ringCourse() {
  return RING.course.map(([x, y, z]) => ({ x, y, z }));
}

/** Where the plane starts a Ring Run: on the home strip, nose north. */
export function homeSpawn() {
  return { x: 0, y: RUNWAYS[0].height + 1.3, z: 260, heading: 0, speed: 0, throttle: 0 };
}
