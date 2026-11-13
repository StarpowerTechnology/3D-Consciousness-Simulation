// The cartoon look: soft clay-like materials with a gentle rim light, saturated colour, rounded solid shapes.
// Everything here is render-only; the world and the senses never see it.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, Rng } from '../util/rng';

export interface ClayOpts {
  roughness?: number;
  rim?: number; // strength of the soft rim light that rounds silhouettes
  vertexColors?: boolean;
  side?: THREE.Side;
  /** darken toward the bottom of the object (fake ambient occlusion), in object-space units */
  aoHeight?: number;
  clearcoat?: number;
}

/**
 * A soft clay material: smooth, saturated, lit like a stop-motion figure. The rim term brightens edges facing
 * away from the camera so rounded shapes read as solid volumes even in flat light.
 */
export function clay(color: THREE.ColorRepresentation, o: ClayOpts = {}): THREE.MeshStandardMaterial {
  const m = o.clearcoat
    ? new THREE.MeshPhysicalMaterial({ color, roughness: o.roughness ?? 0.5, clearcoat: o.clearcoat, clearcoatRoughness: 0.25 })
    : new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.55 });
  m.metalness = 0;
  m.vertexColors = !!o.vertexColors;
  m.side = o.side ?? THREE.FrontSide;
  const rim = o.rim ?? 0.35;
  const ao = o.aoHeight ?? 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uAo = { value: ao };
    sh.vertexShader = 'varying float vObjY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObjY = position.y;');
    sh.fragmentShader = 'uniform float uRim; uniform float uAo; varying float vObjY;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uAo > 0.0) diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, uAo, vObjY));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += diffuseColor.rgb * fres * uRim;`);
  };
  m.customProgramCacheKey = () => `clay-${rim}-${ao}-${!!o.vertexColors}-${m.side}`;
  return m;
}

/** A lumpy, smooth blob: an icosphere pushed by low-frequency noise, flattened underneath. */
export function puff(radius: number, seed: number, detail = 3, flatBottom = 0.35): THREE.BufferGeometry {
  // weld the icosphere so normals are shared and the blob shades smooth, not faceted
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const o = (seed % 97) * 1.37;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = fbm2(v.x * 1.6 + o, v.z * 1.6 + v.y * 1.3 - o, 3, seed % 31);
    let r = 1 + 0.22 * n;
    if (v.y < -flatBottom) r *= 1 - (Math.abs(v.y) - flatBottom) * 0.6;
    p.setXYZ(i, v.x * r * radius, v.y * r * radius * 0.86, v.z * r * radius);
  }
  g.computeVertexNormals();
  return g;
}

/** Paint a geometry with one colour, lighter on top and darker underneath, for merging into vertex-coloured meshes. */
export function paint(g: THREE.BufferGeometry, color: THREE.Color, topBoost = 0.18, bottomDark = 0.35, center = 0): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - bb.min.y) / h - center;
    const k = 1 - bottomDark + (bottomDark + topBoost) * Math.max(0, Math.min(1, t));
    col[i * 3] = color.r * k;
    col[i * 3 + 1] = color.g * k;
    col[i * 3 + 2] = color.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Merge geometries that may differ in which attributes they carry (keeps position, normal, color). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', n.attributes.position);
    out.setAttribute('normal', n.attributes.normal);
    if (n.attributes.color) out.setAttribute('color', n.attributes.color);
    else {
      const c = new Float32Array(n.attributes.position.count * 3).fill(1);
      out.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    return out;
  });
  return mergeGeometries(clean, false)!;
}

/** A rounded petal: a flattened, slightly cupped capsule, base at the origin, pointing +x. */
export function petalGeometry(len: number, width: number, thick: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.5, 1, 6, 12);
  g.rotateZ(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 1; // 0 .. 2
    const u = x / 2;
    const w = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5 + 0.2) * (1 - Math.max(0, u - 0.82) * 1.4);
    p.setXYZ(i, u * len, p.getY(i) * thick + u * u * thick * 1.2, p.getZ(i) * width * Math.max(0.25, w));
  }
  g.computeVertexNormals();
  return g;
}

/** Deterministic colour jitter in HSL. */
export function jitter(base: THREE.Color, r: Rng, dh = 0.02, ds = 0.08, dl = 0.06): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL((hsl.h + r.range(-dh, dh) + 1) % 1, Math.min(1, Math.max(0, hsl.s + r.range(-ds, ds))), Math.min(1, Math.max(0, hsl.l + r.range(-dl, dl))));
}

export const PALETTE = {
  trunk: new THREE.Color('#6a4024'),
  trunkDark: new THREE.Color('#57331c'),
  foliage: [new THREE.Color('#4fae3c'), new THREE.Color('#62bf45'), new THREE.Color('#3f9a39'), new THREE.Color('#79c94e')],
  bush: new THREE.Color('#3f9e47'),
  grassLow: new THREE.Color('#2f7a2a'),
  grassHigh: new THREE.Color('#86c24f'),
  groundGrass: new THREE.Color('#5f9a3c'),
  groundDirt: new THREE.Color('#c79a63'),
  groundMud: new THREE.Color('#7b5a3c'),
  groundSand: new THREE.Color('#e8cf93'),
  petals: [new THREE.Color('#9b83e6'), new THREE.Color('#e57bb4'), new THREE.Color('#f2c84b'), new THREE.Color('#7fb4f0'), new THREE.Color('#f08a5d')],
  flowerFace: new THREE.Color('#e7e3a6'),
  stalk: new THREE.Color('#5fbf4a'),
  capRed: new THREE.Color('#d8382f'),
  capSpot: new THREE.Color('#fbf3e4'),
  stem: new THREE.Color('#f1e7d2'),
  rock: new THREE.Color('#9aa3ab'),
  moss: new THREE.Color('#6fae45'),
  log: new THREE.Color('#9b6a42'),
  berry: new THREE.Color('#e3263a'),
  nut: new THREE.Color('#a8682f'),
};
