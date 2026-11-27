// The cockpit, built from primitives — no photo assets, no downloads.
// A real bush-plane cockpit, as the pilot sees it: a six-pack that moves with
// the flight (airspeed, attitude, altimeter, turn coordinator, heading, VSI),
// engine gauges (RPM, manifold pressure, fuel, oil pressure, oil temperature),
// a magnetic compass on the glareshield, a moving yoke, a three-lever throttle
// quadrant, rudder pedals, switches, and a sun-glare quad that flares when the
// pilot looks west into the low sunset. The whole panel is one live canvas
// texture, redrawn ~12 times a second, so every needle is the sim's own number.
//
// Plane-local coordinates: nose is -z, up is +y, the pilot's eyes are at
// (0, 0.85, 0.50) and the panel sits at z = -0.72. The group is added to the
// plane's group, so it inherits position, heading, pitch and bank.
import * as THREE from '../vendor/three.module.min.js';
import { FLIGHT } from './config.js';
import { headingDegrees } from './physics.js';
import { SUN_DIR } from './terrain.js';

const PANEL_W = 1024;
const PANEL_H = 560;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A radial white gradient for the sun glare quad (midday: white, not warm gold). */
function glareTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 80, 4, 128, 80, 130);
  grad.addColorStop(0, 'rgba(255, 250, 235, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 246, 222, 0.4)');
  grad.addColorStop(1, 'rgba(255, 240, 200, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 160);
  return new THREE.CanvasTexture(c);
}

/** Needle angle for a 240-degree dial sweep, 0 at 7 o'clock, max at 5 o'clock. */
function dialAngle(frac) {
  return ((-120 + frac * 240) * Math.PI) / 180;
}

export function buildCockpit(planeGroup) {
  const group = new THREE.Group();

  const interior = new THREE.MeshLambertMaterial({ color: 0x3a3f45, side: THREE.DoubleSide });
  const darkLeather = new THREE.MeshLambertMaterial({ color: 0x2a2320, side: THREE.DoubleSide });
  // Stage H: the A-pillars and the top bar are NOT black bars any more. Stage G
  // slimmed them (0.045 m) and they still read as thick black slabs in the
  // cockpit shots — near-black leather against a bright sky. A warm mid-grey
  // brown reads as a frame member, not a black bar; the pillars are also
  // slimmer (0.032), less raked and set wider, so more world shows between
  // them and the windshield.
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x7a6f60, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x24262a, side: THREE.DoubleSide });
  const metal = new THREE.MeshPhongMaterial({ color: 0x8a8f96, shininess: 60 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1a1c20 });

  // --- The live instrument panel: one canvas, one texture, one plane. --------
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = PANEL_W;
  panelCanvas.height = PANEL_H;
  const panelCtx = panelCanvas.getContext('2d');
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.anisotropy = 4;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.85),
    new THREE.MeshBasicMaterial({ map: panelTex }),
  );
  panel.position.set(0, 0.32, -0.72);
  group.add(panel);
  // A dark backing box so the panel reads as a slab, not a floating sheet.
  const panelBack = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.89, 0.06), black);
  panelBack.position.set(0, 0.32, -0.76);
  group.add(panelBack);

  // --- Glareshield, its shadow, and the magnetic compass on top. ------------
  // Stage H: the lip comes DOWN 0.77 -> 0.72. Stage G's note said the
  // threshold was visible at 0.77, but the short-final shot proved otherwise:
  // the sightline over the lip only reached ~3.5° below the horizon and the
  // threshold (about 4-5° down at 400 m) still hid behind the lip. At 0.72
  // the sightline reaches ~6° below the horizon, so the threshold and the
  // "36" numbers read on short final. The eye stays at 0.85 — raising it
  // further would push the panel down in the frame and clip the bottom
  // gauge row, which the brief forbids. The six-pack top (y ~0.60) still
  // clears the lowered lip: the sightline to it passes a few millimetres
  // under the lip's front-bottom edge, so no gauge is lost to the shield.
  const glareshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.38), darkLeather);
  glareshield.position.set(0, 0.72, -0.60);
  glareshield.rotation.x = 0.15;
  group.add(glareshield);
  // The glareshield's own shadow: a translucent dark plane hanging below its lip
  // over the top of the panel, so the panel's top edge sits in shade.
  // Stage G: SHARPER — the old shadow was a wide (0.42 m) soft band at 0.22,
  // a grey wash over the compass tape. Now it is a tight (0.30 m) band at 0.32:
  // a crisp line of shade with a visible edge, the way a real glareshield
  // throws one at noon — and it stops above the six-pack, so no gauge is ever
  // shaded. Stage H: the plane rides down with the lip, 0.61 -> 0.58.
  const glareshadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.30),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  glareshadow.position.set(0, 0.58, -0.70);
  glareshadow.rotation.x = 0.35;
  group.add(glareshadow);
  const compassCanvas = document.createElement('canvas');
  compassCanvas.width = 256;
  compassCanvas.height = 48;
  const compassCtx = compassCanvas.getContext('2d');
  const compassTex = new THREE.CanvasTexture(compassCanvas);
  compassTex.colorSpace = THREE.SRGBColorSpace;
  const compass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.056),
    new THREE.MeshBasicMaterial({ map: compassTex }),
  );
  compass.position.set(0, 0.78, -0.62); // Stage H: rides down with the lowered lip (was 0.83).
  compass.rotation.x = -0.5;
  group.add(compass);

  // --- Windshield frame: A-pillars and the top bar. Stage F, second pass: the
  //  pillars and top bar are TALLER (the windshield opens upward) — they used to
  //  end at y 1.06, right where the raised wing now sits, and the short frame
  //  pinched the view.
  // Stage G: the pillars are SLIMMER (0.045, was 0.06) and set a touch wider
  // (±0.76, was ±0.72) with less lean — the Stage F pillars were still thick
  // black bars eating the corners of the windshield. The world through the
  // glass opens up a little more on both sides.
  // Stage H: still not enough — the Stage G cockpit shots show two thick
  // BLACK diagonal bars. Slimmer again (0.032), less lean (0.12), wider
  // (±0.80), and in the warm mid-grey pillarMat instead of near-black
  // leather: a frame member now, not a black bar. The top bar follows the
  // same material so the windshield frame reads as one piece.
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.032, 1.15, 0.032), pillarMat);
    pillar.position.set(side * 0.80, 0.68, -0.88);
    pillar.rotation.z = -side * 0.12;
    pillar.rotation.x = 0.15;
    group.add(pillar);
  }
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.06), pillarMat);
  topBar.position.set(0, 1.22, -0.92);
  group.add(topBar);

  // --- The room: side walls, headliner, floor, rear bulkhead. Stage F, second
  //  pass: the headliner is HIGHER (y 1.16, was 0.98) and SHORTER (depth 1.0,
  //  was 1.5 — it no longer hangs over the windshield). At 0.98 it hung 0.23 m
  //  over the pilot's eyes and filled the top third of the windshield with a
  //  black slab; raised, it is only the roofline, and the sky opens up above
  //  the wing.
  // Stage H: shorter STILL (depth 0.7, centre z 0.30 — its front edge moves
  // from z -0.35 to z -0.05). The Stage G cockpit shots still show a black
  // band over the top ~20% of the frame: that is the headliner's underside,
  // unlit, and its front edge sits only ~18° above the eye's sightline. At
  // z -0.05 the edge is ~27° up, so the black band shrinks to ~6% of the
  // frame and the sky opens up between the top bar and the roof. The roof
  // above and behind the pilot stays covered (z -0.05..0.65).
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 1.7), interior);
    wall.position.set(side * 0.86, 0.38, 0.05);
    group.add(wall);
  }
  const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 0.7), interior);
  headliner.position.set(0, 1.16, 0.30);
  group.add(headliner);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 1.9), floorMat);
  floor.position.set(0, -0.52, 0.05);
  group.add(floor);
  const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.4, 0.05), interior);
  bulkhead.position.set(0, 0.3, 1.0);
  group.add(bulkhead);

  // Stage G: SUN PATCHES — hard-edged rectangles of bright midday light on the
  // floor and the console top, where the high sun shines in through the
  // windshield. A real cockpit at noon has them: a crisp lit shape with a
  // visible edge, not a uniform glow. They sit low (floor, console), clear of
  // the panel, so no gauge is ever washed out. Additive, so they lift the dark
  // floor without painting it white.
  const patchMat = new THREE.MeshBasicMaterial({
    color: 0xfff3da, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const floorPatch = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), patchMat);
  floorPatch.rotation.x = -Math.PI / 2;
  floorPatch.position.set(0.1, -0.49, -0.45);
  group.add(floorPatch);
  const consolePatch = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), patchMat);
  consolePatch.rotation.x = -Math.PI / 2;
  consolePatch.position.set(0, -0.235, -0.35);
  group.add(consolePatch);

  // --- Yoke: column + wheel, moving with the stick. ---------------------------
  const yoke = new THREE.Group();
  yoke.position.set(0, -0.02, -0.28);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.5, 8), metal);
  column.position.set(0, -0.12, 0.10);
  column.rotation.x = 0.6;
  yoke.add(column);
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.12, -0.02);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.028, 8, 24), black);
  wheel.add(rim);
  for (const a of [0, Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.03), black);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), metal);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  yoke.add(wheel);
  group.add(yoke);

  // --- Throttle quadrant: three levers on the centre console. ------------------
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.8), interior);
  consoleBox.position.set(0, -0.38, -0.35);
  group.add(consoleBox);
  const leverDefs = [
    { x: -0.09, knob: 0x1a1c20, rest: -0.2 }, // throttle: moves with the throttle
    { x: 0, knob: 0x2a5ad8, rest: 0.15 }, // prop: fixed, pushed in
    { x: 0.09, knob: 0xb02020, rest: -0.1 }, // mixture: fixed, rich
  ];
  const levers = leverDefs.map((def) => {
    const pivot = new THREE.Group();
    pivot.position.set(def.x, -0.22, -0.45);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), metal);
    arm.position.y = 0.13;
    pivot.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6),
      new THREE.MeshLambertMaterial({ color: def.knob }));
    knob.position.y = 0.27;
    pivot.add(knob);
    pivot.rotation.x = def.rest;
    group.add(pivot);
    return pivot;
  });

  // --- Rudder pedals. ----------------------------------------------------------
  const pedals = [];
  for (const side of [-1, 1]) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.04), black);
    pedal.position.set(side * 0.26, -0.42, -0.58);
    group.add(pedal);
    pedals.push(pedal);
  }

  // --- Switches: a row of toggles under the panel. Their canvas labels sit
  //  directly above them on the panel texture (world x -0.35..0.35 maps to
  //  canvas x 273..750), clear of the warning lights on the left.
  for (let i = 0; i < 5; i += 1) {
    const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.04), metal);
    toggle.position.set(-0.35 + i * 0.175, -0.18, -0.68);
    toggle.rotation.x = -0.25;
    group.add(toggle);
  }

  // --- Sun glare: a white additive quad on the windshield. ----------------------
  const glare = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 1.2),
    new THREE.MeshBasicMaterial({
      map: glareTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glare.position.set(0, 0.6, -1.05);
  group.add(glare);

  // --- Daylight cabin fill: the panel is backlit (unlit texture), this one lifts
  //  the yoke, levers and floor in the bright midday cabin, the way the sun
  //  through the windshield does. (Was a warm dusk light, 0xffc98a at 0.55.)
  const cabinLight = new THREE.PointLight(0xfff3da, 0.75, 4.5);
  cabinLight.position.set(0, 0.55, 0.25);
  group.add(cabinLight);

  planeGroup.add(group);

  // Stage G: the cockpit joins the real shadow system, but only two meshes
  // cast — the glareshield (its shade falls on the panel top, the sharp shadow
  // the user asked for) and the headliner (its shade falls on the panel's upper
  // edge). Everything else in here stays non-casting: the fuselage shell does
  // not cast either (plane.js), so the sun still reaches the cabin through the
  // windshield instead of the pilot flying in a black box.
  glareshield.castShadow = true;
  headliner.castShadow = true;

  // --- The live gauges ---------------------------------------------------------
  const gauges = {
    asiKt: 0, altFt: 0, vsiFpm: 0, hdgDeg: 0, rpm: 0, mpInHg: 0,
    fuelPct: 100, oilPsi: 0, oilTempF: 0, clockS: 0,
  };
  let frame = 0;

  function gaugeFace(g, cx, cy, r, label) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = '#0d0f12';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#c8ccd2';
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, r - 5, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(200, 204, 210, 0.35)';
    g.stroke();
    g.fillStyle = '#eef1f5';
    g.font = '700 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(label, cx, cy + r - 14);
    g.restore();
  }

  function dialTicks(g, cx, cy, r, min, max, majorStep, redFrom) {
    const span = max - min;
    if (redFrom !== undefined) {
      g.save();
      g.beginPath();
      g.arc(cx, cy, r - 8, dialAngle((redFrom - min) / span) - Math.PI / 2, dialAngle(1) - Math.PI / 2);
      g.lineWidth = 4;
      g.strokeStyle = '#e5534b';
      g.stroke();
      g.restore();
    }
    for (let v = min; v <= max + 0.001; v += majorStep / 2) {
      const frac = (v - min) / span;
      const a = dialAngle(frac);
      const major = Math.abs(v / majorStep - Math.round(v / majorStep)) < 0.001;
      const r1 = r - (major ? 16 : 10);
      g.save();
      g.strokeStyle = '#eef1f5';
      g.lineWidth = major ? 2.5 : 1.2;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      g.lineTo(cx + Math.sin(a) * (r - 6), cy - Math.cos(a) * (r - 6));
      g.stroke();
      g.restore();
      if (major) {
        g.save();
        g.fillStyle = '#eef1f5';
        g.font = '700 14px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(v), cx + Math.sin(a) * (r - 30), cy - Math.cos(a) * (r - 30));
        g.restore();
      }
    }
  }

  function needle(g, cx, cy, r, frac, color = '#f2c94c') {
    const a = dialAngle(clamp(frac, 0, 1));
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - Math.sin(a) * 10, cy + Math.cos(a) * 10);
    g.lineTo(cx + Math.sin(a) * (r - 14), cy - Math.cos(a) * (r - 14));
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  function dial(g, cx, cy, r, label, unit, min, max, value, majorStep, redFrom) {
    gaugeFace(g, cx, cy, r, label);
    dialTicks(g, cx, cy, r, min, max, majorStep, redFrom);
    needle(g, cx, cy, r, (value - min) / (max - min));
    g.save();
    g.fillStyle = '#9aa3b2';
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(unit, cx, cy + r * 0.42);
    g.restore();
  }

  function attitude(g, cx, cy, r, flight) {
    gaugeFace(g, cx, cy, r, 'ATTITUDE');
    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 4, 0, Math.PI * 2);
    g.clip();
    g.translate(cx, cy);
    g.rotate(flight.bank);
    const pitchPx = clamp(flight.pitch * 90, -30, 30);
    g.fillStyle = '#4a90d9';
    g.fillRect(-r, -r * 2 + pitchPx, r * 2, r * 2);
    g.fillStyle = '#8a6f4d';
    g.fillRect(-r, pitchPx, r * 2, r * 2);
    g.strokeStyle = '#f2f2e8';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-r, pitchPx);
    g.lineTo(r, pitchPx);
    g.stroke();
    g.restore();
    g.save();
    g.strokeStyle = '#f2c94c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 22, cy);
    g.lineTo(cx + 22, cy);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 3, 0, Math.PI * 2);
    g.fillStyle = '#f2c94c';
    g.fill();
    g.restore();
  }

  function headingIndicator(g, cx, cy, r, hdgDeg) {
    gaugeFace(g, cx, cy, r, 'HEADING');
    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 4, 0, Math.PI * 2);
    g.clip();
    g.translate(cx, cy);
    g.rotate((-hdgDeg * Math.PI) / 180);
    g.fillStyle = '#eef1f5';
    g.font = '700 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180;
      const label = card[d] || String(d / 10);
      g.fillText(label, Math.sin(a) * (r - 24), -Math.cos(a) * (r - 24));
    }
    g.strokeStyle = '#f2c94c';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -r + 8);
    g.lineTo(0, -r + 22);
    g.stroke();
    g.restore();
    g.save();
    g.fillStyle = '#f2c94c';
    g.beginPath();
    g.moveTo(cx - 6, cy - r + 4);
    g.lineTo(cx + 6, cy - r + 4);
    g.lineTo(cx, cy - r + 14);
    g.closePath();
    g.fill();
    g.restore();
  }

  function turnCoordinator(g, cx, cy, r, flight) {
    gaugeFace(g, cx, cy, r, 'TURN');
    g.save();
    g.translate(cx, cy);
    g.rotate(flight.bank * 0.5);
    g.strokeStyle = '#eef1f5';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-24, 0);
    g.lineTo(24, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(0, 8);
    g.stroke();
    g.restore();
    const ballX = clamp(-flight.bank * 22, -26, 26);
    g.save();
    g.beginPath();
    g.arc(cx + ballX, cy + r - 26, 7, 0, Math.PI * 2);
    g.fillStyle = '#f2f2e8';
    g.fill();
    g.strokeStyle = '#9aa3b2';
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }

  function drawPanel(flight) {
    const g = panelCtx;
    g.clearRect(0, 0, PANEL_W, PANEL_H);
    g.fillStyle = '#14171c';
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    // Screws in the corners.
    g.fillStyle = '#6a7078';
    for (const [sx, sy] of [[14, 14], [PANEL_W - 14, 14], [14, PANEL_H - 14], [PANEL_W - 14, PANEL_H - 14]]) {
      g.beginPath();
      g.arc(sx, sy, 5, 0, Math.PI * 2);
      g.fill();
    }
    // Magnetic compass tape along the top: numbers every 30 degrees, centred
    // on the current heading, with a fixed lubber line.
    const hdg = headingDegrees(flight);
    g.save();
    g.fillStyle = '#0d0f12';
    g.fillRect(20, 10, PANEL_W - 40, 56);
    g.strokeStyle = 'rgba(200, 204, 210, 0.4)';
    g.lineWidth = 1;
    g.strokeRect(20, 10, PANEL_W - 40, 56);
    g.font = '700 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      let rel = ((d - hdg + 540) % 360) - 180;
      if (Math.abs(rel) > 75) continue;
      const x = PANEL_W / 2 + (rel / 75) * (PANEL_W / 2 - 40);
      g.fillStyle = card[d] ? '#f2c94c' : '#eef1f5';
      g.fillText(card[d] || String(d).padStart(3, '0'), x, 38);
    }
    g.fillStyle = '#f2c94c';
    g.beginPath();
    g.moveTo(PANEL_W / 2 - 7, 10);
    g.lineTo(PANEL_W / 2 + 7, 10);
    g.lineTo(PANEL_W / 2, 22);
    g.closePath();
    g.fill();
    g.restore();

    // The six-pack.
    const xs = [92, 262, 432, 602, 772, 942];
    const r6 = 78;
    const cy6 = 176;
    const asiKt = flight.speed * 1.944;
    const altFt = flight.y * 3.281;
    const vsiFpm = flight.vspeed * 196.85;
    dial(g, xs[0], cy6, r6, 'AIRSPEED', 'knots', 0, 140, asiKt, 20, 120);
    attitude(g, xs[1], cy6, r6, flight);
    // Altimeter: the needle turns once per 1000 ft; the drum text says the rest.
    dial(g, xs[2], cy6, r6, 'ALTITUDE', 'feet', 0, 1000, ((altFt % 1000) + 1000) % 1000, 100);
    g.save();
    g.fillStyle = '#eef1f5';
    g.font = '700 16px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(`${Math.round(altFt)}`, xs[2], cy6 + 34);
    g.restore();
    turnCoordinator(g, xs[3], cy6, r6, flight);
    headingIndicator(g, xs[4], cy6, r6, hdg);
    dial(g, xs[5], cy6, r6, 'VERT SPEED', 'fpm x100', -20, 20, vsiFpm / 100, 10);

    // Engine gauges.
    const rE = 72;
    const cyE = 385;
    const rpm = 600 + flight.throttle * 21;
    const mp = 12 + flight.throttle * 0.17;
    const oilP = 55 + flight.throttle * 0.25;
    const oilT = 140 + flight.throttle * 0.6;
    dial(g, xs[0], cyE, rE, 'RPM', 'x100', 0, 27, rpm / 100, 5, 26);
    dial(g, xs[1], cyE, rE, 'MANIFOLD', 'inHg', 10, 30, mp, 5);
    dial(g, xs[2], cyE, rE, 'FUEL', '%', 0, 100, flight.fuel, 25, 80);
    dial(g, xs[3], cyE, rE, 'OIL PRESS', 'psi', 0, 100, oilP, 25);
    dial(g, xs[4], cyE, rE, 'OIL TEMP', '°F', 50, 250, oilT, 50, 230);
    // Clock: mission elapsed.
    gaugeFace(g, xs[5], cyE, rE, 'TIME');
    const mm = String(Math.floor(flight.elapsed / 60)).padStart(2, '0');
    const ss = String(Math.floor(flight.elapsed % 60)).padStart(2, '0');
    g.save();
    g.fillStyle = '#eef1f5';
    g.font = '700 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${mm}:${ss}`, xs[5], cyE - 6);
    g.font = '600 12px system-ui, sans-serif';
    g.fillStyle = '#9aa3b2';
    g.fillText('ELAPSED', xs[5], cyE + 22);
    g.restore();

    // Bottom strip: warning lights, switch labels, maker's plate.
    const stalled = flight.speed < FLIGHT.stallSpeed && !flight.onGround;
    const lowFuel = flight.fuel < 20;
    function warnLight(cx, on, color, label) {
      g.save();
      g.beginPath();
      g.arc(cx, 516, 11, 0, Math.PI * 2);
      g.fillStyle = on ? color : '#2a2e35';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = on ? '#ffffff' : 'rgba(200, 204, 210, 0.4)';
      g.stroke();
      if (on) {
        g.beginPath();
        g.arc(cx, 516, 17, 0, Math.PI * 2);
        g.strokeStyle = color;
        g.globalAlpha = 0.35;
        g.lineWidth = 3;
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = '#eef1f5';
      g.font = '700 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, cx, 544);
      g.restore();
    }
    warnLight(60, stalled, '#f2a541', 'STALL');
    warnLight(140, lowFuel, '#e5534b', 'LOW FUEL');
    g.save();
    g.fillStyle = '#9aa3b2';
    g.font = '600 13px system-ui, sans-serif';
    g.textAlign = 'center';
    for (let i = 0; i < 5; i += 1) {
      const x = 273 + i * 119;
      g.fillText(['NAV', 'STROBE', 'PITOT', 'LAND', 'AVIONICS'][i], x, 544);
    }
    g.fillStyle = '#eef1f5';
    g.font = '700 15px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText('LANGIT NUSANTARA · PK-LNI', PANEL_W - 24, 516);
    g.restore();

    panelTex.needsUpdate = true;
    gauges.asiKt = Math.round(asiKt);
    gauges.altFt = Math.round(altFt);
    gauges.vsiFpm = Math.round(vsiFpm);
    gauges.hdgDeg = Math.round(hdg);
    gauges.rpm = Math.round(rpm);
    gauges.mpInHg = Math.round(mp * 10) / 10;
    gauges.fuelPct = Math.round(flight.fuel);
    gauges.oilPsi = Math.round(oilP);
    gauges.oilTempF = Math.round(oilT);
    gauges.clockS = Math.floor(flight.elapsed);
  }

  function drawCompass(flight) {
    const g = compassCtx;
    const hdg = headingDegrees(flight);
    g.clearRect(0, 0, 256, 48);
    g.fillStyle = '#0d0f12';
    g.fillRect(0, 0, 256, 48);
    g.font = '700 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      let rel = ((d - hdg + 540) % 360) - 180;
      if (Math.abs(rel) > 60) continue;
      const x = 128 + (rel / 60) * 110;
      g.fillStyle = card[d] ? '#f2c94c' : '#eef1f5';
      g.fillText(card[d] || String(d).padStart(3, '0'), x, 24);
    }
    g.fillStyle = '#f2c94c';
    g.beginPath();
    g.moveTo(121, 0);
    g.lineTo(135, 0);
    g.lineTo(128, 10);
    g.closePath();
    g.fill();
    compassTex.needsUpdate = true;
  }

  // The sun in plane-local space: forward is -z, so alignment is -localSun.z.
  const localSun = new THREE.Vector3();
  const invQuat = new THREE.Quaternion();

  return {
    group,
    gauges,
    update(flight, input, dt, force = false) {
      frame += 1;
      // The panel redraws ~12 times a second: needles stay live, texture uploads
      // stay cheap. The first call (force) draws immediately for screenshots.
      if (force || frame % 5 === 0) {
        drawPanel(flight);
        drawCompass(flight);
      }
      // Yoke follows the stick: roll with the bank, pull with the pitch.
      yoke.rotation.z = -flight.bank * 0.55;
      yoke.rotation.x = 0.15 + flight.pitch * 0.5;
      // Throttle lever follows the throttle; prop and mixture stay put.
      levers[0].rotation.x = 0.7 - (flight.throttle / 100) * 1.1;
      // Rudder pedals follow the rudder keys.
      const yaw = input ? input.yaw || 0 : 0;
      pedals[0].position.z = -0.58 + yaw * 0.05;
      pedals[1].position.z = -0.58 - yaw * 0.05;
      // Sun glare: strong only when the pilot looks up into the high midday sun.
      invQuat.copy(planeGroup.quaternion).invert();
      localSun.copy(SUN_DIR).applyQuaternion(invQuat);
      const alignment = -localSun.z;
      glare.material.opacity = clamp((alignment - 0.55) * 1.4, 0, 0.45);
      glare.position.x = -localSun.x * 0.5;
      glare.position.y = 0.6 + localSun.y * 0.4;
      void dt;
    },
  };
}
