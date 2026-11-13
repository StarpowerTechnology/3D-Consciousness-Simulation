// L4 VISION (blueprint 5.1): what is seen and how well. Queries the world; delivers only resolved properties.
import type { World } from '../world/world';
import type { NodeInst } from '../world/nodes';
import type { VisualPercept, ResolveLevel } from '../protocol/types';
import { perceptEmbedding } from './embedding';
import { angDiff, angleBetween, DEG, dot, norm, scale, sub, yawPitchFromDir, type V3 } from '../util/vec';
import type { Rng } from '../util/rng';

export interface EyeState {
  eye: V3; // cyclopean eye position
  eyeVel: V3;
  headDir: V3; // where the head points (field of view centre)
  gazeDir: V3; // where the eyes point (acuity centre)
  heading: number; // body heading (radians)
  selfBody: number; // physics body to exclude from occlusion rays
}

export const VISION = {
  halfFovH: 70,
  halfFovV: 50,
  acuityHalf: 2.5,
  detect: 0.3,
  identify: 2.0,
  maxPercepts: 70,
};

const CONTRAST: Record<string, number> = { grass: 0.55, ant: 0.9, leaf: 0.85, pond: 0.9 };

interface Ctx { w: World; s: EyeState; rng: Rng; out: VisualPercept[]; prevAngle: Map<string, number>; dt: number }

export class Vision {
  private prevAngle = new Map<string, number>();

  see(w: World, s: EyeState, rng: Rng, dt: number): VisualPercept[] {
    const ctx: Ctx = { w, s, rng, out: [], prevAngle: this.prevAngle, dt };
    const headYP = yawPitchFromDir(s.headDir);
    for (const top of w.nodes.tops) {
      if (top.removed) continue;
      consider(ctx, top, null, headYP);
    }
    const next = new Map<string, number>();
    for (const p of ctx.out) next.set(p.node, p.angleDeg);
    this.prevAngle = next;
    ctx.out.sort((a, b) => b.angleDeg / (1 + b.offCenterDeg / VISION.acuityHalf) - a.angleDeg / (1 + a.offCenterDeg / VISION.acuityHalf));
    return ctx.out.slice(0, VISION.maxPercepts);
  }
}

function consider(ctx: Ctx, n: NodeInst, parent: VisualPercept | null, headYP: { yaw: number; pitch: number }) {
  const { w, s } = ctx;
  const to = sub(n.pos, s.eye);
  const d = Math.hypot(to.x, to.y, to.z);
  if (d < 0.004) return;
  const dir = scale(to, 1 / d);
  const yp = yawPitchFromDir(dir);
  const angle = (2 * Math.atan(n.size / (2 * d))) / DEG;
  // a big thing is in view if any of it is, not just its centre
  const halfA = angle / 2;
  if (Math.abs(angDiff(yp.yaw, headYP.yaw)) / DEG > VISION.halfFovH + halfA || Math.abs(yp.pitch - headYP.pitch) / DEG > VISION.halfFovV + halfA) return;

  const off = angleBetween(s.gazeDir, dir) / DEG;
  const acuity = 1 / (1 + off / VISION.acuityHalf);
  const light = w.lightAt(n.pos);
  const contrast = CONTRAST[n.spec.key] ?? 1;
  const eff = angle * acuity * Math.sqrt(light) * contrast;

  const needed = parent ? n.spec.needs.angle : VISION.detect;
  if (eff < needed) return;

  if (!parent) {
    // occlusion: a ray from the eye to the thing. Anything solid in between that isn't the thing hides it.
    const aim = { x: n.pos.x, y: n.pos.y + n.size * 0.15, z: n.pos.z };
    const hit = w.raycast(s.eye, aim, s.selfBody);
    if (hit) {
      const hitNode = w.nodes.get(hit.node);
      const self = hitNode && hitNode.top === n;
      const dAim = Math.hypot(aim.x - s.eye.x, aim.y - s.eye.y, aim.z - s.eye.z);
      if (!self && hit.dist < dAim - n.size * 0.6) return;
    }
  }

  const identifyAt = parent ? Math.max(VISION.identify, n.spec.needs.angle) : VISION.identify;
  let level: ResolveLevel = eff >= identifyAt ? 'identified' : 'detected';
  if (parent) level = 'identified';
  if (eff >= identifyAt * 2.5) level = 'detail';

  // motion relative to the eye
  const vrel = sub(n.vel, s.eyeVel);
  const radial = dot(vrel, dir);
  const tang = Math.hypot(vrel.x - dir.x * radial, vrel.y - dir.y * radial, vrel.z - dir.z * radial);
  const speedDps = ((tang / d) / DEG);
  // looming: the thing itself coming at the eye. Growth caused by the creature's own approach is discounted,
  // the way animals discount optic flow from their own movement.
  const ownRadial = dot(n.vel, dir);
  const loomingDps = Math.max(0, (-ownRadial / d) * angle);
  void ctx.prevAngle;
  const resolution = Math.min(1, Math.max(0, (eff - VISION.detect) / 6));

  const p: VisualPercept = {
    node: n.id,
    parent: parent?.node,
    level,
    angleDeg: angle,
    offCenterDeg: off,
    bearingDeg: angDiff(yp.yaw, s.heading) / DEG,
    elevationDeg: yp.pitch / DEG,
    distance: d * (1 + ctx.rng.gauss() * 0.04 * (1 - resolution)),
    light,
    speedDps,
    loomingDps,
    falling: n.vel.y < -0.9,
    selfMoving: n.motion === 'agent',
    margin: eff / needed,
    needDwell: n.spec.needs.dwell_s,
    embedding: [],
  };

  if (level !== 'detected') {
    const sizeWord = n.size > 1.5 ? 'big' : n.size < 0.02 ? 'tiny' : n.size < 0.08 ? 'lil' : undefined;
    p.props = { looks: n.spec.looks, sizeWord };
    if (light > 0.2) p.props.color = n.spec.attrs.color;
    if (eff > 4 || parent) p.props.texture = n.spec.attrs.texture;
    const coarse = n.spec.coarse_words && eff < n.spec.full_angle ? n.spec.coarse_words : null;
    p.words = coarse ?? n.spec.words;
    if (n.spec.relation) {
      const rt = n.spec.relation.to;
      const to = rt === 'ground' ? 'ground' : rt === 'parent' ? parent?.node : siblingId(n, rt) ?? parent?.node;
      if (to) p.relation = { type: n.spec.relation.type, to };
    }
  }

  const before = ctx.out.length;
  ctx.out.push(p);
  // descend into parts only when the whole is identified: the fractal structure is also the culling structure
  const partEmbs: number[][] = [];
  if (level !== 'detected') {
    for (const c of n.children) {
      if (c.removed) continue;
      consider(ctx, c, p, headYP);
    }
    for (let i = before + 1; i < ctx.out.length; i++) if (ctx.out[i].parent === p.node) partEmbs.push(ctx.out[i].embedding);
  }
  const motion = {
    speed: speedDps,
    flutter: n.motion === 'flutter' || n.motion === 'sway' ? 1 : 0,
    selfMoving: p.selfMoving ? 1 : 0,
    falling: p.falling ? 1 : 0,
  };
  p.embedding = perceptEmbedding(n.spec, n.size, level === 'detected' ? resolution * 0.3 : resolution, motion, light, ctx.rng, partEmbs);
}

function siblingId(n: NodeInst, key: string): string | undefined {
  // relation targets like 'stem' or 'trunk' refer to a sibling part, or to a part of an ancestor
  let p = n.parent;
  while (p) {
    const s = p.children.find((c) => c.spec.key === key);
    if (s) return s.id;
    if (p.spec.key === key) return p.id;
    p = p.parent;
  }
  return undefined;
}

export { norm };
