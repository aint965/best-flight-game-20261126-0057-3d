// The screenshot scenes behind ?shot=cover|play|landing. Each one plays the real flight model
// forward from a fresh world for a fixed time, steered by a simple autopilot (bank toward the
// next ring, pitch toward its height, throttle steady), so the frame is what a short game really
// looks like and the same seed always gives the same frame.
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

/** Land on the home strip: glide down a 3-degree line aimed at the strip centre,
 *  below the surface, so the descent crosses the ground instead of levelling off
 *  above it. Strong pitch gain — a landing needs a firm hand, not a gentle one. */
export function landingInput(flight) {
  const tx = 0;
  const tz = 0;
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

/**
 * Stage a shot on the sim controller. The controller is main.js's live game:
 * { flight, rings, reset(spawn), step(dt, input) }.
 * Returns the seconds the autopilot flew.
 */
export function stageShot(sim, name) {
  if (name === 'play') {
    sim.reset(homeSpawn());
    const rings = sim.rings;
    let target = rings.rings[0];
    let flown = 0;
    for (let t = 0; t < 34; t += STEP) {
      const next = rings.nextIndex();
      if (next >= 0) target = rings.rings[next];
      sim.step(STEP, autopilotInput(sim.flight, target, 72));
      flown += STEP;
      if (sim.flight.crashed) break;
    }
    return flown;
  }
  if (name === 'landing') {
    sim.reset({ x: 0, y: 80, z: 900, heading: 0, speed: 26, throttle: 42 });
    let flown = 0;
    for (let t = 0; t < 45; t += STEP) {
      const f = sim.flight;
      sim.step(STEP, landingInput(f));
      flown += STEP;
      if (f.landed || f.crashed) break;
    }
    return flown;
  }
  // cover: already fast, east of home, flying at the last ring with the volcano behind it.
  sim.reset({ x: 2400, y: 160, z: -300, heading: 1.35, speed: 34, throttle: 72 });
  const rings = sim.rings;
  let flown = 0;
  for (let t = 0; t < 12; t += STEP) {
    const target = rings.rings[rings.rings.length - 1];
    sim.step(STEP, autopilotInput(sim.flight, target, 72));
    flown += STEP;
    if (sim.flight.crashed) break;
  }
  return flown;
}
