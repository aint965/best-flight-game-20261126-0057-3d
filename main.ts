// Langit Nusantara: Island Hopper (3D) — the hand-in program (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files a desktop browser loads offline
// (game/index.html and its ES modules, Three.js vendored under game/vendor/, no network request).
// Three missions — Ring Run, Island Hop, Storm Courier — all proven completable in the
// Node simulation (flight3d-sim-b.mjs) and captured in the 4-shot dossier below.
// Stage C polish (2026-11-26): a 60 m lighthouse that reads as a tower from 3 km, a sun
// glitter path that crosses the cover frame's sea, bigger 34 m runway numbers, a camera
// fill light so the plane never reads as a black silhouette, taller layered clouds, and
// a narrower winding river with a highlight ribbon.
// This program copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// The copy is byte for byte the same on every run: no timestamps, no randomness here.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
mkdirSync(join(out, 'screenshots'), { recursive: true });
const shotFiles = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => !name.startsWith('.'))
  : [];
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

console.log(`handed in ${shotFiles.length} screenshot(s): ${shotFiles.join(', ') || 'none'}`);
for (const name of shotFiles) {
  const bytes = statSync(join(shotsDir, name)).size;
  console.log(`screenshot ${name}: ${bytes} byte(s) (cap ${DOSSIER_CAPS.screenshots.max_bytes})`);
}
console.log(`dossier written to ${join(out, 'dossier.json')}`);
