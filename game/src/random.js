// A tiny seeded random generator (mulberry32) plus the helpers the world builder uses.
// Same seed, same islands, same trees, same rings — every run, every screenshot.

export function createRandom(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + this.next() * (max - min);
    },
    pick(list) {
      return list[Math.floor(this.next() * list.length)];
    },
  };
}

/** Deterministic 2D value noise in [-1, 1], from integer lattice hashing. */
export function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2147483648 - 1;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Smooth interpolated value noise; `cell` is the feature size in metres. */
export function valueNoise(x, z, cell, seed) {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = x / cell - gx;
  const fz = z / cell - gz;
  const a = hash2(gx, gz, seed);
  const b = hash2(gx + 1, gz, seed);
  const c = hash2(gx, gz + 1, seed);
  const d = hash2(gx + 1, gz + 1, seed);
  const u = smooth(fx);
  const v = smooth(fz);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}

/** Two-octave noise: rolling hills plus fine grain, still in roughly [-1, 1]. */
export function fbm2(x, z, seed) {
  return valueNoise(x, z, 420, seed) * 0.7 + valueNoise(x, z, 130, seed + 7) * 0.3;
}
