// The HUD: DOM panels plus two small canvases (attitude indicator and archipelago map).
// update() is called every frame; text is only rewritten when it changes, so the DOM stays calm.
import { headingDegrees } from './physics.js';

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

function drawMap(canvas, flight, islands) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1d5a78';
  ctx.fillRect(0, 0, w, h);
  const toMap = (x, z) => [((x + 4000) / 11000) * w, ((z + 4000) / 8000) * h];
  for (const isl of islands) {
    const [mx, my] = toMap(isl.x, isl.z);
    const r = Math.max(2, (isl.radius / 11000) * w);
    ctx.fillStyle = '#5d8a4a';
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const [px, py] = toMap(flight.x, flight.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#f2c94c';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
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
  };
  const compassCtx = refs.compass.getContext('2d');
  const last = {};

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

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    toast,
    banner,
    hideBanner() {
      refs.banner.classList.remove('show');
    },
    update(flight, mission, timeLeft) {
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
      drawCompass(hdg);
      drawAttitude(refs.attitude, flight);
      drawMap(refs.map, flight, islands);
    },
  };
}
