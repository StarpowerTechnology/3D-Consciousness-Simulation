// The player creature (blueprint 3.6): a physical body you control. You talk, smell and move as a thing in the world.
import type { World } from '../world/world';
import type { NodeInst } from '../world/nodes';
import { Motion, CREATURE_DIMS, scaledDims, type CreaturePose } from './motion';
import { angDiff, clamp, dist, DEG, rotY, type V3 } from '../util/vec';

export interface PlayerInput {
  forward: number; // −1..1
  right: number;
  run: boolean;
  jump: boolean;
  yaw: number; // camera yaw, radians
  pitch: number;
}

export const PLAYER_SCALE = 2.6;

export class PlayerBody {
  readonly node: NodeInst;
  readonly handle: number;
  readonly motion: Motion;
  pose: CreaturePose;
  heading = Math.PI; // face the clearing
  input: PlayerInput = { forward: 0, right: 0, run: false, jump: false, yaw: Math.PI, pitch: 0 };
  carrying: NodeInst | null = null;
  private grounded = true;
  private lookTarget: V3 | null = null;

  constructor(private world: World) {
    this.node = world.nodes.tops.find((n) => n.entity === 'visitor')!;
    const d = scaledDims(CREATURE_DIMS, PLAYER_SCALE);
    const p = { x: this.node.pos.x, y: world.groundY(this.node.pos.x, this.node.pos.z) + d.bodyHeight + 0.02, z: this.node.pos.z };
    this.handle = world.physics.addCharacter(this.node.id, p, 0.075, 0.0, 2.5, world.material('fur'));
    this.node.body = this.handle;
    this.node.heading = this.heading;
    this.motion = new Motion(d, world.rng.fork(99), p, this.heading);
    this.pose = this.motion.pose;
    world.controllers.push((dt) => this.control(dt));
  }

  get pos(): V3 { return this.world.physics.pos(this.handle); }

  private control(dt: number) {
    const w = this.world;
    const inp = this.input;
    const v = w.physics.vel(this.handle);
    const p = this.pos;
    const sp = inp.run ? 1.6 : 0.6;
    const f = rotY({ x: 0, y: 0, z: 1 }, inp.yaw), r = rotY({ x: -1, y: 0, z: 0 }, inp.yaw);
    let dx = f.x * inp.forward + r.x * inp.right, dz = f.z * inp.forward + r.z * inp.right;
    const l = Math.hypot(dx, dz);
    if (l > 1) { dx /= l; dz /= l; }
    const acc = 6 * dt;
    const nvx = v.x + clamp(dx * sp - v.x, -acc, acc), nvz = v.z + clamp(dz * sp - v.z, -acc, acc);
    const g = w.groundY(p.x, p.z);
    this.grounded = p.y - g < 0.11;
    let vy = v.y;
    if (inp.jump && this.grounded) { vy = 2.2; inp.jump = false; }
    w.physics.setVel(this.handle, { x: nvx, y: vy, z: nvz });
    const spd = Math.hypot(v.x, v.z);
    if (spd > 0.05) this.heading += clamp(angDiff(Math.atan2(v.x, v.z), this.heading), -6 * dt, 6 * dt);
    else if (Math.abs(angDiff(inp.yaw, this.heading)) > 70 * DEG) this.heading += clamp(angDiff(inp.yaw, this.heading), -3 * dt, 3 * dt);
    this.node.heading = this.heading;

    // carry: the object rides at the mouth
    if (this.carrying && this.carrying.body !== undefined) {
      const m = this.mouth();
      w.physics.setPos(this.carrying.body, m);
    }

    const look = { x: p.x + Math.sin(inp.yaw) * Math.cos(inp.pitch) * 3, y: p.y + 0.12 + Math.sin(inp.pitch) * 3, z: p.z + Math.cos(inp.yaw) * Math.cos(inp.pitch) * 3 };
    this.lookTarget = look;
    this.pose = this.motion.update(dt, {
      root: p, vel: v, heading: this.heading, gazeTarget: look, gazeMode: 'pursue',
      crouch: 0, headDown: 0, earsFlat: 0, tailUp: 0.5, arousal: 0.2, light: w.lightAt(p), pupilHint: 0, squint: 0,
      tongue: 0, jaw: this.speakingUntil > w.t ? Math.abs(Math.sin(w.t * 16)) * 0.6 : 0, sleeping: false, ground: (x, z) => w.groundY(x, z),
    });
  }

  private speakingUntil = 0;

  mouth(): V3 {
    const h = this.pose.head;
    return { x: h.x + Math.sin(this.heading) * 0.07, y: h.y - 0.02, z: h.z + Math.cos(this.heading) * 0.07 };
  }

  say(text: string) {
    const w = this.world;
    w.emitSound(this.pose.head, [0.45, 0.6, 0.1, 0.6, 0.6, 0.5], 0.6, 0.8 + text.length * 0.05, this.node.id, { text, speaker: this.node.id });
    this.speakingUntil = w.t + 0.4 + text.split(/\s+/).length * 0.3;
  }

  /** Pick up the nearest small loose thing, or drop what is carried. */
  toggleCarry(): string {
    const w = this.world;
    if (this.carrying) {
      const n = this.carrying;
      this.carrying = null;
      return `dropped ${n.id}`;
    }
    const m = this.mouth();
    let best: NodeInst | null = null, bd = 0.35;
    for (const n of w.nodes.tops) {
      if (n.body === undefined || n.removed || n === this.node || (n.entity !== 'nut' && n.entity !== 'leaf')) continue;
      const d = dist(n.pos, m);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) { this.carrying = best; return `picked up ${best.id}`; }
    return 'nothing small enough nearby';
  }

  throwCarried() {
    if (!this.carrying || this.carrying.body === undefined) return;
    const n = this.carrying;
    this.carrying = null;
    const f = { x: Math.sin(this.input.yaw) * Math.cos(this.input.pitch), y: Math.sin(this.input.pitch) + 0.35, z: Math.cos(this.input.yaw) * Math.cos(this.input.pitch) };
    const m = this.world.physics.mass(n.body!);
    this.world.physics.impulse(n.body!, { x: f.x * m * 3.5, y: f.y * m * 3.5, z: f.z * m * 3.5 });
  }
}
