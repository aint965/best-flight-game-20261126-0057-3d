// Mission state machines: pure logic, no DOM, no Three.js. The browser loop and the
// Node simulation both drive this one module, so a mission the sim proves completable
// is a mission the game really completes — the two can never disagree.
//
// Ring Run: fly all 8 gold rings before the clock runs out.
// Island Hop: land on Pulau Karang, take off again, land back home.
// Storm Courier: fly 6 courier rings, then land on Pulau Karang before the front
// closes the strait — the front starts 4.2 km out, the clock is 4 minutes, and an
// east wind pushes the plane back toward home the whole way.
import { MISSION_DEFS } from './config.js';

const FRONT_START_KM = 4.2;
const FRONT_CLOSE_RATE = 0.006; // km lost per second: 4.2 -> 2.76 over the 4-minute clock
const STORM_WIND_X = -2.5; // m/s, from the east, pushing the plane back toward home
const STORM_RINGS = 6;

export function createMission(id) {
  const def = MISSION_DEFS.find((m) => m.id === id) || MISSION_DEFS[0];
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    timeLimit: def.timeLimit,
    timeLeft: def.timeLimit,
    elapsed: 0,
    done: false,
    failed: false,
    objective: initialObjective(def.id),
    leg: 0, // hop: 0 = outbound to Karang, 1 = homeward
    landedStrips: [],
    stormRings: 0,
    frontKm: FRONT_START_KM,
  };
}

function initialObjective(id) {
  if (id === 'hop') return 'Land on Pulau Karang 03/21';
  if (id === 'storm') return 'Courier rings 0/6 — front closes in 04:00';
  return 'Rings 0/8 — next ring 1';
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The east wind of the Storm Courier: a steady push back toward home. */
export function applyMissionWind(mission, flight, dt) {
  if (mission.id !== 'storm' || mission.done || mission.failed) return;
  flight.x += STORM_WIND_X * dt;
}

/**
 * Advance one mission by dt. ctx: { passed: number[] (ring indices passed this step),
 * landedStrip: string|null, nextRing: number, ringsPassed: number }.
 * Returns { toasts: string[], banner: string|null } for the HUD.
 */
export function missionStep(mission, ctx, dt) {
  const toasts = [];
  let banner = null;
  if (mission.done || mission.failed) return { toasts, banner };
  mission.elapsed += dt;
  mission.timeLeft = Math.max(0, mission.timeLeft - dt);

  if (mission.id === 'rings') {
    if (ctx.passed.length > 0) {
      mission.objective = `Rings ${ctx.ringsPassed}/8 — next ring ${ctx.nextRing + 1}`;
    }
    if (ctx.nextRing === -1) {
      mission.done = true;
      mission.objective = 'Course complete — free flight!';
      banner = 'COURSE COMPLETE';
    }
  } else if (mission.id === 'hop') {
    if (ctx.landedStrip) {
      mission.landedStrips.push(ctx.landedStrip);
      if (mission.leg === 0 && ctx.landedStrip === 'karang') {
        mission.leg = 1;
        mission.objective = 'Karang down — now bring her home';
        toasts.push('Karang down — now bring her home');
      } else if (mission.leg === 1 && ctx.landedStrip === 'home') {
        mission.done = true;
        mission.objective = 'Island Hop complete!';
        banner = 'ISLAND HOP COMPLETE';
      } else if (mission.leg === 0 && ctx.landedStrip === 'home') {
        toasts.push('Wrong strip — Karang is east');
      }
    }
  } else if (mission.id === 'storm') {
    mission.stormRings = Math.min(STORM_RINGS, ctx.ringsPassed);
    mission.frontKm = Math.max(0, FRONT_START_KM - mission.elapsed * FRONT_CLOSE_RATE);
    if (mission.stormRings < STORM_RINGS) {
      mission.objective = `Courier rings ${mission.stormRings}/6 — front closes in ${fmtTime(mission.timeLeft)}`;
    } else if (mission.leg === 0) {
      mission.objective = 'Rings done — land on Pulau Karang 03/21';
    }
    if (ctx.landedStrip === 'karang' && mission.stormRings >= STORM_RINGS) {
      mission.done = true;
      mission.leg = 1;
      mission.objective = 'Medicine delivered!';
      banner = 'DELIVERED';
      toasts.push('Medicine delivered — +750 pts');
    }
  }

  if (mission.timeLeft <= 0 && !mission.done) {
    mission.failed = true;
  }
  return { toasts, banner };
}
