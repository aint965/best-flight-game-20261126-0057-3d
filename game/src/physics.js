// The flight model: an arcade bush plane with throttle, lift, stall, banking turns,
// fuel, damage and landing detection. No Three.js here — this is pure numbers, so the
// screenshot autopilot and the input tests can drive it without a renderer.
import { FLIGHT } from './config.js';
import { groundAt, onStrip } from './world.js';

export const EVENT_RING = 1;
export const EVENT_LANDED = 2;
export const EVENT_CRASHED = 4;
export const EVENT_MISSION_DONE = 8;

/** Fresh flight state. onGround follows the spawn point: a spawn on the strip starts parked,
 *  a spawn in the air starts flying — never assume either. */
export function createFlight(spawn) {
  const ground = groundAt(spawn.x, spawn.z);
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    heading: spawn.heading,
    pitch: 0,
    bank: 0,
    speed: spawn.speed,
    throttle: spawn.throttle,
    vspeed: 0,
    onGround: spawn.y <= ground + 1.4,
    landed: false,
    crashed: false,
    damage: 0,
    fuel: 100,
    score: 0,
    elapsed: 0,
    /** Last counted touchdown { strip, at }: a landing counts again only on another
     *  strip, or on the same strip after 15 s — a bounce is not a second landing. */
    lastLanding: null,
  };
}

/**
 * One fixed step. `input` is { pitch, roll, yaw, throttleUp, throttleDown } in [-1, 1].
 * Returns event flags (EVENT_*). Ring checks live in rings.js; this only flies the plane.
 */
export function stepFlight(flight, input, dt) {
  if (flight.crashed) return 0;
  let events = 0;
  flight.elapsed += dt;

  if (input.throttleUp) flight.throttle = Math.min(100, flight.throttle + 25 * dt);
  if (input.throttleDown) flight.throttle = Math.max(0, flight.throttle - 30 * dt);
  if (flight.fuel <= 0) flight.throttle = 0;
  flight.fuel = Math.max(0, flight.fuel - FLIGHT.fuelDrain * (flight.throttle / 100) * dt);

  const targetSpeed = (flight.throttle / 100) * FLIGHT.maxSpeed;
  flight.speed += (targetSpeed - flight.speed) * Math.min(1, FLIGHT.accel * dt);
  if (flight.onGround) flight.speed = Math.max(0, flight.speed - FLIGHT.groundFriction * 0.35 * dt);

  // Banking turns the plane; pitch aims the nose; both ease toward the stick.
  // Positive bank (right stick) rolls the right wing down and turns the nose right,
  // which is a heading INCREASE: forward is (sin h, 0, -cos h), so h grows toward east.
  const targetBank = input.roll * FLIGHT.maxBank;
  flight.bank += (targetBank - flight.bank) * Math.min(1, 3.2 * dt);
  const targetPitch = input.pitch * FLIGHT.maxPitch;
  flight.pitch += (targetPitch - flight.pitch) * Math.min(1, 2.6 * dt);
  flight.heading += flight.bank * FLIGHT.turnRate * dt * (1.15 - 0.6 * (flight.speed / FLIGHT.maxSpeed));
  flight.heading += input.yaw * 0.25 * dt;

  const stalled = flight.speed < FLIGHT.stallSpeed;
  let vspeed = Math.sin(flight.pitch) * flight.speed;
  if (stalled && !flight.onGround) vspeed -= (FLIGHT.stallSpeed - flight.speed) * 0.9;
  if (flight.onGround && flight.speed > FLIGHT.takeoffSpeed && flight.pitch > 0.12) {
    flight.onGround = false;
  }
  flight.vspeed = vspeed;

  const clearance = 1.3;
  const fx = Math.sin(flight.heading);
  const fz = -Math.cos(flight.heading);
  flight.x += fx * flight.speed * dt;
  flight.z += fz * flight.speed * dt;
  flight.y += vspeed * dt;
  if (flight.onGround) {
    // Rolling on the strip: stay glued to the ground until the takeoff check lifts off.
    // (Without this the nose-up stick lets the plane float metres above the strip
    // while it is still flagged on the ground.)
    flight.y = groundAt(flight.x, flight.z) + clearance;
    flight.vspeed = 0;
  }

  const ground = groundAt(flight.x, flight.z);
  if (flight.y <= ground + clearance) {
    flight.y = ground + clearance;
    if (!flight.onGround) {
      const strip = onStrip(flight.x, flight.z);
      if (vspeed <= FLIGHT.crashSink) {
        flight.crashed = true;
        flight.damage = 100;
        events |= EVENT_CRASHED;
      } else if (vspeed <= FLIGHT.hardSink) {
        flight.damage = Math.min(100, flight.damage + 35);
        flight.onGround = true;
        if (flight.damage >= 100) {
          flight.crashed = true;
          events |= EVENT_CRASHED;
        }
      } else {
        flight.onGround = true;
        if (strip && Math.abs(vspeed) < 4 && flight.speed < 26) {
          const last = flight.lastLanding;
          if (!last || last.strip !== strip.name || flight.elapsed - last.at > 15) {
            flight.lastLanding = { strip: strip.name, at: flight.elapsed };
            flight.landed = true;
            flight.score += 750;
            events |= EVENT_LANDED;
          }
        }
      }
      flight.vspeed = 0;
    }
  }
  return events;
}

/** Heading in compass degrees (0 = north, 90 = east) for the HUD. */
export function headingDegrees(flight) {
  return ((flight.heading * 180) / Math.PI % 360 + 360) % 360;
}
