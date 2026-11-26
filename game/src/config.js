// Langit Nusantara: Island Hopper (3D) — every tuning number and colour in one place.
// Units are metres and seconds; speeds the HUD shows are converted to knots and feet there.

export const STEP = 1 / 60;
export const SEA_LEVEL = 0;

/** The simulation's fixed step and the longest frame the loop catches up on. */
export const MAX_FRAME = 0.25;

/** Flight model: an arcade bush plane, not a simulator. */
export const FLIGHT = {
  maxSpeed: 55, // m/s at full throttle (~107 kt)
  stallSpeed: 16, // m/s: below this the nose drops and the plane sinks
  accel: 0.45, // how fast speed chases its throttle target, per second
  climbRate: 9, // m/s of climb at full pitch up and full speed
  maxPitch: 0.38, // radians of nose up/down the stick commands
  maxBank: 0.85, // radians of bank the stick commands
  turnRate: 0.7, // radians of heading per second at full bank
  groundFriction: 14, // m/s^2 of braking on the ground
  takeoffSpeed: 22, // m/s: above this, pitch up lifts off
  crashSink: -7, // m/s of sink on touchdown that wrecks the plane
  hardSink: -4, // m/s of sink on touchdown that costs damage
  fuelDrain: 0.12, // percent of fuel per second at full throttle
};

export const RING = {
  count: 8,
  radius: 28, // torus ring radius, metres
  tube: 2.5,
  points: 250,
  // The course runs east from the home strip toward the volcano. It opens gently —
  // the first ring sits almost straight ahead of the strip, so the plane can take off,
  // climb and line up before the course turns east.
  course: [
    [200, 90, -350],
    [550, 120, -250],
    [900, 150, -450],
    [1300, 180, -150],
    [1700, 200, -550],
    [2100, 170, -300],
    [2500, 140, -650],
    [3000, 120, -300],
  ],
};

export const MISSION_DEFS = [
  {
    id: 'rings', name: 'Ring Run', timeLimit: 300, blurb: 'Fly all 8 gold rings before the clock runs out.',
    win: 'Fly through all 8 gold rings.',
    lose: 'The 5:00 clock runs out, or the plane crashes.',
    howto: 'Take off from the home strip, climb, and thread each gold hoop. Passed rings turn green; the next ring pulses gold.',
  },
  {
    id: 'hop', name: 'Island Hop', timeLimit: 300, blurb: 'Land on Pulau Karang, then bring her home.',
    win: 'Land on Pulau Karang 03/21, take off again, and land back home 36/18.',
    lose: 'The 5:00 clock runs out, or the plane crashes. Landing on the wrong strip does not count.',
    howto: 'Fly east to Pulau Karang and land on strip 03/21 (+750), then take off and bring her home to strip 36/18 (+750).',
  },
  {
    id: 'storm', name: 'Storm Courier', timeLimit: 240, blurb: 'Deliver the medicine before the front closes the strait.',
    win: 'Fly 6 courier rings, then land on Pulau Karang 03/21 before the front closes.',
    lose: 'The 4:00 clock runs out, the front closes the strait, or the plane crashes.',
    howto: 'Thread 6 courier rings, then land on Karang. An east wind (−2.5 m/s) pushes you back toward home the whole way — watch the STORM FRONT panel.',
  },
];

/** Scoring, shown on the briefing card and the results screen: a ring is +250,
 *  a counted landing +750, and finishing early pays +5 per second left on the clock. */
export const SCORE_RULES = { ring: 250, landing: 750, timeBonusPerSecond: 5 };

export const PALETTE = {
  skyTop: '#1c2f6e',
  skyMid: '#7a6fb0',
  skyHorizon: '#ff9a3c',
  sun: '#ffd9a0',
  fog: '#f7a56a',
  sea: '#1a5f7d', // Stage D: the deep blue again — the mid blue went pale grey-blue
  // under the sun path + fill light + fog in the cover frame; glitter stays bright
  // only along the path, the rest of the sea reads deep.
  seaDeep: '#1a5f7d',
  sand: '#e8d29a',
  grassA: '#5d8a4a',
  grassB: '#7aa85c',
  grassDark: '#42682f',
  forest: '#2f6b3a',
  rock: '#8a6f5c',
  rockDark: '#5e463a',
  ash: '#b9b3a8',
  seabed: '#3d5a4a',
  asphalt: '#41464f',
  marking: '#f2f2e8',
  planeRed: '#d23c28',
  planeWhite: '#f4ede0',
  ringGold: '#f2b705',
  ringDone: '#3fae5a',
  hudText: '#eef1f5',
  hudMuted: '#9aa3b2',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const BEST_KEY = 'langit-nusantara-3d.best';
