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
    // Island Hop, stopped on short final to Karang: the plane is ~350 m out, low,
    // with the "03" at the near threshold big ahead of it.
    sim.reset(homeSpawn(), 'hop');
    const pilot = createHopPilot();
    let flown = 0;
    for (let t = 0; t < 180; t += STEP) {
      const f = sim.flight;
      if (sim.mission.leg === 0 && near2(f, 1500, -900, 380) && f.y < 50) break;
      sim.step(STEP, pilot(f, sim.mission));
      flown += STEP;
      if (f.crashed || sim.mission.done) break;
    }
    return flown;
  }
  if (name === 'rings') {
    // Ring Run, stopped just before the second ring with the first one banked:
    // the plane is lined up and level, the gold hoop fills the frame ahead.
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
  if (name === 'landing') {
    // Home landing, stopped on short final: the plane is ~320 m out and low, flying
    // 60 m WEST of the centreline so the "36" at the near threshold reads big beside
    // the plane (not hidden behind it) and the river — now on the far side of the
    // strip — crosses the frame as a winding band instead of a blob at the camera.
    // Stage C: closer than Stage B (420 m), bigger numbers (34 m), and the rings are
    // hidden for this shot — one drifted into the frame behind the mission card.
    sim.reset({ x: -60, y: 80, z: 900, heading: 0, speed: 26, throttle: 42 }, 'rings');
    sim.rings.setVisible(false);
    let flown = 0;
    for (let t = 0; t < 45; t += STEP) {
      const f = sim.flight;
      sim.step(STEP, landingInput(f, -60, 0));
      flown += STEP;
      if ((near2(f, -60, 0, 320) && f.y < 32) || f.landed || f.crashed) break;
    }
    return flown;
  }
  // cover: far west of home, flying east at the last ring with the volcano behind it.
  // The plane starts ~3 km from the volcano so the whole mountain — slopes, crater,
  // lighthouse — fits in frame as the hero, instead of filling it as a brown wall.
  // It starts near the ring's altitude so the flight is level, not a dive.
  sim.reset({ x: 600, y: 140, z: -200, heading: 1.57, speed: 34, throttle: 72 }, 'rings');
  const rings = sim.rings;
  let flown = 0;
  for (let t = 0; t < 6; t += STEP) {
    const target = rings.rings[rings.rings.length - 1];
    sim.step(STEP, autopilotInput(sim.flight, target, 72));
    flown += STEP;
    if (sim.flight.crashed) break;
  }
  return flown;
}
