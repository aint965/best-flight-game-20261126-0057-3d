// Langit Nusantara: Island Hopper (3D) — the hand-in program (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files a desktop browser loads offline
// (game/index.html and its ES modules, Three.js vendored under game/vendor/, no network request).
// Three missions — Ring Run, Island Hop, Storm Courier — all proven completable in the
// Node simulation (flight3d-sim-i3.mjs) and captured in the 4-shot dossier below.
// Stage D polish (2026-11-26): textured foreground detail (bushes, rocks, flowers)
// plus a grain texture on the terrain so close grass is not a flat field; a 120 m
// lighthouse that reads as a tower from 3 km, with a short beam; finer sun glitter
// that fades along the path instead of white confetti; a deeper sea; wings-level
// final approach on the Island Hop shot; more cloud puffs with soft shadows. Stage D
// also fixed the plane's yaw sign (rotation.y = -heading): the model had flown
// tail-first on every heading but due north/south since Stage A — the nose dot the
// flight direction measured 0.30 at 36° instead of 1.00.
// Stage E polish (2026-11-26): the archipelago minimap is redrawn from the real
// terrain (groundAt/ISLANDS) — true island shapes, runway lines with "36"/"03",
// gold ring dots, volcano + lighthouse markers, the storm front band, and a
// heading-correct plane marker with a bearing line to the next ring; clouds are
// more volumetric (more varied puffs, bright tops, soft grey undersides, storm
// clouds darker and denser than fair-weather ones) and no hero cloud is clipped
// by the frame edge; the time bonus (+5/s of timeLeft at completion, awarded once)
// is applied identically in the browser and in the Node sim; and the menu system
// is complete — mission briefing before every start, a full pause menu, a controls
// overlay, and a results screen with the score breakdown (rings, landings, time
// bonus) and run stats. Sound and camera each have one source of truth, so the HUD
// button, the title button and the pause button can never disagree.
// Stage F, second pass (2026-11-26, user: "Mercusuar di atas gunung tidak
// realistis" + "Kontras warna pohon sama tanahnya gk sesuai" + "Suasananya buat
// siang coba"): the lighthouse moves off the volcano to the south tip of Pulau
// Karang (1500, -250) — a 32 m coastal tower on a rock plinth at sea level, beam
// sweeping the strait — and the volcano stands bare (crater + ash cap + strata);
// the whole atmosphere changes from sunset to midday (high white sun, blue sky,
// pale-blue fog, bright sea, white clouds, short shadows); and the pines, bushes
// and grass are re-tuned into one daylight family (yellow-green hue ~0.29,
// saturation ~0.42) so the trees sit in the ground instead of floating on it.
// The sunset version stays safe in git (commit eab0844) if the user prefers it.
// The same pass also fixed the cockpit VIEW, which a screenshot review caught:
// the wing sat so low over the cabin (y 1.05, the eye at 0.75) that its red front
// face filled the middle of the windshield, and the headliner (y 0.98) filled the
// top third with a black slab — the pilot saw almost no world ahead. A CDP probe
// that hid one mesh at a time proved it (wing off: red gone; headliner off: black
// gone). The wing now sits high (y 1.32, longer struts), the headliner is higher
// and shorter, and the windshield frame is taller — the leading edge reads at the
// TOP of the windshield, the way a real high-wing does, and the horizon opens up
// below it. The exterior walkaround camera was also fixed: it stood behind the
// tail (z +9) and showed the rear; it now stands three-quarter front (z -9).
// Stage G (2026-11-26, user: "Perbaiki lagi" + "Pencahayaannya shadownya
// pertajam lagi"): the lighting and shadows are sharpened for real. Until now
// every shadow in the game was a painted fake — a black disc under the plane, an
// ellipse under the clouds, a translucent plane over the panel. Now the sun casts
// REAL shadows (PCFSoftShadowMap in our vendored three r160 — the gamedev skill
// threejs-materials-lighting says r160 gets PCFSoft, since PCFShadowMap only
// turns soft in r182+; verified present in three.module.min.js — 2048 map on a
// tight 640 m orthographic shadow camera that rides the plane so the texels stay
// small where the camera looks, bias -0.0005 + normalBias 0.5 against acne):
// trees shade the grass, the wing shades the fuselage, the lighthouse tower
// shades the shore, the plane shades the strip. The light rig follows the same
// skill: one directional key at 2.5 (the skill's ~2–3 range), a hemisphere
// fill at 0.65, a modest camera fill at 0.35 — one shadow-casting light only, no
// point-light shadows (they would render the scene 6×). The sun is brighter
// (2.5) and the ambient bounces weaker, so lit reads bright and shadow reads
// deep. The same skill's three-place check (renderer.shadowMap.enabled +
// light.castShadow + per-mesh flags) is exposed to the driver via
// window.__game.lightRig, which lists every light, the caster count, and the
// tone mapping. The camera follows the companion skill camera-systems: the
// chase already smoothed exponentially (1 - exp(-rate * dt)) — rate raised
// 4.5 → 5.5 into the skill's ~5–12 range, fed the REAL frame delta instead of
// a fixed 1/60, with a 1.5 m deadzone and an eased 40 m look-ahead point (its
// own rate-3 smoothing, so a heading reversal swings the view instead of
// snapping it); the camera updates AFTER the sim steps (late update), is never
// parented to the plane, and the cockpit has no free-look so the skill's ±80°
// pitch clamp has nothing to clamp. The cockpit gets the same treatment — the
// wing is thinner with a pale underside (the red band in the windshield is now a
// thin pale strip), the A-pillars are slimmer and wider, the glareshield shadow
// is a tight dark line, and hard-edged sun patches fall on the floor and the
// console. Second pass (same night, after looking at the new cockpit shots):
// the red was gone but the world was still only a slit — the eye sat 5 cm BELOW
// the glareshield lip, so the sightline over it pointed UP and the runway hid
// behind the panel on final. The eye is raised to 0.85 and the glareshield
// lowered to 0.77 (compass and shadow plane move with it, side walls raised to
// keep the eye below their top edge): the sightline now reaches ~3.5° below
// the horizon, so the horizon, terrain, sea and volcano read through the
// windshield and all 12 gauges stay fully readable. The runway threshold on
// short final itself is still just below the lip — stated plainly, not hidden:
// pushing the eye further would clip the bottom gauge row, which the brief
// forbids. The blob under the plane goes the other way on purpose: it is only a
// soft contact patch now (radial gradient, 0.20), NOT the shadow — the sharp
// shadows are the directional ones. Trees are varied too (non-uniform scale, a
// third crown cone, ~50 old-growth giants in clusters) in the same daylight
// palette, the foreground gets denser detail plus grass tufts, the cover staging
// moves 400 m east so the 32 m coastal lighthouse reads bigger, the minimap
// lighthouse marker is a ringed dot, and the volcano's ash cap and crater get
// real rock texture. Nothing else changes: midday, coastal lighthouse, live
// gauges, menus, missions, minimap, "36"/"03", river, chase view.
// Stage H (2026-11-27, user: "Perbaiki lagi" — the Stage G leftovers, verified
// from the screenshots, not from memory): (1) the A-pillars STILL read as two
// thick black diagonal bars — slimmer again (0.032), less lean (0.12), wider
// (±0.80) and in a warm mid-grey (0x7a6f60) instead of near-black leather, so
// they read as a frame member; the top bar follows the same material. (2) The
// runway threshold on short final: Stage G's note claimed it was visible at
// a 0.77 lip, but the approach shot proved it wrong — the threshold still hid
// behind the lip. The lip comes down to 0.72 (compass 0.78, shadow plane
// 0.58 ride with it), so the sightline reaches ~6° below the horizon; the
// eye stays at 0.85 and the six-pack still clears the lip. (3) The bottom
// gauge row was already half-cut by the frame edge in Stage G (the engine
// dials' bottoms sit ~33° below the camera axis against a 31° half-field of
// view) — the cockpit camera now looks a fixed 3° down from the airframe
// axis, the pilot's natural glance at the panel, which brings the full
// engine row into frame without moving any geometry. (4) The headliner is
// shorter still (depth 0.7, front edge z -0.05): the black band over the top
// of the windshield shrinks from ~20% of the frame to ~6%. (5) The cover
// staging moves 80 m north (1000, 145, -180) so the third ring, which Stage G
// cut at the frame's right edge, is whole in frame; the volcano stays right
// of centre and the lighthouse reads bigger (~340 m away). (6) The minimap
// lighthouse marker is bigger again (6 px dot, 8.5 px red ring, white halo)
// — the Stage G marker still vanished in the zoom. (7) Trees lean: the crown
// cones are offset sideways in one fixed direction per tree (golden-angle
// from the index, no rng consumed, so the Stage G forest keeps its spots),
// and the giants get a fourth top cone. Same midday palette, same sharp
// shadows, same chase camera, same missions and scores.
// Stage I (2026-11-27, user: "Itu mercusuarnya masa siang lampunya juga nyala"
// + "Pesawatnya kamu buat lebih sangar aja"): two fixes in one round. (1) The
// lighthouse lamp is a LIGHT, not a fixture — at noon it burned a beam across
// the sea under a bright sun, which the user caught in the Stage H cover shot.
// The beam, the halo sprite and the lit lamp core now switch together through
// setLight(), wired in reset() to (missionId === 'storm'): on only in the Storm
// Courier, where the dark front makes a beam true, and off in the two daylight
// missions and on the title screen. The lamp room glass is dark slate by day
// (an unlit lamp) and bright only when the light is on; the tower, bands,
// cottage and plinth never change, and the minimap marker is a map symbol, not
// a light. A new storm-lighthouse shot stages the same fly-by in the Storm
// Courier to prove the beam is there — and only there. (2) The plane goes
// warbird: charcoal cowling, a bigger dark spinner, a shark mouth on the
// cowling (one marking, gape toward the nose, mirrored canvases per side),
// a sharper nose profile that dives to the point, a thick black cheatline with
// a white pinstripe, a charcoal belly stripe, charcoal wingtips and fin tip,
// longer exhausts and heavier panel lines. Still the same red Indonesian bush
// plane (PK-LNI, same wingspan, same fuselage length) — silhouette and livery
// only, so the flight model and the verified sim scores do not move, and the
// sharper nose keeps the runway threshold visible from the cockpit on final.
// Stage I-fix (2026-11-27, user: "Perbaiki lagi" + "Kaca bagian kotpit terlalu
// kecil"): the cockpit glass is still a slit, and the Stage H diagnosis was
// wrong — the khaki band over the top ~25% of the frame is NOT the headliner
// (its front edge already sits at ~27° up, just inside the 28° frame top). It
// is the WING's underside in shadow: the high wing spans from ~12.5° up to
// overhead from the eye, so it fills the whole top of the frame. The wing
// rises to 1.50 (struts, tips, flap/aileron lines, pitot, landing light and
// nav lights ride with it), the windshield frame grows up with it (pillars
// 1.30 tall at ±0.82, top bar 1.34), and the headliner moves back (front edge
// z 0.09, ~35° up — above the frame top, so it can never appear in frame).
// The glass grows from ~17° to ~21° of the 62° field and the wing band
// shrinks from ~25% to ~18% of the frame; the 12 gauges and the short-final
// threshold stay exactly as Stage H left them (lip untouched at 0.72, eye at
// 0.85). The same round fixes three more Stage I leftovers: (2) the black
// nose is too dominant — the cowling drum is red again with the charcoal kept
// only as a brow shell over the top, the shark mouth grows (bigger jaw and
// teeth in its canvas, quad 1.15 x 0.46) and the cheatline widens to 32 px
// with a 6 px pinstripe, so the nose reads red with teeth instead of a black
// block; (3) the dark diagonal wedge in the Stage I approach frame is the
// prop blade — wings level in that staging, so it cannot be the wing; the
// staged shots freeze the blades at one fixed ~55° diagonal, and at 0.55
// opacity the blade strobed across the windshield. The blades drop to 0.15:
// a real prop at flight RPM is a blur, and the blur disc does the spinning
// read now. A new banked-approach shot stages the same final while still
// turning onto it, to prove the wedge is gone in the condition that caught
// it. (4) The Storm Courier sky is still bright midday blue — the front wall
// was the only dark thing in the frame. The whole atmosphere now grades
// per mission (setSkyMode in reset(), next to the lighthouse wiring): storm
// mode darkens the sky shader to slate blue-grey, pulls the fog in closer
// and greyer, dims the sun 2.5 -> 1.8 and the hemisphere fill, mutes the sun
// glow sprite and deepens the sea; day mode restores every value exactly.
// The beam and the lamp core are MeshBasic, so the grade cannot dim them —
// the beam reads better against the dark sky. Same flight model, same sim
// scores (2875/2345/2790), same lighthouse position and lamp rule.
// Stage I-fix 2 (2026-11-27, user: "Perbaiki semuanya jangan ada cacatnya
// satupun. Biar tidak ada banyak perbaikan." — audit-first: every defect
// found in a full screenshot audit is fixed in this one round): (1) the top
// bar is still a dark slab across ~5% of the frame — it thins to 0.035 m
// (the pillar width), a slim frame line, and the glass gains ~2% at the top.
// The bar is NOT raised: above the wing leading edge's angle its background
// would be sky, and a dark line against blue reads MORE prominent, not less.
// (2) The glareshield lip drops a half-step more, 0.72 -> 0.70 (compass and
// shadow plane ride with it), so the sightline reaches ~6.5° below the
// horizon and the glass grows ~0.8% at the bottom; the 12 gauges and the
// short-final threshold are verified whole in the new shots. A wider FOV was
// considered and REJECTED on geometry: the glass is bounded by the wing
// leading edge (~19° up) and the lip (~6° down) — a fixed ~25° of the 62°
// field — so a wider field would hold the same 25° over a bigger field and
// the glass FRACTION would shrink while the khaki band above the wing would
// grow. (3) The cheatline widens 32 -> 48 px with a 9 px pinstripe and runs
// nose to tail (v 20..495), so it reads from the three-quarter front view
// where the foreshortened fuselage thinned it to a hairline. (4) The
// exterior walkaround camera pulls back (9 -> 14 m) and aims at the midpoint
// between the plane and the runway numbers, so the whole "36" reads in the
// lower frame with the plane standing on it — the old spot cut it at the
// left edge (the numbers are 34 m wide and sit only 13 m south of the
// parked plane). (5) The trees stop being cones: each crown layer is a wavy
// 8-segment pine layer (same triangle budget — the driver measures 2310
// ms/frame against a 3000 ms bound), the trunk is taller (4.2 m) and slimmer
// so it reads below the canopy, the crown has a light gradient (dark base,
// sunlit top), and the forest grows in groves with clearings instead of a
// uniform carpet. (6) The volcano stops being a layer cake: the strata gain
// a second, thinner band frequency, green gully fingers climb the lower
// flank where the noise says water runs, scree spills below the ash cap,
// and the treeline is a ragged height-and-gully gradient instead of a
// contour line. (7) The cover staging rises (145 -> 165) so the gold ring
// drops from ~19% to ~31% from the top of the frame, reading against the
// volcano's dark upper slope instead of empty sky; the cloud-exclusion cones
// move up with the new camera height. (8) Self-audit leftovers: the anvil
// cloud puffs were 8:1 flat discs — narrower, thicker and rarer now, and the
// ordinary puffs rounder, so the sky reads volumetric; the sea glitter
// streaks were white scratches — shorter (5–10 m) and dimmer now; the beach
// gains a wet-sand band at the waterline; and the results screen no longer
// shows the inside of the last green ring as its backdrop — the camera pulls
// up to a high scenic vantage over the plane when the results open. Two
// further passes were needed after viewing the attempts: a fixed offset still
// left a ring filling half the frame, and a ring-aware offset could land next
// to another ring — so the course markers are now hidden when the mission ends
// (reset() brings them back for Retry / Next / Menu) and the camera anchors on
// the volcano, 220 m out on the far side of the plane from the (3900, 0) peak,
// 70 m up and aiming 30 m above the plane so the peak and the sea horizon fall
// inside the frame (the first attempt at +120 m looked down too steeply and the
// peak cleared the top of the frame).
// The same second pass restaged the exterior walkaround: the first attempt
// stood north of the plane looking south, which read the "36" upside-down
// with the wing across the "3" — the camera now stands south of the numbers
// looking north, so the "36" reads the right way up, whole, in the lower
// frame with the plane beyond it. Same
// flight model, same sim scores (2875/2345/2790), same missions, same
// lighthouse rule.
// This program copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// The copy is byte for byte the same on every run: no timestamps, no randomness here.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others
// refuse an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB; more
// than 993 files in game/ or 48 MiB of game files, in all, or a path under game/ over 1000 bytes:
// game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });

// Stage E menus are part of the hand-in: the briefing, controls, pause and
// results overlays must exist in game/index.html, or the game would ship with
// buttons that open nothing. Refuse a hand-in that lost one.
const MENU_OVERLAYS = ['briefing-screen', 'controls-screen', 'pause-screen', 'results-screen'];
const html = readFileSync(join(gameDir, 'index.html'), 'utf8');
for (const id of MENU_OVERLAYS) {
  if (!html.includes(`id="${id}"`)) throw new Error(`main.ts: menu overlay #${id} missing from game/index.html`);
}
console.log(`menus: ${MENU_OVERLAYS.join(', ')} present in game/index.html`);

// Stage H: the cockpit view is the entry's most fragile piece — the threshold
// and the bottom gauge row both hid behind the panel or the frame edge in
// earlier stages. Refuse a hand-in whose cockpit camera lost its fixed
// down-look: without the pitch offset the bottom gauge row is half-cut again.
const mainJs = readFileSync(join(gameDir, 'src', 'main.js'), 'utf8');
if (!mainJs.includes('setFromAxisAngle(new THREE.Vector3(1, 0, 0)')) {
  throw new Error('main.ts: cockpit camera pitch offset missing from game/src/main.js');
}
console.log('cockpit: pitch offset present in game/src/main.js');

// Stage I: the lighthouse lamp is a light, not a fixture — it must be off in
// daylight and on only in the Storm Courier. Refuse a hand-in that lost the
// per-mission wiring: without it the beam burns at noon again.
if (!mainJs.includes("lighthouseLight.setLight(missionId === 'storm')")) {
  throw new Error('main.ts: lighthouse light wiring missing from game/src/main.js');
}
console.log('lighthouse: per-mission light wiring present in game/src/main.js');

// Stage I-fix: the storm grade is per-mission too — it must be wired in
// reset() next to the lighthouse call, or the Storm Courier flies under a
// bright midday sky again. Refuse a hand-in that lost it.
if (!mainJs.includes("setSkyMode(missionId === 'storm'")) {
  throw new Error('main.ts: storm sky wiring missing from game/src/main.js');
}
console.log('sky: per-mission sky wiring present in game/src/main.js');

// Stage I-fix: the prop blades are a BLUR at flight RPM, not two dark bars —
// at 0.55 opacity they strobed a dark diagonal wedge across the windshield in
// the staged approach shots (and in live play, once per revolution). Refuse a
// hand-in that put the opaque blades back.
const planeJs = readFileSync(join(gameDir, 'src', 'plane.js'), 'utf8');
if (!planeJs.includes('opacity: 0.15')) {
  throw new Error('main.ts: prop blade opacity 0.15 missing from game/src/plane.js');
}
console.log('prop: faint blades (opacity 0.15) present in game/src/plane.js');

// Stage I-fix 2: the top bar is a SLIM frame line (0.035 m), not the 0.06 m
// slab that crossed ~5% of the windshield — and the glareshield lip sits at
// 0.70, not 0.72. Refuse a hand-in that put the thick bar or the high lip back.
const cockpitJs = readFileSync(join(gameDir, 'src', 'cockpit.js'), 'utf8');
if (!cockpitJs.includes('BoxGeometry(1.5, 0.035, 0.06)')) {
  throw new Error('main.ts: slim top bar (0.035 m) missing from game/src/cockpit.js');
}
if (!cockpitJs.includes('position.set(0, 0.70, -0.60)')) {
  throw new Error('main.ts: lowered glareshield lip (0.70) missing from game/src/cockpit.js');
}
console.log('cockpit frame: slim top bar + lowered lip present in game/src/cockpit.js');

// Stage I-fix 2: the cheatline is 48 px wide with a 9 px pinstripe — the 32 px
// band vanished against the foreshortened fuselage from the three-quarter
// front view. Refuse a hand-in that thinned it back.
if (!planeJs.includes('fillRect(77, 20, 48, 475)')) {
  throw new Error('main.ts: wide cheatline (48 px) missing from game/src/plane.js');
}
console.log('livery: wide cheatline present in game/src/plane.js');

// Stage I-fix 2: the results screen opens over a high scenic vantage, not
// over the inside of the last green ring — the course markers are hidden when
// the mission ends (reset() brings them back for Retry / Next / Menu) and the
// camera anchors on the volcano (far side of the plane from the (3900, 0)
// peak, 220 m out, 120 m up), so the results read over the volcano and the
// sea. Refuse a hand-in that lost the ring-hiding or the volcano anchor.
if (!mainJs.includes('rings.setVisible(false)') || !mainJs.includes('3900 - flight.x')) {
  throw new Error('main.ts: results scenic camera (hide rings + volcano anchor) missing from game/src/main.js');
}
console.log('results: scenic camera (rings hidden, volcano anchor) present in game/src/main.js');

mkdirSync(join(out, 'screenshots'), { recursive: true });
const shotFiles = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => !name.startsWith('.'))
  : [];
// Stage I-fix 2: the dossier is exactly four staged shots — cover, cruise,
// rings, landing. Refuse a hand-in whose screenshots/ holds a partial set or
// a stray file, instead of shipping the wrong dossier silently.
const EXPECTED_SHOTS = ['1-cover.jpg', '2-cruise.jpg', '3-rings.jpg', '4-landing.jpg'];
const missing = EXPECTED_SHOTS.filter((name) => !shotFiles.includes(name));
const stray = shotFiles.filter((name) => !EXPECTED_SHOTS.includes(name));
if (missing.length > 0) throw new Error(`main.ts: dossier screenshots missing: ${missing.join(', ')}`);
if (stray.length > 0) throw new Error(`main.ts: unexpected files in screenshots/: ${stray.join(', ')}`);
if (shotFiles.length > 0) cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

// A hand-in that silently exceeds the scorer's caps is a refused entry, so report
// the totals against them here instead of finding out at the gate.
let gameFiles = 0;
let gameBytes = 0;
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.isFile()) {
      gameFiles += 1;
      gameBytes += statSync(p).size;
    }
  }
})(gameDir);
console.log(`game/: ${gameFiles} file(s), ${gameBytes} byte(s) (caps: ${DOSSIER_CAPS.game_max_files} files, ${DOSSIER_CAPS.game_max_bytes} bytes)`);

console.log(`handed in ${shotFiles.length} screenshot(s): ${shotFiles.join(', ')}`);
for (const name of shotFiles) {
  const bytes = statSync(join(shotsDir, name)).size;
  console.log(`screenshot ${name}: ${bytes} byte(s) (cap ${DOSSIER_CAPS.screenshots.max_bytes})`);
}
console.log(`dossier written to ${join(out, 'dossier.json')}`);
