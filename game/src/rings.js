// The Ring Run course: 8 gold torus rings in the sky. A ring counts when the plane crosses
// its plane inside the hoop — flying past the edge does not count. Passed rings turn green;
// the next ring pulses so the pilot always knows where to look.
import * as THREE from '../vendor/three.module.min.js';
import { RING, PALETTE } from './config.js';
import { ringCourse } from './world.js';

export function buildRings(scene) {
  const course = ringCourse();
  const rings = [];
  course.forEach((p, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.ringGold, metalness: 0.75, roughness: 0.3, emissive: 0x332200,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(RING.radius, RING.tube, 12, 40), mat);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = Math.PI / 2; // hoop faces west, toward the incoming plane
    mesh.userData.baseEmissive = 0x332200;
    scene.add(mesh);
    rings.push({ ...p, mesh, mat, passed: false, prevSide: null });
  });
  return {
    rings,
    count: RING.count,
    points: RING.points,
    /** Index of the next ring to fly, or -1 when the course is done. */
    nextIndex() {
      for (let i = 0; i < rings.length; i += 1) if (!rings[i].passed) return i;
      return -1;
    },
    passedCount() {
      return rings.filter((r) => r.passed).length;
    },
    reset() {
      for (const r of rings) {
        r.passed = false;
        r.prevSide = null;
        r.mat.color.set(PALETTE.ringGold);
        r.mat.emissive.set(0x332200);
      }
    },
    /** Island Hop has no rings: hide the course so it never reads as the objective. */
    setVisible(v) {
      for (const r of rings) r.mesh.visible = v;
    },
    /**
     * Check the plane against every ring. Returns the indices passed this step.
     * A pass needs a plane crossing (sign change along the ring's normal) with the
     * plane inside the hoop's radius at the crossing.
     */
    check(flight) {
      const passed = [];
      for (let i = 0; i < rings.length; i += 1) {
        const r = rings[i];
        if (r.passed) continue;
        const side = flight.x - r.x; // rings face west: normal is +x
        if (r.prevSide !== null && Math.sign(side) !== Math.sign(r.prevSide) && r.prevSide < 0) {
          const dy = flight.y - r.y;
          const dz = flight.z - r.z;
          const radial = Math.sqrt(dy * dy + dz * dz);
          if (radial < RING.radius - 2) {
            r.passed = true;
            r.mat.color.set(PALETTE.ringDone);
            r.mat.emissive.set(0x0a3315);
            passed.push(i);
          }
        }
        r.prevSide = side;
      }
      return passed;
    },
    /** Pulse the next ring so it stands out; call every frame with elapsed time. */
    update(time) {
      const next = this.nextIndex();
      rings.forEach((r, i) => {
        const pulse = i === next ? 1 + 0.12 * Math.sin(time * 4) : 1;
        r.mesh.scale.set(pulse, pulse, pulse);
        if (i === next) r.mat.emissive.setHex(0x554400);
        else if (!r.passed) r.mat.emissive.setHex(0x332200);
      });
    },
  };
}
