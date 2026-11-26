// The HUD: DOM panels plus two small canvases (attitude indicator and archipelago map).
// update() is called every frame; text is only rewritten when it changes, so the DOM stays calm.
import { headingDegrees } from './physics.js';
import { groundAt, RUNWAYS, LIGHTHOUSE } from './world.js';

function el(id) {
  return document.getElementById(id);
}

function drawAttitude(canvas, flight) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(flight.bank);
  const pitchPx = Math.max(-30, Math.min(30, flight.pitch * 90));
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(-w, -h + pitchPx, w * 2, h);
  ctx.fillStyle = '#8a6f4d';
  ctx.fillRect(-w, pitchPx, w * 2, h);
  ctx.strokeStyle = '#f2f2e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w, pitchPx);
  ctx.lineTo(w, pitchPx);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 18, h / 2);
  ctx.lineTo(w / 2 + 18, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#eef1f5';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** The archipelago map, drawn from the real terrain (groundAt), not from circles:
 *  the static layer is rasterised ONCE at boot — one groundAt sample per map pixel —
 *  so the islands have their true shapes, and every frame only repaints the moving
 *  parts (plane, rings, storm front). World bounds cover every island, far ones
 *  included; the map is north-up (canvas +y is south, like the world +z). */
const MAP_BOUNDS = { x0: -3200, x1: 6300, z0: -3600, z1: 2700 };
const MAP_SEA = '#1d5a78';
const MAP_SAND = '#e8d29a';
const MAP_GRASS = '#5d8a4a';
const MAP_GRASS_DARK = '#42682f';
const MAP_ROCK = '#8a6f5c';
const MAP_ASH = '#b9b3a8';

function mapTransform(w, h) {
  const s = Math.min(w / (MAP_BOUNDS.x1 - MAP_BOUNDS.x0), h / (MAP_BOUNDS.z1 - MAP_BOUNDS.z0));
  const ox = (w - (MAP_BOUNDS.x1 - MAP_BOUNDS.x0) * s) / 2;
  const oy = (h - (MAP_BOUNDS.z1 - MAP_BOUNDS.z0) * s) / 2;
  return { s, ox, oy, toMap: (x, z) => [(x - MAP_BOUNDS.x0) * s + ox, (z - MAP_BOUNDS.z0) * s + oy] };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildMapBase(w, h, islands) {
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const ctx = base.getContext('2d');
  const { s, ox, oy } = mapTransform(w, h);
  const img = ctx.createImageData(w, h);
  const sea = hexRgb(MAP_SEA);
  const sand = hexRgb(MAP_SAND);
  const grass = hexRgb(MAP_GRASS);
  const grassDark = hexRgb(MAP_GRASS_DARK);
  const rock = hexRgb(MAP_ROCK);
  const ash = hexRgb(MAP_ASH);
  const volcano = islands[2];
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const wx = (px - ox) / s + MAP_BOUNDS.x0;
      const wz = (py - oy) / s + MAP_BOUNDS.z0;
      const ground = groundAt(wx, wz);
      let r = sea[0];
      let g = sea[1];
      let b = sea[2];
      if (ground >= 0.3) {
        if (ground < 3.2) {
          [r, g, b] = sand;
        } else {
          const t = Math.min(1, ground / 60);
          r = grass[0] + (grassDark[0] - grass[0]) * t;
          g = grass[1] + (grassDark[1] - grass[1]) * t;
          b = grass[2] + (grassDark[2] - grass[2]) * t;
          const dvx = wx - volcano.x;
          const dvz = wz - volcano.z;
          if (dvx * dvx + dvz * dvz < volcano.radius * volcano.radius) {
            const rc = ground > 420 ? ash : rock;
            r = rc[0];
            g = rc[1];
            b = rc[2];
          }
        }
      }
      const i = (py * w + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Runways: dark strips with white dashes and their numbers at the approach end,
  // exactly where the 3D strips sit — a pilot can read the map against the world.
  const { toMap } = mapTransform(w, h);
  for (const runway of RUNWAYS) {
    const fx = Math.sin(runway.heading);
    const fz = -Math.cos(runway.heading);
    const ax = Math.cos(runway.heading);
    const az = Math.sin(runway.heading);
    const [x1, y1] = toMap(runway.x - fx * runway.length / 2, runway.z - fz * runway.length / 2);
    const [x2, y2] = toMap(runway.x + fx * runway.length / 2, runway.z + fz * runway.length / 2);
    ctx.strokeStyle = '#2a2d33';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#f2f2e8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    // numbers[0] is the approach-end number (the end a pilot on that heading sees
    // first): it sits just past the approach threshold, offset to the side.
    const [nx, ny] = toMap(
      runway.x - fx * (runway.length / 2 - 70) + ax * 16,
      runway.z - fz * (runway.length / 2 - 70) + az * 16,
    );
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.85)';
    ctx.strokeText(runway.numbers[0], nx, ny);
    ctx.fillStyle = '#f2f2e8';
    ctx.fillText(runway.numbers[0], nx, ny);
  }
  // The volcano: a red peak marker; the lighthouse: a white dot on its west shoulder.
  const [vx, vy] = toMap(volcano.x, volcano.z);
  ctx.fillStyle = '#c23b2a';
  ctx.beginPath();
  ctx.moveTo(vx, vy - 6);
  ctx.lineTo(vx + 5, vy + 4);
  ctx.lineTo(vx - 5, vy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 14, 24, 0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const [lx, ly] = toMap(LIGHTHOUSE.x, LIGHTHOUSE.z);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 14, 24, 0.7)';
  ctx.stroke();
  // North arrow, top-left, so the heading triangle can be read against it.
  ctx.fillStyle = '#eef1f5';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('N ↑', 6, 5);
  return base;
}

function drawMap(canvas, flight, islands, world, mapBase) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(mapBase, 0, 0);
  const { toMap } = mapTransform(w, h);
  if (world) {
    // The storm front: a dark red band at the wall's current x, spanning the strait.
    if (world.storm && typeof world.frontX === 'number') {
      const [fx1, fy1] = toMap(world.frontX - 160, -2600);
      const [fx2, fy2] = toMap(world.frontX + 160, 2600);
      ctx.fillStyle = 'rgba(140, 40, 50, 0.35)';
      ctx.fillRect(fx1, fy1, fx2 - fx1, fy2 - fy1);
      ctx.fillStyle = 'rgba(120, 30, 40, 0.9)';
      const [ex] = toMap(world.frontX, 0);
      ctx.fillRect(ex - 1, fy1, 2, fy2 - fy1);
    }
    // Rings: gold dots, passed ones green; the next ring pulses and gets a dashed
    // bearing line from the plane, so the pilot always knows where to look next.
    if (world.rings) {
      const now = performance.now() / 1000;
      const pulse = 1 + 0.25 * Math.sin(now * 4);
      world.rings.forEach((ring, i) => {
        const [rx, ry] = toMap(ring.x, ring.z);
        ctx.fillStyle = ring.passed ? '#3fae5a' : '#f2b705';
        ctx.beginPath();
        ctx.arc(rx, ry, ring.passed ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fill();
        if (i === world.nextRing) {
          ctx.strokeStyle = '#f2b705';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(rx, ry, 3 + 3 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      if (world.nextRing >= 0 && world.rings[world.nextRing]) {
        const [px, py] = toMap(flight.x, flight.z);
        const [rx, ry] = toMap(world.rings[world.nextRing].x, world.rings[world.nextRing].z);
        ctx.strokeStyle = 'rgba(242, 183, 5, 0.75)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  // The plane: a gold triangle rotated by its heading (north-up map, so heading 0
  // points up), with a white outline so it reads over land and sea alike.
  const [px, py] = toMap(flight.x, flight.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#f2c94c';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function createHud(islands) {
  const refs = {
    alt: el('hud-alt'),
    speed: el('hud-speed'),
    vs: el('hud-vs'),
    thr: el('hud-thr'),
    hdg: el('hud-hdg'),
    score: el('hud-score'),
    best: el('hud-best'),
    time: el('hud-time'),
    mission: el('hud-mission'),
    objective: el('hud-objective'),
    fuel: el('hud-fuel'),
    damage: el('hud-damage'),
    fuelBar: el('hud-fuel-bar'),
    damageBar: el('hud-damage-bar'),
    thrBar: el('hud-thr-bar'),
    compass: el('hud-compass'),
    toast: el('hud-toast'),
    banner: el('hud-banner'),
    attitude: el('hud-attitude'),
    map: el('hud-map'),
    storm: el('hud-storm'),
    stormDist: el('hud-storm-dist'),
    stormEta: el('hud-storm-eta'),
    stormBar: el('hud-storm-bar'),
  };
  const compassCtx = refs.compass.getContext('2d');
  const last = {};
  // The map's static layer (true island shapes, runways, volcano, lighthouse) is
  // rasterised once here — one groundAt sample per map pixel — and repainted from
  // that cache every frame; only the plane, rings and storm front move.
  const mapBase = buildMapBase(refs.map.width, refs.map.height, islands);

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function drawCompass(headingDeg) {
    const c = refs.compass;
    const ctx = compassCtx;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eef1f5';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) {
      let rel = ((d - headingDeg + 540) % 360) - 180;
      if (Math.abs(rel) > 90) continue;
      const x = w / 2 + (rel / 90) * (w / 2 - 8);
      if (labels[d]) ctx.fillText(labels[d], x, h / 2);
      else {
        ctx.fillRect(x - 1, h / 2 - 6, 2, 12);
        ctx.fillStyle = '#9aa3b2';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(String(d), x, h / 2 + 12);
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#eef1f5';
      }
    }
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, 2);
    ctx.lineTo(w / 2 + 6, 2);
    ctx.lineTo(w / 2, 10);
    ctx.closePath();
    ctx.fill();
  }

  let toastTimer = null;
  function toast(message, ms = 2600) {
    refs.toast.textContent = message;
    refs.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.remove('show'), ms);
  }

  function banner(message) {
    refs.banner.textContent = message;
    refs.banner.classList.add('show');
  }

  function hideToast() {
    refs.toast.classList.remove('show');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    toast,
    hideToast,
    banner,
    hideBanner() {
      refs.banner.classList.remove('show');
    },
    update(flight, mission, timeLeft, world) {
      const kt = Math.round(flight.speed * 1.944);
      const altFt = Math.round(flight.y * 3.281);
      const vsFpm = Math.round(flight.vspeed * 196.85);
      const hdg = Math.round(headingDegrees(flight));
      setText(refs.alt, 'alt', String(altFt));
      setText(refs.speed, 'speed', String(kt));
      setText(refs.vs, 'vs', (vsFpm >= 0 ? '+' : '') + vsFpm.toLocaleString('en-US'));
      setText(refs.thr, 'thr', `${Math.round(flight.throttle)}%`);
      setText(refs.hdg, 'hdg', String(hdg).padStart(3, '0'));
      setText(refs.score, 'score', String(flight.score));
      setText(refs.time, 'time', fmtTime(timeLeft));
      setText(refs.fuel, 'fuel', `${Math.round(flight.fuel)}%`);
      setText(refs.damage, 'damage', `${Math.round(flight.damage)}%`);
      refs.fuelBar.style.width = `${flight.fuel}%`;
      refs.damageBar.style.width = `${flight.damage}%`;
      refs.thrBar.style.width = `${flight.throttle}%`;
      setText(refs.mission, 'mission', mission.name.toUpperCase());
      setText(refs.objective, 'objective', mission.objective);
      // The storm front panel only exists in the Storm Courier: distance, ETA and
      // the closing bar, all from the mission state machine.
      if (mission.id === 'storm') {
        if (last.stormShown !== true) {
          last.stormShown = true;
          refs.storm.style.display = '';
        }
        setText(refs.stormDist, 'stormDist', `${mission.frontKm.toFixed(1)} km`);
        setText(refs.stormEta, 'stormEta', `ETA ${fmtTime(timeLeft)}`);
        refs.stormBar.style.width = `${Math.max(0, Math.min(100, (timeLeft / mission.timeLimit) * 100))}%`;
      } else if (last.stormShown !== false) {
        last.stormShown = false;
        refs.storm.style.display = 'none';
      }
      drawCompass(hdg);
      drawAttitude(refs.attitude, flight);
      drawMap(refs.map, flight, islands, world, mapBase);
    },
  };
}
