// The red bush plane, built from primitives — no photo assets, no downloads.
// High-wing, red fuselage, glass canopy, spinning prop blur disc, tail, fixed gear,
// and a soft blob shadow that follows the ground so landings read.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { groundAt } from './world.js';

export function buildPlane(scene) {
  // A whisper of emissive on the red so the plane never reads as a black silhouette
  // when the sun is behind the camera's subject (Stage B's landing frame): the red
  // stays red even on its shadow side.
  const red = new THREE.MeshLambertMaterial({ color: PALETTE.planeRed, emissive: 0x2e0a06 });
  const white = new THREE.MeshLambertMaterial({ color: PALETTE.planeWhite });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const glass = new THREE.MeshPhongMaterial({
    color: 0x9fd8e8, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.75,
  });
  const group = new THREE.Group();

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.55, 6.4, 10), red);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.4, 10), red);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.9;
  group.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.9, 0.75, 1.5);
  canopy.position.set(0, 0.55, -0.9);
  group.add(canopy);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.28, 1.9), red);
  wing.position.set(0, 1.05, -0.4);
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 1.9), white);
    tip.position.set(side * 5.45, 1.05, -0.4);
    group.add(tip);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), dark);
    strut.position.set(side * 2.2, 0.1, -0.4);
    strut.rotation.z = side * 0.5;
    group.add(strut);
  }
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.1), red);
  tailplane.position.set(0, 0.35, 3.1);
  group.add(tailplane);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 1.4), red);
  fin.position.set(0, 0.9, 3.1);
  group.add(fin);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.4, 1.4), white);
  finTip.position.set(0, 1.65, 3.1);
  group.add(finTip);

  // Propeller: a hub, two thin semi-transparent blades, and a blur disc with a
  // radial-gradient texture — faint in the middle, a soft ring at the rim — so it
  // reads as spinning air, not the grey circle with a black X Stage A showed.
  const prop = new THREE.Group();
  prop.position.set(0, 0, -4.7);
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

  // Fixed gear: two mains and a tail wheel.
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 6), dark);
    leg.position.set(side * 0.9, -0.9, -0.6);
    leg.rotation.z = side * 0.25;
    group.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.05, -1.55, -0.6);
    group.add(wheel);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 8), dark);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 3.0);
  group.add(tailWheel);

  scene.add(group);

  // Soft blob shadow on the ground below the plane.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

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
      const gy = groundAt(flight.x, flight.z);
      shadow.position.set(flight.x, gy + 0.25, flight.z);
      const alt = Math.max(0, flight.y - gy);
      const s = Math.max(0.4, 1 - alt / 220);
      shadow.scale.set(s, s, 1);
      shadow.material.opacity = 0.28 * s;
    },
  };
}
