// The red bush plane, built from primitives — no photo assets, no downloads.
// Stage F: a tapered lathe fuselage (not a plain tube) with a procedural
// panel-lines/rivets/cheatline texture, registration decals, nav lights and a
// blinking strobe, wheel pants, antenna, exhausts and a pitot tube. High-wing,
// red fuselage, glass canopy, spinning prop blur disc, tail, fixed gear, and a
// soft blob shadow that follows the ground so landings read.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { groundAt } from './world.js';

/** The fuselage skin: red base, a darker belly stripe, a white cheatline along
 *  each side at window height, longeron + frame panel lines and rivet dots.
 *  Lathe u maps around the fuselage (0 = top, 0.25 = right side, 0.5 = belly,
 *  0.75 = left side) and v runs tail -> nose, so the cheatline sits at
 *  u ~0.18 / ~0.82 (just above the side centreline) and the belly stripe at
 *  u ~0.5. The canvas is drawn once and shared by the fuselage material. */
function fuselageTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.planeRed;
  g.fillRect(0, 0, 512, 512);
  // Belly stripe, darker red, full length.
  g.fillStyle = '#a82c1e';
  g.fillRect(236, 0, 40, 512);
  // Cheatlines: white stripes along each side at window height.
  g.fillStyle = PALETTE.planeWhite;
  g.fillRect(82, 30, 16, 450);
  g.fillRect(414, 30, 16, 450);
  // Longeron lines (constant u, running nose to tail).
  g.strokeStyle = 'rgba(120, 20, 10, 0.45)';
  g.lineWidth = 1.5;
  for (let x = 0; x <= 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  // Frame lines (constant v, rings around the fuselage).
  for (let y = 0; y <= 512; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  // Rivet dots along the longerons.
  g.fillStyle = 'rgba(60, 10, 5, 0.35)';
  for (let x = 16; x < 512; x += 32) {
    for (let y = 8; y < 512; y += 16) {
      g.beginPath();
      g.arc(x, y, 1.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A text decal on a transparent canvas: registration / titles on the fuselage
 *  and fin. The plane is placed just off the skin so it never z-fights. */
function textDecal(lines, w, h) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(20, 10, 5, 0.65)';
  g.fillStyle = PALETTE.planeWhite;
  g.font = '800 58px system-ui, sans-serif';
  g.strokeText(lines[0], 256, 44);
  g.fillText(lines[0], 256, 44);
  if (lines[1]) {
    g.font = '700 30px system-ui, sans-serif';
    g.strokeText(lines[1], 256, 100);
    g.fillText(lines[1], 256, 100);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  // A decal is a flat quad floating 3 cm off the skin: in the shadow map its
  // alpha is ignored, so it would throw a solid rectangle's shadow on the
  // fuselage. It never casts.
  mesh.userData.noShadow = true;
  return mesh;
}

export function buildPlane(scene) {
  // A whisper of emissive on the red so the plane never reads as a black silhouette
  // when the sun is behind the camera's subject (Stage B's landing frame): the red
  // stays red even on its shadow side.
  const red = new THREE.MeshLambertMaterial({ color: PALETTE.planeRed, emissive: 0x2e0a06 });
  const redSkin = new THREE.MeshLambertMaterial({ map: fuselageTexture(), emissive: 0x2e0a06 });
  const white = new THREE.MeshLambertMaterial({ color: PALETTE.planeWhite });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const metal = new THREE.MeshPhongMaterial({ color: 0x9aa0a8, shininess: 80 });
  const glass = new THREE.MeshPhongMaterial({
    color: 0x9fd8e8, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.75,
  });
  const group = new THREE.Group();

  // Tapered fuselage: a lathe profile from the tail (y=0) to the nose (y=8),
  // rotated so the axis lies along -z, then shifted so the tail sits at z=3.4
  // and the nose at z=-4.6. Cabin radius ~0.95 where the cockpit panel lives.
  const profile = [
    [0.02, 0], [0.30, 0.25], [0.50, 1.0], [0.75, 2.0], [0.90, 3.0],
    [0.95, 3.8], [0.95, 4.6], [0.92, 5.3], [0.85, 6.0], [0.78, 6.6],
    [0.70, 7.1], [0.45, 7.7], [0.12, 8.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fuselage = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), redSkin);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = 3.4;
  group.add(fuselage);

  // Cowling: a slightly wider short drum around the engine, with dark cooling
  // inlets on each side, plus the spinner up front.
  const cowling = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.86, 1.0, 14), red);
  cowling.rotation.x = Math.PI / 2;
  cowling.position.z = -3.9;
  group.add(cowling);
  for (const side of [-1, 1]) {
    const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.7), dark);
    inlet.position.set(side * 0.8, -0.15, -3.85);
    group.add(inlet);
    // Exhaust stubs under the cowling.
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6), dark);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * 0.42, -0.62, -3.7);
    group.add(exhaust);
  }
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 10), white);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -4.75;
  group.add(spinner);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.9, 0.75, 1.5);
  canopy.position.set(0, 0.55, -0.9);
  group.add(canopy);

  // Registration + titles on both sides of the fuselage, just off the skin.
  // z=0.0 is the fat part of the cabin (radius ~0.93), so a flat 1.2 m decal
  // sits within 3 cm of the skin along its whole length.
  for (const side of [-1, 1]) {
    const decal = textDecal(['PK-LNI', 'LANGIT NUSANTARA'], 1.2, 0.30);
    decal.position.set(side * 0.94, 0.05, 0.0);
    decal.rotation.y = side * Math.PI / 2;
    group.add(decal);
  }

  // Wing: red slab with white tips, flap + aileron separation lines on the
  // trailing edge, and struts to the fuselage. Stage F, second pass: the wing
  // sits HIGH (y 1.32, was 1.05) — a proper high-wing with a visible gap over
  // the cabin. At 1.05 its red front face filled the middle of the windshield
  // from the pilot's seat (the eye is at y 0.75, the wing's leading edge only
  // 0.30 above it), so the cockpit view was a red wall with almost no world in
  // it. Raised, the leading edge sits at the TOP of the windshield, the way a
  // real high-wing reads from the seat, and the horizon opens up below it.
  // Stage G: the wing is THINNER (0.20, was 0.28) and a touch higher (1.36),
  // and — the real fix — its UNDERSIDE is pale, not red: a real bush plane's
  // belly is light, and the red band the pilot saw was the wing's underside
  // and leading edge filling the top of the windshield. From the chase camera
  // the wing still reads red on top; from the seat it reads as a thin pale
  // strip. BoxGeometry takes a material per face: +x, -x, +y (top), -y
  // (underside), +z, -z.
  const wingUnderside = new THREE.MeshLambertMaterial({ color: PALETTE.planeWhite });
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(11.5, 0.20, 1.9),
    [red, red, red, wingUnderside, red, red],
  );
  wing.position.set(0, 1.36, -0.4);
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 1.9), white);
    tip.position.set(side * 5.45, 1.36, -0.4);
    group.add(tip);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 6), dark);
    strut.position.set(side * 2.2, 0.2, -0.4);
    strut.rotation.z = side * 0.5;
    group.add(strut);
    // Flap (inboard) and aileron (outboard) hinge lines on the trailing edge.
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 0.5), dark);
    flap.position.set(side * 1.6, 1.47, 0.42);
    group.add(flap);
    const aileron = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 0.5), dark);
    aileron.position.set(side * 3.9, 1.47, 0.42);
    group.add(aileron);
  }
  // Pitot tube under the left wing, landing light in the left leading edge.
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), metal);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(-2.6, 1.13, -1.0);
  group.add(pitot);
  const landingLight = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  );
  landingLight.position.set(-2.2, 1.31, -1.36);
  landingLight.rotation.x = -Math.PI / 2;
  group.add(landingLight);

  // Tail: tailplane, fin with a rudder hinge line and titles, white fin tip.
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.1), red);
  tailplane.position.set(0, 0.35, 3.1);
  group.add(tailplane);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 1.4), red);
  fin.position.set(0, 0.9, 3.1);
  group.add(fin);
  const rudderLine = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.5, 0.04), dark);
  rudderLine.position.set(0, 0.9, 3.72);
  group.add(rudderLine);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.4, 1.4), white);
  finTip.position.set(0, 1.65, 3.1);
  group.add(finTip);
  for (const side of [-1, 1]) {
    const decal = textDecal(['NUSANTARA'], 1.0, 0.25);
    decal.position.set(side * 0.13, 1.0, 3.1);
    decal.rotation.y = side * Math.PI / 2;
    group.add(decal);
  }

  // Navigation lights: red port, green starboard, white tail — plus a strobe
  // that blinks from the tail. Real aircraft, real positions.
  const navMat = (color) => new THREE.MeshBasicMaterial({ color });
  const navPort = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), navMat(0xff2a1a));
  navPort.position.set(-5.8, 1.36, -0.4);
  group.add(navPort);
  const navStarboard = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), navMat(0x2aff5a));
  navStarboard.position.set(5.8, 1.36, -0.4);
  group.add(navStarboard);
  const navTail = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), navMat(0xffffff));
  navTail.position.set(0, 0.4, 3.85);
  group.add(navTail);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), navMat(0xffffff));
  strobe.position.set(0, 1.9, 3.1);
  group.add(strobe);

  // Antenna mast on the cabin roof, behind the raised wing's trailing edge.
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.55, 6), dark);
  antenna.position.set(0, 1.25, 0.9);
  antenna.rotation.x = 0.25;
  group.add(antenna);

  // Propeller: a hub, two thin semi-transparent blades, and a blur disc with a
  // radial-gradient texture — faint in the middle, a soft ring at the rim — so it
  // reads as spinning air, not the grey circle with a black X Stage A showed.
  const prop = new THREE.Group();
  prop.position.set(0, 0, -4.85);
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 8), dark);
  hub.rotation.x = -Math.PI / 2;
  prop.add(hub);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x2a2c30, transparent: true, opacity: 0.55 });
  const bladeGeo = new THREE.BoxGeometry(0.18, 2.4, 0.08);
  const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
  prop.add(blade1);
  const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade2);
  const discCanvas = document.createElement('canvas');
  discCanvas.width = 128;
  discCanvas.height = 128;
  const dctx = discCanvas.getContext('2d');
  const dgrad = dctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  dgrad.addColorStop(0, 'rgba(225, 225, 225, 0.04)');
  dgrad.addColorStop(0.55, 'rgba(225, 225, 225, 0.10)');
  dgrad.addColorStop(0.85, 'rgba(230, 230, 230, 0.22)');
  dgrad.addColorStop(1, 'rgba(230, 230, 230, 0.05)');
  dctx.fillStyle = dgrad;
  dctx.fillRect(0, 0, 128, 128);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 24),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(discCanvas), transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  prop.add(disc);
  group.add(prop);

  // Fixed gear: faired legs, wheel pants over the mains, and a tail wheel.
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6), dark);
    leg.position.set(side * 0.9, -0.9, -0.6);
    leg.rotation.z = side * 0.25;
    group.add(leg);
    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.5), red);
    fairing.position.set(side * 0.9, -0.85, -0.6);
    fairing.rotation.z = side * 0.25;
    group.add(fairing);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.05, -1.55, -0.6);
    group.add(wheel);
    // Wheel pant: a flattened red shell over the top of the wheel.
    const pant = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), red);
    pant.scale.set(0.35, 0.75, 1.0);
    pant.position.set(side * 1.05, -1.45, -0.6);
    group.add(pant);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 8), dark);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 3.0);
  group.add(tailWheel);

  scene.add(group);

  // Stage G: the plane casts a REAL shadow now (sun + shadow map), so the blob
  // underneath is only a soft contact patch, not the shadow itself — and it is
  // SOFT, the way a real contact shadow is: a radial-gradient texture (opaque
  // in the middle, transparent at the rim) instead of a hard-edged black disc,
  // bigger (5.0 m) and fainter (0.20). The old disc was a uniform 0.28 black
  // circle with a razor edge — it read as a hole in the ground. Do NOT confuse
  // the two in the report: the blob is softened on purpose; the DIRECTIONAL
  // shadows (tree on grass, wing on fuselage, tower on shore) are the sharp
  // ones.
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = 128;
  blobCanvas.height = 128;
  const bctx = blobCanvas.getContext('2d');
  const bgrad = bctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  bgrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  bgrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.45)');
  bgrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  bctx.fillStyle = bgrad;
  bctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(5.0, 20),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(blobCanvas), transparent: true, opacity: 0.20, depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // Stage G: the plane is part of the real shadow system. Everything casts
  // except the parts that must not: the fuselage is a closed shell around the
  // cockpit — if it cast, the whole cabin would sit in its own shadow and the
  // pilot would fly in the dark; the canopy glass for the same reason; the prop
  // disc is a transparent blur (its shadow would be a solid disc); the decals
  // and the tiny nav lights are not worth a shadow texel. Everything receives,
  // so the wing's shadow falls on the fuselage top and the fuselage shades its
  // own belly. The cockpit group is added later by buildCockpit — it sets its
  // own flags there (only the glareshield and headliner cast).
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.receiveShadow = true;
    obj.castShadow = !obj.userData.noShadow;
  });
  fuselage.castShadow = false;
  canopy.castShadow = false;
  prop.children.forEach((child) => { child.castShadow = false; });
  return {
    group,
    prop,
    /** Place the plane from the flight state; the shadow follows the ground. */
    update(flight) {
      group.position.set(flight.x, flight.y, flight.z);
      group.rotation.order = 'YXZ';
      // Stage D: MINUS the heading. The flight moves in (sin h, 0, -cos h), but a
      // model yawed by +h points its nose at (-sin h, 0, -cos h) — verified in Node,
      // the nose dot the flight direction was 0.30 at h = 36° instead of 1.00. The
      // plane has been flying tail-first on every heading but due north/south since
      // Stage A: the chase camera saw the prop from the front, and the "banked"
      // look in the Island Hop frame was the nose pointing the wrong way, not a
      // bank at all (bank was 0.00 in the live state). Yaw -h puts the nose exactly
      // on the flight direction; pitch and roll are unchanged by the flip.
      group.rotation.y = -flight.heading;
      group.rotation.x = flight.pitch;
      group.rotation.z = -flight.bank;
      prop.rotation.z += flight.throttle * 0.02 + 0.12;
      // Strobe: a short double flash every 1.2 s, like a real anti-collision light.
      const phase = flight.elapsed % 1.2;
      strobe.visible = phase < 0.08 || (phase > 0.18 && phase < 0.26);
      const gy = groundAt(flight.x, flight.z);
      shadow.position.set(flight.x, gy + 0.25, flight.z);
      const alt = Math.max(0, flight.y - gy);
      const s = Math.max(0.4, 1 - alt / 220);
      shadow.scale.set(s, s, 1);
      shadow.material.opacity = 0.20 * s;
    },
  };
}
