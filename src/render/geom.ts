// Geometry builders: tapered tubes (branches, stalks, limbs, tails) that can be rebuilt in place every frame.
import * as THREE from 'three';
import type { V3 } from '../util/vec';

function catmull(p: V3[], t: number): THREE.Vector3 {
  const n = p.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, t * n));
  const i = Math.floor(f), u = f - i;
  const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[Math.min(n, i + 1)], p3 = p[Math.min(n, i + 2)];
  const u2 = u * u, u3 = u2 * u;
  const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
  return new THREE.Vector3(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}

function radiusAt(radii: number[], t: number): number {
  const n = radii.length - 1;
  const f = Math.min(n, Math.max(0, t * n));
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  return radii[i] * (1 - u) + radii[Math.min(n, i + 1)] * u;
}

/** A tube along a smooth curve through points, with radius interpolated along it. Updatable in place. */
export class Tube {
  readonly geometry: THREE.BufferGeometry;
  private pos: Float32Array;
  private nor: Float32Array;
  private closeStart: boolean;
  constructor(readonly rings: number, readonly sides: number, closeEnd = true, closeStart = false) {
    this.closeStart = closeStart;
    const vcount = (rings + 1) * (sides + 1) + (closeEnd ? 1 : 0) + (closeStart ? 1 : 0);
    this.pos = new Float32Array(vcount * 3);
    this.nor = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const idx: number[] = [];
    for (let r = 0; r <= rings; r++)
      for (let s = 0; s <= sides; s++) {
        uv[(r * (sides + 1) + s) * 2] = s / sides;
        uv[(r * (sides + 1) + s) * 2 + 1] = r / rings;
      }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < sides; s++) {
        const a = r * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    if (closeEnd) {
      const tip = (rings + 1) * (sides + 1);
      for (let s = 0; s < sides; s++) idx.push(rings * (sides + 1) + s, tip, rings * (sides + 1) + s + 1);
      uv[tip * 2] = 0.5;
      uv[tip * 2 + 1] = 1;
    }
    if (closeStart) {
      // a cap over the first ring, so a tube is a solid object you cannot look into
      const base = vcount - 1;
      for (let s = 0; s < sides; s++) idx.push(s + 1, base, s);
      uv[base * 2] = 0.5;
      uv[base * 2 + 1] = 0;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(idx);
  }

  update(points: V3[], radii: number[]) {
    const { rings, sides } = this;
    let prevN = new THREE.Vector3(), prevB = new THREE.Vector3();
    const centers: THREE.Vector3[] = [];
    for (let r = 0; r <= rings; r++) centers.push(catmull(points, r / rings));
    for (let r = 0; r <= rings; r++) {
      const c = centers[r];
      const T = centers[Math.min(rings, r + 1)].clone().sub(centers[Math.max(0, r - 1)]).normalize();
      if (r === 0) {
        const up = Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        prevN = new THREE.Vector3().crossVectors(T, up).normalize();
        prevB = new THREE.Vector3().crossVectors(T, prevN).normalize();
      } else {
        // parallel transport keeps the rings from twisting
        prevB = new THREE.Vector3().crossVectors(T, prevN).normalize();
        prevN = new THREE.Vector3().crossVectors(prevB, T).normalize();
      }
      const rad = radiusAt(radii, r / rings);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const nx = prevN.x * Math.cos(a) + prevB.x * Math.sin(a);
        const ny = prevN.y * Math.cos(a) + prevB.y * Math.sin(a);
        const nz = prevN.z * Math.cos(a) + prevB.z * Math.sin(a);
        const k = (r * (sides + 1) + s) * 3;
        this.pos[k] = c.x + nx * rad;
        this.pos[k + 1] = c.y + ny * rad;
        this.pos[k + 2] = c.z + nz * rad;
        this.nor[k] = nx;
        this.nor[k + 1] = ny;
        this.nor[k + 2] = nz;
      }
    }
    if (this.closeStart) {
      const k = this.pos.length - 3;
      const T = centers[1].clone().sub(centers[0]).normalize();
      const r0 = radiusAt(radii, 0);
      this.pos[k] = centers[0].x - T.x * r0 * 0.5;
      this.pos[k + 1] = centers[0].y - T.y * r0 * 0.5;
      this.pos[k + 2] = centers[0].z - T.z * r0 * 0.5;
      this.nor[k] = -T.x; this.nor[k + 1] = -T.y; this.nor[k + 2] = -T.z;
    }
    const tipK = (rings + 1) * (sides + 1) * 3;
    if (tipK < this.pos.length - (this.closeStart ? 3 : 0)) {
      const e = centers[rings], T = e.clone().sub(centers[rings - 1]).normalize();
      const rr = radiusAt(radii, 1);
      this.pos[tipK] = e.x + T.x * rr * 0.6;
      this.pos[tipK + 1] = e.y + T.y * rr * 0.6;
      this.pos[tipK + 2] = e.z + T.z * rr * 0.6;
      this.nor[tipK] = T.x; this.nor[tipK + 1] = T.y; this.nor[tipK + 2] = T.z;
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

export function staticTube(points: V3[], radii: number[], rings = 12, sides = 8): THREE.BufferGeometry {
  const t = new Tube(rings, sides, true, true);
  t.update(points, radii);
  return t.geometry;
}

/** A sphere pushed into a shape by a function of its unit direction. */
export function shapedSphere(wSeg: number, hSeg: number, f: (d: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const o = f(v);
    p.setXYZ(i, o.x, o.y, o.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A thin leaf blade, gently curved, base at the origin, pointing +y. */
export function leafGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 2, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + 0.5;
    p.setXYZ(i, x, y, -0.12 * Math.sin(y * Math.PI) - 0.15 * x * x);
  }
  g.computeVertexNormals();
  return g;
}
