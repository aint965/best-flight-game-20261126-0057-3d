// The screenshot scenes behind ?shot=cover|hop|rings|landing, and the autopilot pilots
// for the two new missions. Each shot plays the real flight model forward from a fresh
// world for a fixed time, steered by a simple autopilot (bank toward the next target,
// pitch toward its height, throttle steady), so the frame is what a short game really
// looks like and the same seed always gives the same frame. The pilots live here — not
// in the Node test — so the sim proves the same steering the game itself uses.
import { STEP } from './config.js';
import { homeSpawn } from './world.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Steer toward a point: bank into the heading error, pitch toward the height error.
 *  Exported so the live loop can offer the same autopilot as a driver/assist hook.
 *  Slows down while the turn is wide, so the turn radius stays small enough to come
 *  back around to the target instead of orbiting it. */
export function autopilotInput(flight, target, throttle) {
  const dx = target.x - flight.x;
  const dz = target.z - flight.z;
  const desired = Math.atan2(dx, -dz);
  let err = desired - flight.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  const dy = target.y - flight.y;
  const cruise = Math.abs(err) > 0.5 ? 55 : throttle;
  return {
    pitch: clamp(dy * 0.012, -0.5, 0.6),
    roll: clamp(err * 1.4, -1, 1),
    yaw: 0,
    throttleUp: flight.throttle < cruise,
    throttleDown: flight.throttle > cruise,
  };
}

/** Land on a strip: glide down a 3-degree line aimed at the strip centre, below the
 *  surface, so the descent crosses the ground instead of levelling off above it.
 *  Strong pitch gain — a landing needs a firm hand, not a gentle one. */
export function landingInput(flight, tx = 0, tz = 0) {
  const desired = Math.atan2(tx - flight.x, -(tz - flight.z));
  let err = desired - flight.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  const dist = Math.hypot(flight.x - tx, flight.z - tz);
  const aimY = dist * 0.055 - 2;
  return {
    pitch: clamp((aimY - flight.y) * 0.03, -0.5, 0.6),
    roll: clamp(err * 1.4, -1, 1),
    yaw: 0,
    throttleUp: flight.speed < 24,
    throttleDown: flight.speed > 26,
  };
}

/** Pulau Karang's approach point: on the extended centreline of the 03 strip, 289 m
 *  out from the centre — the last straight-in fix before the glide. */
const KARANG_APPROACH = { x: 1310, y: 80, z: -492 };
const HOME_APPROACH = { x: 0, y: 80, z: 450 };
const KARANG_HEADING = 0.4363323129985824; // the 03 strip's compass heading, radians

function headingError(flight, target) {
  let e = flight.heading - target;
  while (e > Math.PI) e -= Math.PI * 2;
  while (e < -Math.PI) e += Math.PI * 2;
  return e;
}

function near2(flight, x, z, d) {
  return Math.hypot(flight.x - x, flight.z - z) < d;
}

/**
 * Island Hop, end to end: take off home, land Karang, take off again, land home.
 * The pilot reads the mission state the sim itself advances, so a landing that
 * does not count in the mission does not advance the pilot either.
 */
export function createHopPilot() {
  let phase = 0; // 0 takeoff, 1 cruise to Karang, 2 land Karang, 3 takeoff, 4 cruise home, 5 land home
  return function hopInput(flight, mission) {
    switch (phase) {
      case 0:
        if (!flight.onGround) phase = 1;
        return { pitch: 1, roll: 0, yaw: 0, throttleUp: true, throttleDown: false };
      case 1:
        if (near2(flight, KARANG_APPROACH.x, KARANG_APPROACH.z, 250)) phase = 2;
        return autopilotInput(flight, KARANG_APPROACH, 72);
      case 2:
        if (mission.leg === 1) phase = 3;
        return landingInput(flight, 1500, -900);
      case 3:
        if (!flight.onGround) phase = 4;
        return { pitch: 1, roll: 0, yaw: 0, throttleUp: true, throttleDown: false };
      case 4:
        if (near2(flight, HOME_APPROACH.x, HOME_APPROACH.z, 250)) phase = 5;
        return autopilotInput(flight, HOME_APPROACH, 72);
      default:
        return landingInput(flight, 0, 0);
    }
  };
}

/**
 * Storm Courier: fly the first 6 courier rings, then land on Pulau Karang before the
 * front closes the strait. The pilot reads mission.stormRings, which the mission
 * state machine counts from the same ring checks the game uses.
 */
export function createStormPilot(rings) {
  let phase = 0; // 0 courier rings, 1 cruise to Karang, 2 land Karang
  return function stormInput(flight, mission) {
    if (phase === 0) {
      if (mission.stormRings >= 6) phase = 1;
      const next = rings.nextIndex();
      const target = next >= 0 ? rings.rings[next] : { x: 1500, y: 80, z: -900 };
      return autopilotInput(flight, target, 72);
    }
    if (phase === 1) {
      if (near2(flight, KARANG_APPROACH.x, KARANG_APPROACH.z, 250)) phase = 2;
      return autopilotInput(flight, KARANG_APPROACH, 72);
    }
    return landingInput(flight, 1500, -900);
  };
}

/**
 * Stage a shot on the sim controller. The controller is main.js's live game:
 * { flight, rings, mission, reset(spawn, missionId), step(dt, input) }.
 * Returns the seconds the autopilot flew.
 */
export function stageShot(sim, name) {
  if (name === 'hop') {
    // Island Hop, stopped on short final to Karang, WINGS LEVEL: the old break fired
    // the moment the plane got within 380 m, while it was still banking out of the
    // turn onto final. Stage D flies the approach twice (the staging is fully
    // deterministic, same seed, same pilot): pass 1 finds the best-aligned moment on
    // final — close, low, bank near zero, heading on the strip — and pass 2 re-flies
    // to exactly that moment and stops. If no aligned moment is found, fall back to
    // the old break so the shot still stages.
    const K_HEADING = KARANG_HEADING;
    let bestT = -1;
    let bestScore = Infinity;
    {
      sim.reset(homeSpawn(), 'hop');
      const pilot = createHopPilot();
      for (let t = 0; t < 200; t += STEP) {
        const f = sim.flight;
        if (sim.mission.leg === 0) {
          const d = Math.hypot(f.x - 1500, f.z + 900);
          // Stage D, second pass: the window is 260–380 m out and 18–55 m up — the
          // first pass used <380 m and picked a moment 161 m out, past the "03"
          // numbers (they sit at the approach threshold) and nearly on the grass.
          // The score also prefers the farther moment, so the numbers stay ahead
          // of the plane, big in frame.
          if (d >= 260 && d < 380 && f.y > 18 && f.y < 55) {
            const s = Math.abs(f.bank) + 1.5 * Math.abs(headingError(f, K_HEADING)) + (380 - d) * 0.001;
            if (s < bestScore) { bestScore = s; bestT = t; }
          }
        }
        if (f.crashed || sim.mission.done) break;
        sim.step(STEP, pilot(f, sim.mission));
      }
    }
    sim.reset(homeSpawn(), 'hop');
    const pilot = createHopPilot();
    let flown = 0;
    for (let t = 0; t < 200; t += STEP) {
      const f = sim.flight;
      if (bestT >= 0) {
        if (t >= bestT) break;
      } else if (sim.mission.leg === 0 && near2(f, 1500, -900, 380) && f.y < 50) break;
      sim.step(STEP, pilot(f, sim.mission));
      flown += STEP;
      if (f.crashed || sim.mission.done) break;
    }
    return flown;
  }
  if (name === 'rings' || name === 'cockpit-cruise') {
    // Ring Run, stopped just before the second ring with the first one banked:
    // the plane is lined up and level, the gold hoop fills the frame ahead.
    // The cockpit-cruise shot stages the same moment — the driver just asks
    // main.js to paint it from the pilot's seat instead of the chase camera.
    sim.reset(homeSpawn(), 'rings');
    const rings = sim.rings;
    let flown = 0;
    for (let t = 0; t < 60; t += STEP) {
      const next = rings.nextIndex();
      const target = next >= 0 ? rings.rings[next] : rings.rings[0];
      sim.step(STEP, autopilotInput(sim.flight, target, 72));
      flown += STEP;
      if (sim.flight.crashed) break;
      if (rings.passedCount() >= 1) {
        const r2 = rings.rings[1];
        const d = Math.hypot(sim.flight.x - r2.x, sim.flight.y - r2.y, sim.flight.z - r2.z);
        if (d < 130) break;
      }
    }
    return flown;
  }
  if (name === 'landing' || name === 'cockpit-approach') {
    // Home landing, stopped on short final: the plane is ~400 m out and low, flying
    // 35 m WEST of the centreline (was 60 m) so the "36" at the near threshold reads
    // big beside the plane — comfortably inside the frame, not hugging the right
    // edge — and the river — now on the far side of the strip — crosses the frame as
    // a winding band instead of a blob at the camera.
    // Stage C: closer than Stage B (420 m), bigger numbers (34 m), and the rings are
    // hidden for this shot — one drifted into the frame behind the mission card.
    // The cockpit-approach shot stages the same final — painted from the seat.
    sim.reset({ x: -35, y: 80, z: 900, heading: 0, speed: 26, throttle: 42 }, 'rings');
    sim.rings.setVisible(false);
    let flown = 0;
    for (let t = 0; t < 45; t += STEP) {
      const f = sim.flight;
      sim.step(STEP, landingInput(f, -35, 0));
      flown += STEP;
      if ((near2(f, -35, 0, 400) && f.y < 40) || f.landed || f.crashed) break;
    }
    return flown;
  }
  if (name === 'lighthouse') {
    // Fly-by past the coastal lighthouse: the plane 250 m west of the tower at
    // 60 m, heading east — the chase camera puts the white tower, its rock plinth
    // and the sea around it centre-frame, with Karang's shore behind it. The
    // tower top is ~41 m, the plane clears it by ~19 m. The flight path runs
    // 30 m SOUTH of the tower's latitude (z -280, not -250), so the tower sits
    // BESIDE the plane in frame instead of hiding behind it.
    sim.reset({ x: 1250, y: 60, z: -280, heading: 1.57, speed: 30, throttle: 60 }, 'rings');
    sim.rings.setVisible(false);
    let flown = 0;
    for (let t = 0; t < 3; t += STEP) {
      sim.step(STEP, autopilotInput(sim.flight, { x: 1500, y: 60, z: -280 }, 60));
      flown += STEP;
      if (sim.flight.crashed) break;
    }
    return flown;
  }
  if (name === 'exterior') {
    // Walkaround: the plane parked on the home strip, engine idling. main.js
    // places the camera three-quarter front, close enough to read the skin.
    sim.reset(homeSpawn(), 'rings');
    return 0;
  }
  // cover: far west of home, flying east at the last ring with the volcano behind it.
  // The plane starts ~3 km from the volcano so the whole mountain — slopes, crater —
  // fits in frame as the hero, instead of filling it as a brown wall, with the
  // lighthouse on Karang's south tip sitting low mid-frame below the ring.
  // It starts near the ring's altitude so the flight is level, not a dive.
  // Stage G: the start moves 400 m east and 60 m south (1000, 145, -260) so the
  // coastal lighthouse — a 32 m tower, not the old 120 m monument — reads bigger
  // in frame without changing its realistic scale; the volcano is still ~2.9 km
  // out and fits whole. blocksHero's cover cones moved with the new camera.
  // Stage H: the start moves 80 m NORTH (1000, 145, -180). In Stage G the
  // third ring (1300, 180, -150) sat ~39° right of the camera axis and its
  // right edge was cut by the frame; 80 m north puts it ~20° right with its
  // whole 28 m disc inside the frame, while the volcano stays right of
  // centre and the lighthouse — now ~340 m away instead of ~540 m — reads
  // bigger at the coast, low mid-frame. blocksHero's cover cones move again.
  // Stage H, second pass: the north move fixed the RIGHT edge, but the ring
  // was still cut at the TOP edge — it sits only ~100 m from the camera after
  // 6 s of flight, so its 28 m disc spans ~26° and its top clears the frame.
  // The flight is shortened 6 s -> 4 s: the camera stops ~70 m further west,
  // the ring is ~170 m out and ~9° across, and its whole disc sits inside
  // the frame with margin, clear of the HUD panels on the right.
  sim.reset({ x: 1000, y: 145, z: -180, heading: 1.57, speed: 34, throttle: 72 }, 'rings');
  const rings = sim.rings;
  let flown = 0;
  for (let t = 0; t < 4; t += STEP) {
    const target = rings.rings[rings.rings.length - 1];
    sim.step(STEP, autopilotInput(sim.flight, target, 72));
    flown += STEP;
    if (sim.flight.crashed) break;
  }
  return flown;
}
