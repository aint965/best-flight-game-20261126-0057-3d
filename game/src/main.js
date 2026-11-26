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
import { buildWorld } from './terrain.js';
import { buildPlane } from './plane.js';
import { buildRings } from './rings.js';
import { createFlight, stepFlight, EVENT_CRASHED, EVENT_LANDED, EVENT_RING } from './physics.js';
import { createHud } from './hud.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
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
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 20000);
camera.position.set(600, 140, 900);

const { stormWall } = buildWorld(scene);
const plane = buildPlane(scene);
const rings = buildRings(scene);

// A warm fill light that rides with the camera, pointed at the plane: it lights
// whatever the camera looks at, so the plane's camera-facing side never goes black
// when the sun is behind it (Stage B's landing frame was a dark silhouette). Kept
// modest (0.45) so the sunset mood is lifted, not flattened.
const fillLight = new THREE.DirectionalLight(0xffe0b8, 0.45);
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
let camMode = 'chase';
let camSettled = false;
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

function setCamMode(mode) {
  camMode = mode;
  camSettled = false;
  const label = `📷 Camera: ${camMode === 'far' ? 'Far' : 'Chase'}`;
  const hudBtn = document.getElementById('btn-camera');
  if (hudBtn) hudBtn.textContent = '📷 Camera';
  const pauseBtn = document.getElementById('pause-camera');
  if (pauseBtn) pauseBtn.textContent = label;
  return camMode;
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
  const fx = Math.sin(flight.heading);
  const fz = -Math.cos(flight.heading);
  const dist = camMode === 'far' ? 36 : 24;
  const height = camMode === 'far' ? 11 : 7.5;
  const tx = flight.x - fx * dist;
  const ty = flight.y + height;
  const tz = flight.z - fz * dist;
  const k = camSettled ? 1 - Math.exp(-dt * 4.5) : 1;
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.y += (ty - camera.position.y) * k;
  camera.position.z += (tz - camera.position.z) * k;
  camera.lookAt(flight.x + fx * 40, flight.y + 2, flight.z + fz * 40);
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
    setCamMode(camMode === 'chase' ? 'far' : 'chase');
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
    setCamMode(camMode === 'chase' ? 'far' : 'chase');
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
  // The cover looks at the volcano from ~3 km out: pull the camera back so the
  // whole mountain fits instead of filling the frame as a brown wall.
  camMode = name === 'cover' ? 'far' : 'chase';
  updateCamera(1);
  plane.update(flight);
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

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
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
      updateCamera(1 / 60);
      audio.engine(flight.throttle, !flight.onGround);
    }
    plane.update(flight);
    hud.update(flight, mission, mission.timeLeft, {
      rings: rings.rings, nextRing: rings.nextIndex(),
      frontX: stormWall.position.x, storm: mission.id === 'storm',
    });
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
