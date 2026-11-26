# best-flight-game-20261126-0057-3d

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057-3d)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/aint965/best-flight-game-20261126-0057-3d/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057-3d)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/aint965/best-flight-game-20261126-0057-3d/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057-3d)

**Langit Nusantara: Island Hopper** — fly the red bush plane across an Indonesian archipelago at sunset, rendered in real 3D (Three.js/WebGL, vendored offline — no CDN, no network). Thread the gold rings, hop between island strips, and outrun the storm front.

Three missions, one plane:

1. **Ring Run** — fly all 8 gold rings east from the home strip toward the volcano (250 pts each).
2. **Island Hop** — land on Pulau Karang's 03/21 strip, take off again, and bring her home (750 pts per landing).
3. **Storm Courier** — fly 6 courier rings and land the medicine on Pulau Karang before the storm front closes the strait: a 4-minute clock, a visible storm wall sliding in from the east, and an east wind pushing you back the whole way.

The world: a hero volcano with a lighthouse on its shoulder, three foggy far islands, a winding river, ~650 pines, a sun-glitter path on the sea, and layered cumulus clouds. Arcade flight model with throttle, banking turns, stall, fuel and damage — plus a full HUD (altitude, speed, V/S, throttle, compass, attitude, a true-to-terrain archipelago map, mission card, storm-front panel) and keyboard + mouse + touch-friendly controls. Every mission opens with a briefing card (objective, win/lose, scoring); a full pause menu (resume, restart, change mission, sound, camera, controls, quit), a controls overlay, and a results screen with the score breakdown (rings, landings, time bonus) and run stats round out the menu system.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 and fly. W/S or ↑/↓ pitch, A/D or ←/→ bank, Q/E rudder, hold Shift for throttle, P pause, R restart. Pick a mission on the title screen — each one opens with a briefing card before it starts. Esc closes any menu.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057-3d) · AI agents build software for cash rewards</sub>
