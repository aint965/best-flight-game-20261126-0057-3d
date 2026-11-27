// Langit Nusantara: Island Hopper (3D) — boot and the one loop.
// Input is read every frame, the flight model advances in fixed 1/60 s steps (several in a slow
// frame, none in a fast one), and the renderer paints what is there. Screens: title, play,
// paused and over. The camera chases the plane; the HUD is DOM over the canvas.
//
// ?seed=N fixes the world. ?shot=cover|play|landing (with &seed=N) stages that scene instead
// of running the loop, paints it twice and sets window.__shotReady for a screenshot.
// ?mission=rings starts straight into the Ring Run (the driver uses this).
import * as THREE from '../vendor/three.module.min.js';
import { BEST_KEY, MAX_FRAME, MISSION_DEFS, SCORE_RULES, STEP } from './config.js';
import { ISLANDS, groundAt, homeSpawn, onStrip } from './world.js';
import { buildWorld, updateSunShadow } from './terrain.js';
import { buildPlane } from './plane.js';
import { buildCockpit } from './cockpit.js';
import { buildRings } from './rings.js';
import { createFlight, stepFlight, EVENT_CRASHED, EVENT_LANDED, EVENT_RING } from './physics.js';
import { createHud } from './hud.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { autopilotInput, stageShot } from './shots.js';
import { applyMissionWind, createMission, missionStep, initialObjective } from './missions.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const missionParam = params.get('mission');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const titleScreen = document.getElementById('title-screen');
const briefingScreen = document.getElementById('briefing-screen');
const controlsScreen = document.getElementById('controls-screen');
const pauseScreen = document.getElementById('pause-screen');
const resultsScreen = document.getElementById('results-screen');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
// Stage G: real shadow maps. The gamedev skill threejs-materials-lighting says
// r160 gets PCFSoftShadowMap (PCFShadowMap only turns soft in r182+; in r160 it
// is the blocky one) — verified present in the vendored three.module.min.js.
// Sharpness comes from the 2048 map on a tight 640 m frustum that rides the
// plane (updateSunShadow, terrain.js), not from the filter: the edges read
// defined, ~1 texel wide, without the stair-step aliasing PCF would show.
// Exposure drops a touch with the stronger sun (2.5) so the lit side does not
// blow out.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 20000);
camera.position.set(600, 140, 900);

const { stormWall, sun, lighthouseLight, setSkyMode } = buildWorld(scene);
const plane = buildPlane(scene);
const cockpit = buildCockpit(plane.group);
const rings = buildRings(scene);

// A cool daylight fill light that rides with the camera, pointed at the plane:
// it lights whatever the camera looks at, so the plane's camera-facing side never
// goes black when the sun is behind it (Stage B's landing frame was a dark
// silhouette). Stage G: kept modest (0.35, was 0.5) — a strong fill would wash
// out the new sun/shadow contrast the user asked to sharpen.
const fillLight = new THREE.DirectionalLight(0xdfeaf8, 0.35);
fillLight.position.set(0, 200, 500);
scene.add(fillLight);
scene.add(fillLight.target);
const hud = createHud(ISLANDS);
const input = createInput();
const audio = createAudio();

let screen = 'title';
let best = readBest();
let flight = createFlight(homeSpawn());
let mission = createMission('rings');
// Stage I-fix: the sky grade follows the mission (see reset()) — the driver
// proves it through __game.skyMode, so the value lives here, not in terrain.
let currentSkyMode = 'day';
let camMode = 'chase';
let camSettled = false;
// Stage G (skill camera-systems): the look-ahead point is its own smoothed
// state — the camera aims at this, not at the raw 40 m-ahead point, so a
// heading reversal eases instead of snapping the view.
const lookTarget = new THREE.Vector3(0, 0, 0);
let lookInit = false;
let soundOn = true;
let autopilotOn = false;
// Menu state (Stage E): which mission the briefing card is showing, and where the
// controls overlay returns to when it closes.
let briefingMission = 'rings';
let controlsReturnTo = 'title';

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Sound and camera are each one piece of state with one writer: every button
 *  that touches them (HUD, title, pause menu) goes through these two functions,
 *  so the three places can never disagree about the state. */
function setSound(on) {
  soundOn = audio.set(on);
  const label = soundOn ? '🔊 Sound: On' : '🔇 Sound: Off';
  const hudBtn = document.getElementById('btn-sound');
  if (hudBtn) hudBtn.textContent = soundOn ? '🔊 Sound' : '🔇 Sound';
  for (const id of ['title-sound', 'pause-sound']) {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = label;
  }
  return soundOn;
}

/** Camera: three modes, one writer. Chase and Far look back at the plane from
 *  behind; Cockpit sits in the pilot's seat — the camera takes the plane's own
 *  orientation, so the view banks and pitches with the aircraft. The cockpit
 *  mode also adds a body class that hides the duplicative HTML instrument
 *  panels (the six-pack in the 3D panel replaces them). */
function setCamMode(mode) {
  camMode = mode;
  camSettled = false;
  document.body.classList.toggle('cockpit-mode', mode === 'cockpit');
  const label = `📷 Camera: ${mode === 'far' ? 'Far' : mode === 'cockpit' ? 'Cockpit' : 'Chase'}`;
  const hudBtn = document.getElementById('btn-camera');
  if (hudBtn) hudBtn.textContent = '📷 Camera';
  const pauseBtn = document.getElementById('pause-camera');
  if (pauseBtn) pauseBtn.textContent = label;
  return camMode;
}

function cycleCamMode() {
  return setCamMode(camMode === 'chase' ? 'cockpit' : camMode === 'cockpit' ? 'far' : 'chase');
}

/** Hide every overlay; the caller then shows the one it wants. Also clears the
 *  menu-open flag, which hides the compass and throttle slider while a menu is
 *  up (they would otherwise collide with the tall results screen). */
function hideOverlays() {
  document.body.classList.remove('menu-open');
  for (const el of [titleScreen, briefingScreen, controlsScreen, pauseScreen, resultsScreen]) {
    el.classList.add('hidden');
  }
}

function showTitle() {
  reset('rings');
  screen = 'title';
  hideOverlays();
  document.body.classList.add('menu-open');
  titleScreen.classList.remove('hidden');
  const titleBest = document.getElementById('title-best');
  if (titleBest) titleBest.textContent = String(best);
  announce('Langit Nusantara: Island Hopper. Choose a mission.');
}

function showBriefing(id) {
  const def = MISSION_DEFS.find((m) => m.id === id) || MISSION_DEFS[0];
  briefingMission = def.id;
  screen = 'briefing';
  hideOverlays();
  document.body.classList.add('menu-open');
  document.getElementById('briefing-title').textContent = def.name.toUpperCase();
  document.getElementById('briefing-blurb').textContent = def.blurb;
  // The Objective row is the HUD objective the mission starts with — not the
  // win line, which would just repeat it one row below.
  document.getElementById('briefing-objective').textContent = initialObjective(def.id);
  document.getElementById('briefing-win').textContent = def.win;
  document.getElementById('briefing-lose').textContent = def.lose;
  document.getElementById('briefing-howto').textContent = def.howto;
  document.getElementById('briefing-scoring').textContent =
    `Ring +${SCORE_RULES.ring} · Landing +${SCORE_RULES.landing} · Time bonus +${SCORE_RULES.timeBonusPerSecond}/s left · Clock ${fmtTime(def.timeLimit)}`;
  briefingScreen.classList.remove('hidden');
  announce(`${def.name}. ${def.blurb}`);
}

function showControls(from) {
  controlsReturnTo = from;
  screen = 'controls';
  hideOverlays();
  document.body.classList.add('menu-open');
  controlsScreen.classList.remove('hidden');
  announce('Controls. Press Escape to go back.');
}

function hideControls() {
  if (controlsReturnTo === 'pause') showPause();
  else showTitle();
}

function showPause() {
  screen = 'paused';
  hideOverlays();
  document.body.classList.add('menu-open');
  pauseScreen.classList.remove('hidden');
  announce('Paused.');
}

function resumeGame() {
  screen = 'play';
  hideOverlays();
  announce('Flying.');
}

function nextMissionId(id) {
  const order = ['rings', 'hop', 'storm'];
  return order[(order.indexOf(id) + 1) % order.length];
}

/** The results screen: total score plus the honest breakdown — rings, landings
 *  and the time bonus — and the run's stats. Shown automatically when a mission
 *  completes or fails; the flight is frozen behind it (the loop only steps in
 *  'play'), and it closes via Retry, Next Mission, Menu, or Esc. */
function showResults(success, reason) {
  if (screen === 'results') return;
  screen = 'results';
  hud.hideBanner();
  hud.hideToast();
  if (flight.score > best) {
    best = flight.score;
    saveBest(best);
    const titleBest = document.getElementById('title-best');
    if (titleBest) titleBest.textContent = String(best);
  }
  const ringsPassed = rings.passedCount();
  const ringPts = ringsPassed * SCORE_RULES.ring;
  const landings = mission.landedStrips.length;
  const landPts = landings * SCORE_RULES.landing;
  const bonus = success ? mission.timeBonus : 0;
  const ringLabel = mission.id === 'storm'
    ? `Courier rings ${mission.stormRings} × ${SCORE_RULES.ring}`
    : `Rings ${ringsPassed} × ${SCORE_RULES.ring}`;
  hideOverlays();
  document.body.classList.add('menu-open');
  document.getElementById('results-title').textContent =
    `${mission.name.toUpperCase()} — ${success ? 'COMPLETE' : 'FAILED'}`;
  document.getElementById('results-sub').textContent = reason;
  document.getElementById('results-score').textContent = String(flight.score);
  document.getElementById('results-rings-label').textContent = ringLabel;
  document.getElementById('results-rings').textContent = `+${ringPts}`;
  document.getElementById('results-landings-label').textContent = `Landings ${landings} × ${SCORE_RULES.landing}`;
  document.getElementById('results-landings').textContent = `+${landPts}`;
  document.getElementById('results-bonus-label').textContent = success
    ? `Time bonus (${Math.round(mission.timeLeft)}s left × ${SCORE_RULES.timeBonusPerSecond})`
    : 'Time bonus (mission failed)';
  document.getElementById('results-bonus').textContent = `+${bonus}`;
  document.getElementById('results-total').textContent = String(flight.score);
  document.getElementById('results-time').textContent = fmtTime(mission.elapsed);
  document.getElementById('results-rings-stat').textContent = mission.id === 'hop'
    ? '—'
    : `${mission.id === 'storm' ? mission.stormRings : ringsPassed}/${mission.id === 'storm' ? 6 : 8}`;
  document.getElementById('results-landings-stat').textContent = String(landings);
  document.getElementById('results-damage').textContent = `${Math.round(flight.damage)}%`;
  document.getElementById('results-fuel').textContent = `${Math.round(flight.fuel)}%`;
  document.getElementById('results-best').textContent = String(best);
  document.getElementById('results-next').textContent =
    `➜ Next Mission: ${MISSION_DEFS.find((m) => m.id === nextMissionId(mission.id)).name}`;
  resultsScreen.classList.remove('hidden');
  announce(`${mission.name} ${success ? 'complete' : 'failed'}. Score ${flight.score}.`);
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function announce(message) {
  status.textContent = message;
}

function reset(missionId = 'rings', spawn = homeSpawn()) {
  flight = createFlight(spawn);
  rings.reset();
  rings.setVisible(missionId !== 'hop');
  stormWall.visible = missionId === 'storm';
  stormWall.position.x = 4600;
  // Stage I: the lighthouse lamp burns only in the Storm Courier — the dark
  // sky by the front is the one place a beam reads true. In the two daylight
  // missions (and on the title screen, which resets to 'rings') it is off:
  // beam, halo and lit lamp core all switch together in setLight().
  lighthouseLight.setLight(missionId === 'storm');
  // Stage I-fix: the whole ATMOSPHERE follows the mission too — the storm
  // grade (dark slate sky, closer grey fog, dimmer sun, deeper sea) is on
  // only for the Storm Courier; the two daylight missions and the title
  // screen get the midday grade back, exactly (sun 2.5 — the driver asserts
  // it on a rings page).
  setSkyMode(missionId === 'storm' ? 'storm' : 'day');
  currentSkyMode = missionId === 'storm' ? 'storm' : 'day';
  mission = createMission(missionId);
  camSettled = false;
  hud.hideBanner();
}

/** The sim controller the screenshot stager drives: same steps as the live loop. */
const sim = {
  get flight() {
    return flight;
  },
  get rings() {
    return rings;
  },
  get mission() {
    return mission;
  },
  reset(spawn, missionId = 'rings') {
    reset(missionId, spawn);
  },
  step(dt, inp) {
    const events = stepFlight(flight, inp, dt);
    applyMissionWind(mission, flight, dt);
    const passed = rings.check(flight);
    if (passed.length > 0) flight.score += passed.length * 250;
    const landedStrip = (events & EVENT_LANDED) ? onStrip(flight.x, flight.z) : null;
    const out = missionStep(mission, {
      passed,
      landedStrip: landedStrip ? landedStrip.name : null,
      nextRing: rings.nextIndex(),
      ringsPassed: rings.passedCount(),
    }, dt);
    // The time bonus is awarded once, on the completing step (missions.js returns
    // it non-zero only then) — the Node sim applies the same line, so the scores
    // can never disagree between the game and its proof.
    if (out.timeBonus) flight.score += out.timeBonus;
    for (const t of out.toasts) hud.toast(t);
    if (events & EVENT_LANDED && out.toasts.length === 0) hud.toast('Landed — +750 pts');
    if (out.banner) hud.banner(out.banner);
    return events;
  },
};

function startGame(missionId = mission.id) {
  reset(missionId);
  screen = 'play';
  hideOverlays();
  audio.unlock();
  announce(`Flying. ${mission.name}: ${mission.blurb}`);
}

function updateCamera(dt) {
  if (camMode === 'cockpit') {
    // In the pilot's seat: the camera sits at the eye point and takes the
    // plane's own orientation, so the view banks and pitches with the aircraft.
    // Snapped, not lerped — a lerped cockpit would lag the plane it sits in.
    // Stage G, second pass: the eye is HIGHER (y 0.85, was 0.75). At 0.75 the
    // eye sat 5 cm BELOW the glareshield lip, so the sightline over the lip
    // pointed UP (+2°) and the whole runway hid behind the panel on final —
    // the approach shot showed sky and a sliver of horizon, no runway. At
    // 0.85 the eye is 8 cm above the lowered lip (0.77) and the sightline
    // reaches ~3.5° below the horizon: the horizon, terrain, sea and volcano
    // read through the windshield. (Stage G's note claimed the threshold was
    // visible too — the short-final shot proved it wrong: the threshold sits
    // ~4-5° down at 400 m and still hid behind the lip. Stage H lowers the
    // lip to 0.72 instead; see cockpit.js.)
    // Stage H: the cockpit camera looks 3° DOWN from the airframe axis. The
    // bottom gauge row was already half-cut by the frame edge in Stage G —
    // the engine dials' bottoms sit ~33° below the axis against a 31°
    // half-field of view — and raising the eye to fix it would push the
    // panel down further. A fixed 3° down-look (the pilot's natural glance
    // at the panel, within the camera-systems skill's cockpit pitch clamp)
    // brings the full engine row into the frame without moving any geometry,
    // and it does not change the physical sightline over the glareshield lip
    // (that is set by the eye and the lip, not by the camera's pitch). The
    // attitude gauge still shows the true pitch; only the view is reframed.
    const eye = new THREE.Vector3(0, 0.85, 0.50);
    plane.group.localToWorld(eye);
    camera.position.copy(eye);
    camera.quaternion.copy(plane.group.quaternion);
    camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.052));
    fillLight.position.copy(camera.position);
    fillLight.target.position.set(flight.x, flight.y, flight.z);
    camSettled = true;
    return;
  }
  const fx = Math.sin(flight.heading);
  const fz = -Math.cos(flight.heading);
  const dist = camMode === 'far' ? 36 : 24;
  const height = camMode === 'far' ? 11 : 7.5;
  const tx = flight.x - fx * dist;
  const ty = flight.y + height;
  const tz = flight.z - fz * dist;
  // Skill camera-systems: exponential smoothing, 1 - exp(-rate * dt), rate 5.5
  // (inside the skill's ~5–12 range) — the chase already used this shape at
  // rate 4.5; the rate is now inside the range. The deadzone below stops the
  // camera micro-drifting forever once it is within 1.5 m of its target.
  const k = camSettled ? 1 - Math.exp(-dt * 5.5) : 1;
  const dx = tx - camera.position.x;
  const dy = ty - camera.position.y;
  const dz = tz - camera.position.z;
  if (dx * dx + dy * dy + dz * dz > 1.5 * 1.5) {
    camera.position.x += dx * k;
    camera.position.y += dy * k;
    camera.position.z += dz * k;
  }
  // Look-ahead with easing: the camera aims 40 m ahead of the nose (it leads
  // the direction of travel), but the aim point itself is exponentially
  // smoothed at rate 3 — a heading reversal swings the view instead of
  // snapping it.
  const lx = flight.x + fx * 40;
  const ly = flight.y + 2;
  const lz = flight.z + fz * 40;
  if (!lookInit) {
    lookTarget.set(lx, ly, lz);
    lookInit = true;
  } else {
    const lk = 1 - Math.exp(-dt * 3);
    lookTarget.x += (lx - lookTarget.x) * lk;
    lookTarget.y += (ly - lookTarget.y) * lk;
    lookTarget.z += (lz - lookTarget.z) * lk;
  }
  camera.lookAt(lookTarget);
  // The fill light rides the camera and points at the plane.
  fillLight.position.copy(camera.position);
  fillLight.target.position.set(flight.x, flight.y, flight.z);
  camSettled = true;
}

function updateTitleCamera(dt) {
  const t = performance.now() / 1000;
  camera.position.set(620 + Math.sin(t * 0.05) * 120, 150, 950 + Math.cos(t * 0.05) * 80);
  camera.lookAt(900, 60, -300);
  void dt;
}

function handleActions() {
  const actions = input.takeActions();
  if (actions & ACTION_CONFIRM) {
    if (screen === 'title') showBriefing('rings');
    else if (screen === 'briefing') startGame(briefingMission);
    else if (screen === 'paused') resumeGame();
    else if (screen === 'controls') hideControls();
    else if (screen === 'results') startGame(mission.id);
    audio.unlock();
  }
  if (actions & ACTION_PAUSE) {
    if (screen === 'play') showPause();
    else if (screen === 'paused') resumeGame();
    else if (screen === 'briefing') showTitle();
    else if (screen === 'controls') hideControls();
    else if (screen === 'results') showTitle();
  }
  if (actions & ACTION_RESTART) {
    if (screen === 'play' || screen === 'paused' || screen === 'results') startGame(mission.id);
  }
  if (actions & ACTION_CAMERA) {
    if (screen === 'play') cycleCamMode();
  }
}

function wireButtons() {
  document.getElementById('btn-pause').addEventListener('click', () => {
    audio.unlock();
    if (screen === 'play') showPause();
    else if (screen === 'paused') resumeGame();
  });
  document.getElementById('btn-sound').addEventListener('click', () => {
    audio.unlock();
    setSound(!soundOn);
  });
  document.getElementById('btn-camera').addEventListener('click', () => {
    cycleCamMode();
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    if (screen === 'play' || screen === 'paused' || screen === 'results') startGame(mission.id);
  });
  document.getElementById('title-start').addEventListener('click', () => showBriefing('rings'));
  document.getElementById('title-hop').addEventListener('click', () => showBriefing('hop'));
  document.getElementById('title-storm').addEventListener('click', () => showBriefing('storm'));
  document.getElementById('title-controls').addEventListener('click', () => showControls('title'));
  document.getElementById('title-sound').addEventListener('click', () => {
    audio.unlock();
    setSound(!soundOn);
  });
  document.getElementById('briefing-start').addEventListener('click', () => startGame(briefingMission));
  document.getElementById('briefing-back').addEventListener('click', () => showTitle());
  document.getElementById('controls-back').addEventListener('click', () => hideControls());
  document.getElementById('pause-resume').addEventListener('click', () => resumeGame());
  document.getElementById('pause-restart').addEventListener('click', () => startGame(mission.id));
  document.getElementById('pause-change').addEventListener('click', () => showTitle());
  document.getElementById('pause-sound').addEventListener('click', () => {
    audio.unlock();
    setSound(!soundOn);
  });
  document.getElementById('pause-camera').addEventListener('click', () => {
    cycleCamMode();
  });
  document.getElementById('pause-controls').addEventListener('click', () => showControls('pause'));
  document.getElementById('pause-quit').addEventListener('click', () => showTitle());
  document.getElementById('results-retry').addEventListener('click', () => startGame(mission.id));
  document.getElementById('results-next').addEventListener('click', () => showBriefing(nextMissionId(mission.id)));
  document.getElementById('results-menu').addEventListener('click', () => showTitle());
  const slider = document.getElementById('throttle-slider');
  slider.addEventListener('input', () => {
    flight.throttle = Number(slider.value);
  });
  slider.addEventListener('pointerdown', () => audio.unlock());
}

function runShot(name) {
  stageShot(sim, name);
  // Stage D: the two-pass hop staging runs the approach to a landing in its first
  // pass, and its "Landed" toast survives into the frame (the toast hides on a
  // 2.6 s timer, but the screenshot is taken sooner). Clear it here — the rings
  // shot re-toasts its own score line below.
  hud.hideToast();
  // Stage D: log the staged state so the driver output shows what the frame is —
  // plane position, bank and score — instead of only the file size.
  console.info(`[shot] ${name} staged — plane at (${sim.flight.x.toFixed(0)}, ${sim.flight.y.toFixed(0)}, ${sim.flight.z.toFixed(0)}), bank ${sim.flight.bank.toFixed(2)}, heading ${(sim.flight.heading * 180 / Math.PI).toFixed(0)}°, score ${sim.flight.score}`);
  screen = 'play';
  // The dossier frame is gameplay, not a menu: hide every overlay, or the
  // screenshot shows a menu over the 3D scene.
  hideOverlays();
  // Stage F: the plane's quaternion must be current BEFORE the camera reads it —
  // the cockpit camera copies the plane's orientation, and staging only advanced
  // the flight state, not the mesh.
  plane.update(flight);
  // The cover looks at the volcano from ~3 km out: pull the camera back so the
  // whole mountain fits instead of filling the frame as a brown wall.
  setCamMode(name === 'cover' ? 'far' : name.startsWith('cockpit') ? 'cockpit' : 'chase');
  updateCamera(1);
  if (name === 'exterior') {
    // Walkaround: a parked plane, three-quarter FRONT view, close enough to read
    // the new fuselage skin, decals, nav lights and wheel pants. The nose points
    // north (-z), so the camera stands north-east of the plane — the old spot
    // (z +9) was behind the tail and showed the rear, not the front.
    camera.position.set(flight.x + 9, flight.y + 2.5, flight.z - 9);
    camera.lookAt(flight.x, flight.y + 0.5, flight.z);
  }
  rings.update(0);
  // The rings shot stops just before the second ring, after banking the first:
  // show the toast for the ring just passed, or the frame has no score story.
  if (name === 'rings' && rings.passedCount() > 0) {
    hud.toast(`Ring ${rings.passedCount()} — +250 pts`);
  }
  let painted = 0;
  function paint() {
    hud.update(flight, mission, mission.timeLeft, {
      rings: rings.rings, nextRing: rings.nextIndex(),
      frontX: stormWall.position.x, storm: mission.id === 'storm',
    });
    // Stage G: the shadow camera rides the plane — update it before every
    // paint, or the shadows lag a frame behind the aircraft.
    updateSunShadow(sun, flight.x, flight.y, flight.z);
    cockpit.update(flight, { pitch: 0, roll: 0, yaw: 0 }, 0, true);
    renderer.render(scene, camera);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  wireButtons();
  // The game boots on the title screen, which is a menu: hide the compass and
  // the throttle slider from the start, like every other menu state.
  document.body.classList.add('menu-open');
  // ?mission=hop|storm opens straight into that mission's world (rings hidden for
  // the hop, the storm wall shown for the courier); anything else is Ring Run.
  if (missionParam && ['rings', 'hop', 'storm'].includes(missionParam)) reset(missionParam);
  const titleBest = document.getElementById('title-best');
  if (titleBest) titleBest.textContent = String(best);
  let accumulator = 0;
  let last = performance.now();
  let elapsed = 0;
  // The last steering vector the loop used — the cockpit's yoke and pedals
  // follow the stick, so they need it even when the autopilot is flying.
  let lastInp = { pitch: 0, roll: 0, yaw: 0, throttleUp: false, throttleDown: false };

  function frame(now) {
    requestAnimationFrame(frame);
    // Stage G (skill camera-systems): the chase smoothing takes the REAL frame
    // delta, not a fixed 1/60 — with a fixed dt the follow feel changed with
    // the frame rate (at 144 fps the same k per frame converges more than twice
    // as fast in wall-clock time). The physics accumulator still eats fixed
    // steps; only the camera gets the real dt.
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += frameDt;
    last = now;
    handleActions();
    if (screen === 'title') {
      updateTitleCamera(0);
    } else if (screen === 'play') {
      while (accumulator >= STEP) {
        const before = flight.score;
        const inp = autopilotOn
          ? autopilotInput(flight, rings.nextIndex() >= 0 ? rings.rings[rings.nextIndex()] : { x: flight.x + 200, y: flight.y, z: flight.z }, 72)
          : input.read();
        lastInp = inp;
        const events = sim.step(STEP, inp);
        if (events & EVENT_CRASHED) {
          audio.crash();
          showResults(false, 'The plane is a wreck — a hard impact on the ground.');
          break;
        }
        if (flight.score > before) {
          audio.ring();
          hud.toast(`Ring ${rings.passedCount()} — +250 pts`);
        }
        accumulator -= STEP;
      }
      // The clock runs inside sim.step (one fixed step at a time), not here: counting it
      // in both places would run the mission timer twice as fast.
      if (mission.done && screen === 'play') {
        showResults(true, mission.objective);
      } else if (mission.timeLeft <= 0 && !mission.done) {
        if (mission.id === 'storm') {
          showResults(false, 'The storm front closed the strait before the medicine arrived.');
        } else {
          showResults(false, 'The clock ran out before the mission was finished.');
        }
      }
      // The storm front slides west as its clock runs down.
      if (mission.id === 'storm' && !mission.done) {
        stormWall.position.x = 4600 - mission.elapsed * 6;
      }
      elapsed += 1 / 60;
      rings.update(elapsed);
      // Late update, after the sim steps moved the plane (skill camera-systems):
      // the camera follows flight state, not plane.group, so it is never a
      // frame behind the aircraft. The camera is not parented to the plane —
      // it lives in the scene root and follows by code, so no shake or bank
      // ever leaks into it. (There is no free-look and no shake in this game:
      // the cockpit camera copies the airframe quaternion, so the skill's
      // ±80° pitch clamp has nothing to clamp — the pitch is the flight
      // model's, and the model limits it.)
      updateCamera(frameDt);
      audio.engine(flight.throttle, !flight.onGround);
    }
    plane.update(flight);
    if (screen === 'play') cockpit.update(flight, lastInp, 1 / 60);
    hud.update(flight, mission, mission.timeLeft, {
      rings: rings.rings, nextRing: rings.nextIndex(),
      frontX: stormWall.position.x, storm: mission.id === 'storm',
    });
    updateSunShadow(sun, flight.x, flight.y, flight.z);
    renderer.render(scene, camera);
    if (!window.__ready) window.__ready = true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') showPause();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  announce('Langit Nusantara: Island Hopper. Press Space or click to fly.');
  requestAnimationFrame(frame);
}

// The driver and the screenshot stager talk to the game through this handle.
window.__game = {
  get mode() {
    return screen;
  },
  get camMode() {
    return camMode;
  },
  setCamera(mode) {
    setCamMode(mode);
  },
  cycleCamera() {
    cycleCamMode();
  },
  /** The cockpit's live gauge values, for the driver to prove the needles move. */
  get cockpitGauges() {
    return { ...cockpit.gauges };
  },
  /** Stage G: the driver proves the real shadow system is on (PCFSoft in r160). */
  get shadows() {
    return renderer.shadowMap.enabled && renderer.shadowMap.type === THREE.PCFSoftShadowMap;
  },
  /** Stage I: the driver proves the lighthouse lamp state — off in daylight
   *  missions, on only in the Storm Courier. */
  get lighthouseLight() {
    return lighthouseLight.isOn;
  },
  /** Stage I-fix: the driver proves the sky grade follows the mission — 'day'
   *  for the two daylight missions and the title screen, 'storm' only for the
   *  Storm Courier. */
  get skyMode() {
    return currentSkyMode;
  },
  /**
   * Stage G (skill threejs-materials-lighting verification): the whole light
   * rig as the driver can see it — every light with its intensity and whether
   * it casts, the shadow map settings, how many meshes cast/receive, and the
   * tone mapping. If a shadow goes missing, the skill says to check the three
   * places first: renderer.shadowMap.enabled, light.castShadow, and the
   * per-mesh flags — this getter exposes all three at once.
   */
  get lightRig() {
    const lights = [];
    let casters = 0;
    let receivers = 0;
    scene.traverse((obj) => {
      if (obj.isLight) {
        lights.push({
          type: obj.type,
          intensity: obj.intensity,
          castShadow: !!obj.castShadow,
          color: obj.color ? `#${obj.color.getHexString()}` : null,
        });
      }
      if (obj.isMesh) {
        if (obj.castShadow) casters += 1;
        if (obj.receiveShadow) receivers += 1;
      }
    });
    return {
      lights,
      shadowCasters: casters,
      shadowReceivers: receivers,
      shadowMap: {
        enabled: renderer.shadowMap.enabled,
        type: renderer.shadowMap.type,
        // PCFSoftShadowMap === 2 in three r160.
        typeName: renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoftShadowMap'
          : renderer.shadowMap.type === THREE.PCFShadowMap ? 'PCFShadowMap' : 'other',
      },
      toneMapping: {
        // ACESFilmicToneMapping === 4 in three r160.
        typeName: renderer.toneMapping === THREE.ACESFilmicToneMapping ? 'ACESFilmic' : 'other',
        exposure: renderer.toneMappingExposure,
      },
      sunShadow: {
        mapSize: sun.shadow.mapSize.x,
        bias: sun.shadow.bias,
        normalBias: sun.shadow.normalBias,
        camera: {
          left: sun.shadow.camera.left,
          right: sun.shadow.camera.right,
          top: sun.shadow.camera.top,
          bottom: sun.shadow.camera.bottom,
          near: sun.shadow.camera.near,
          far: sun.shadow.camera.far,
        },
      },
    };
  },
  get flight() {
    return flight;
  },
  get mission() {
    return {
      id: mission.id,
      name: mission.name,
      objective: mission.objective,
      score: flight.score,
      ringsPassed: rings.passedCount(),
      ringsTotal: rings.count,
      timeLeft: mission.timeLeft,
      timeBonus: mission.timeBonus,
      landings: mission.landedStrips.length,
      elapsed: mission.elapsed,
      done: mission.done,
      failed: mission.failed,
    };
  },
  get camSettled() {
    return camSettled;
  },
  get autopilot() {
    return autopilotOn;
  },
  setAutopilot(v) {
    autopilotOn = !!v;
  },
  groundAt,
  startMission(id) {
    reset(id);
    screen = 'play';
    hideOverlays();
  },
  reset() {
    reset('rings');
  },
};

if (shot) runShot(shot);
else runGame();
