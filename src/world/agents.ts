// Bug agents: small things with their own simple state. Their job is to be stimuli with consequences.
import type { World } from './world';
import type { NodeInst } from './nodes';
import { Rng } from '../util/rng';
import { v3, type V3 } from '../util/vec';
import { partSpec } from './nodes';

interface Ant { node: NodeInst; s: number; speed: number; pause: number; wobble: number }

export class AntColony {
  ants: Ant[] = [];
  constructor(private world: World, readonly nest: V3, private rng: Rng, count = 7) {
    const spec = world.spec('ant');
    for (let i = 0; i < count; i++) {
      const s = i / count;
      const node = world.nodes.create(spec, 'ant', null, this.trail(s), 0.006, { motion: 'agent', phase: rng.next() });
      const head = world.nodes.create(partSpec(spec, 'head'), 'ant', node, node.pos, 0.0016, { motion: 'attached', local: v3(0, 0.0012, 0.0028) });
      for (const side of [-1, 1])
        world.nodes.create(partSpec(spec, 'antenna'), 'ant', head, node.pos, 0.0025, { motion: 'attached', local: v3(side * 0.0008, 0.002, 0.0042) });
      const legSpec = partSpec(spec, 'leg');
      for (let k = 0; k < 6; k++) {
        const side = k < 3 ? -1 : 1;
        const z = ((k % 3) - 1) * 0.0016;
        const leg = world.nodes.create(legSpec, 'ant', node, node.pos, 0.0026, { motion: 'attached', local: v3(side * 0.0022, 0.0006, z), phase: k / 6 });
        world.nodes.create(partSpec(legSpec, 'hair'), 'ant', leg, leg.pos, 0.0022, { motion: 'attached', local: v3(0, 0, 0) });
      }
      this.ants.push({ node, s, speed: rng.range(0.016, 0.026), pause: 0, wobble: rng.range(0, 10) });
    }
  }

  /** The trail is a lumpy loop between the nest and the berry bush. */
  trail(s: number): V3 {
    const a = s * Math.PI * 2;
    const r = 0.45 + 0.12 * Math.sin(3 * a) + 0.05 * Math.sin(7 * a);
    const x = this.nest.x + Math.cos(a) * r * 1.4;
    const z = this.nest.z + Math.sin(a) * r;
    return { x, y: this.world.groundY(x, z) + 0.0016, z };
  }

  update(dt: number) {
    const L = 2.6; // approx loop length, metres
    for (const a of this.ants) {
      if (a.pause > 0) { a.pause -= dt; a.node.vel = v3(); continue; }
      if (this.rng.chance(dt * 0.08)) a.pause = this.rng.range(0.5, 2.5);
      a.wobble += dt;
      a.s = (a.s + (a.speed * dt) / L) % 1;
      const p = this.trail(a.s);
      const side = Math.sin(a.wobble * 5.3) * 0.006;
      const ahead = this.trail((a.s + 0.003) % 1);
      const heading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      p.x += Math.cos(heading) * side;
      p.z -= Math.sin(heading) * side;
      p.y = this.world.groundY(p.x, p.z) + 0.0016;
      const n = a.node;
      n.vel = { x: (p.x - n.pos.x) / dt, y: (p.y - n.pos.y) / dt, z: (p.z - n.pos.z) / dt };
      n.pos = p;
      n.heading = heading;
      n.render.gait = (n.render.gait ?? 0) + dt * a.speed * 900;
      this.world.syncAttached(n);
    }
  }
}

interface Fly { node: NodeInst; target: NodeInst | null; rest: number; t: number }

export class Butterflies {
  flies: Fly[] = [];
  constructor(private world: World, private rng: Rng, count = 2) {
    const spec = world.spec('butterfly');
    for (let i = 0; i < count; i++) {
      const p = { x: rng.range(-2, 2), y: 0.4, z: rng.range(-1, 3) };
      const node = world.nodes.create(spec, 'butterfly', null, p, 0.05, { motion: 'agent', phase: rng.next() });
      for (const side of [-1, 1]) {
        const w = world.nodes.create(partSpec(spec, 'wings'), 'butterfly', node, p, 0.03, { motion: 'attached', local: v3(side * 0.014, 0, 0) });
        world.nodes.create(partSpec(partSpec(spec, 'wings'), 'spots'), 'butterfly', w, p, 0.008, { motion: 'attached', local: v3(side * 0.006, 0.001, -0.004) });
      }
      world.nodes.create(partSpec(spec, 'body'), 'butterfly', node, p, 0.022, { motion: 'attached', local: v3(0, 0, 0) });
      this.flies.push({ node, target: null, rest: 0, t: rng.range(0, 10) });
    }
  }

  update(dt: number) {
    const flowers = this.world.nodes.tops.filter((n) => n.entity === 'flower');
    for (const f of this.flies) {
      f.t += dt;
      const n = f.node;
      if (!f.target) f.target = this.rng.pick(flowers);
      const petals = f.target.children.find((c) => c.spec.key === 'petals')!;
      const goal = { x: petals.pos.x, y: petals.pos.y + 0.012, z: petals.pos.z };
      const dx = goal.x - n.pos.x, dy = goal.y - n.pos.y, dz = goal.z - n.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (f.rest > 0) {
        f.rest -= dt;
        n.vel = v3();
        n.render.flap = (n.render.flap ?? 0) + dt * 2.5;
        if (f.rest <= 0) f.target = this.rng.pick(flowers);
      } else if (d < 0.02) {
        f.rest = this.rng.range(3, 9);
      } else {
        const sp = 0.35 + 0.15 * Math.sin(f.t * 1.3);
        const bob = Math.sin(f.t * 9) * 0.25;
        const swirl = Math.sin(f.t * 0.7 + n.phase * 6) * 0.4;
        const vx = (dx / d) * sp + Math.cos(f.t * 1.1) * swirl * 0.3;
        const vz = (dz / d) * sp + Math.sin(f.t * 1.1) * swirl * 0.3;
        const lift = d > 0.4 ? Math.max(0, 0.35 - (n.pos.y - this.world.groundY(n.pos.x, n.pos.z))) : 0;
        const vy = (dy / d) * sp + bob + lift;
        n.vel = { x: vx, y: vy, z: vz };
        n.pos = { x: n.pos.x + vx * dt, y: n.pos.y + vy * dt, z: n.pos.z + vz * dt };
        n.heading = Math.atan2(vx, vz);
        n.render.flap = (n.render.flap ?? 0) + dt * 9;
      }
      this.world.syncAttached(n);
    }
  }
}
