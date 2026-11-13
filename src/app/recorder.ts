// The timeline: a rolling recording of everything the viewer can see, so an observer can scrub back and replay.
// It records render state only (poses, moving things, the mind's report and what the eyes were measuring). Reviewing
// the past pauses the live world; going back to live restores it exactly where it was.
import type { Simulation } from '../sim/simulation';
import type { CreaturePose } from '../body/motion';
import type { NodeInst } from '../world/nodes';
import type { MindReport, BodyState } from '../protocol/types';
import { clockAt, sunAt, windAt } from '../world/fields';
import { describe } from '../mind/language/innate';

/** One thing the eyes were measuring, compact enough to keep minutes of. */
export interface Measured {
  node: string;
  label: string;
  known: boolean; // it has its own word for this
  level: string; // detected / identified / detail
  angleDeg: number;
  distance: number;
  salience: number;
  part: boolean;
}

export interface Snap {
  t: number;
  creature: Float32Array;
  player: Float32Array;
  nodes: Float32Array; // per tracked node: x, y, z, heading, gait, flap, qx, qy, qz, qw
  removed: Set<string>;
  report: MindReport | null;
  bio: BodyState;
  measured: Measured[];
  named: { name: string; part: boolean }[];
}

const NODE_STRIDE = 10;

// ---------------------------------------------------------------- pose packing (≈110 floats per pose)

function packPose(p: CreaturePose): Float32Array {
  const a: number[] = [];
  const v = (q: { x: number; y: number; z: number }) => a.push(q.x, q.y, q.z);
  v(p.root); a.push(p.heading, p.bodyPitch, p.bodyRoll, p.crouch, p.breathe);
  v(p.head); a.push(p.headYaw, p.headPitch, p.gazeYaw, p.gazePitch);
  if (p.fixation) { a.push(1); v(p.fixation); } else a.push(0, 0, 0, 0);
  v(p.eyes[0]); v(p.eyes[1]);
  a.push(p.blink, p.pupil, p.squint);
  for (const arr of [p.hips, p.knees, p.feet]) for (let i = 0; i < 4; i++) v(arr[i] ?? p.root);
  for (let i = 0; i < 2; i++) a.push(p.ears[i].yaw, p.ears[i].pitch);
  for (let i = 0; i < 9; i++) v(p.tail[i] ?? p.root);
  a.push(p.tongue, p.jaw, p.earsFlat);
  return Float32Array.from(a);
}

/** Indices of angle fields, which interpolate the short way round. */
const ANGLES = new Set([3, 11, 13]);

function unpackPose(a: ArrayLike<number>, into: CreaturePose): CreaturePose {
  let k = 0;
  const v = () => ({ x: a[k++], y: a[k++], z: a[k++] });
  into.root = v(); into.heading = a[k++]; into.bodyPitch = a[k++]; into.bodyRoll = a[k++]; into.crouch = a[k++]; into.breathe = a[k++];
  into.head = v(); into.headYaw = a[k++]; into.headPitch = a[k++]; into.gazeYaw = a[k++]; into.gazePitch = a[k++];
  const hasFix = a[k++] > 0.5; const fx = v(); into.fixation = hasFix ? fx : null;
  into.eyes = [v(), v()];
  into.blink = a[k++]; into.pupil = a[k++]; into.squint = a[k++];
  into.hips = [v(), v(), v(), v()]; into.knees = [v(), v(), v(), v()]; into.feet = [v(), v(), v(), v()];
  into.ears = [{ yaw: a[k++], pitch: a[k++] }, { yaw: a[k++], pitch: a[k++] }];
  into.tail = Array.from({ length: 9 }, v);
  into.tongue = a[k++]; into.jaw = a[k++]; into.earsFlat = a[k++];
  return into;
}

function lerpArr(a: Float32Array, b: Float32Array, u: number, angles?: Set<number>): Float32Array {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let d = b[i] - a[i];
    if (angles?.has(i)) d = Math.atan2(Math.sin(d), Math.cos(d));
    o[i] = a[i] + d * u;
  }
  return o;
}

export class Recorder {
  readonly snaps: Snap[] = [];
  /** seconds of history kept */
  readonly keep = 8 * 60;
  private tracked: NodeInst[] = [];
  private trackedVersion = -1;
  private flaggable: NodeInst[] = [];
  private lastMeasuredSrc: unknown = null;
  private lastMeasured: Measured[] = [];
  private lastNamedCount = -1;
  private lastNamed: Snap['named'] = [];
  private nextAt = 0;
  /** the live state, saved at full precision when review starts, restored exactly when it ends */
  private live: (() => void) | null = null;
  reviewing = false;
  /** time being shown while reviewing */
  cursor = 0;

  constructor(private sim: Simulation, readonly hz = 20) {}

  private refreshTracked() {
    const w = this.sim.world;
    if (this.trackedVersion === w.nodes.version) return;
    this.trackedVersion = w.nodes.version;
    this.tracked = w.nodes.tops.filter((n) => n.motion === 'physics' || n.motion === 'agent');
    this.flaggable = [];
    const walk = (n: NodeInst) => { if (n.spec.key === 'berry' || n.spec.key === 'nut') this.flaggable.push(n); n.children.forEach(walk); };
    w.nodes.tops.forEach(walk);
  }

  /** What the eyes are measuring right now (cached per mind tick). */
  measured(): Measured[] {
    const m = this.sim.mind;
    if (m.percepts === this.lastMeasuredSrc) return this.lastMeasured;
    this.lastMeasuredSrc = m.percepts;
    this.lastMeasured = [...m.percepts]
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 14)
      .map((p) => ({
        node: p.node,
        label: p.c?.name ?? (p.props ? describe(p.props.looks, p.props.color, p.props.sizeWord, false) : 'something'),
        known: !!p.c?.name,
        level: p.level,
        angleDeg: p.angleDeg,
        distance: p.distance,
        salience: p.salience,
        part: !!p.parent,
      }));
    return this.lastMeasured;
  }

  private named(): Snap['named'] {
    const list = this.sim.mind.mem.named();
    if (list.length !== this.lastNamedCount) {
      this.lastNamedCount = list.length;
      this.lastNamed = list.map((c) => ({ name: c.name!, part: c.isPart }));
    }
    return this.lastNamed;
  }

  /** Capture the current world into a snapshot. */
  capture(): Snap {
    this.refreshTracked();
    const nodes = new Float32Array(this.tracked.length * NODE_STRIDE);
    this.tracked.forEach((n, i) => {
      const q = n.render.bodyRot;
      nodes.set([n.pos.x, n.pos.y, n.pos.z, n.heading, n.render.gait ?? 0, n.render.flap ?? 0, q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1], i * NODE_STRIDE);
    });
    const removed = new Set<string>();
    for (const n of this.flaggable) if (n.removed) removed.add(n.id);
    return {
      t: this.sim.world.t,
      creature: packPose(this.sim.creature.pose),
      player: packPose(this.sim.player.pose),
      nodes,
      removed,
      report: this.sim.lastReport,
      bio: { ...this.sim.creature.bio },
      measured: this.measured(),
      named: this.named(),
    };
  }

  /** Call every frame while live. */
  tick() {
    if (this.reviewing) return;
    const t = this.sim.world.t;
    if (t < this.nextAt) return;
    this.nextAt = t + 1 / this.hz;
    this.snaps.push(this.capture());
    while (this.snaps.length && this.snaps[0].t < t - this.keep) this.snaps.shift();
  }

  get start() { return this.snaps[0]?.t ?? 0; }
  get end() { return this.snaps[this.snaps.length - 1]?.t ?? 0; }

  /** Enter review at time t (pauses nothing by itself; the app stops stepping while reviewing). */
  seek(t: number) {
    if (!this.snaps.length) return;
    if (!this.reviewing) {
      this.live = this.saveLive();
      this.reviewing = true;
    }
    this.cursor = Math.max(this.start, Math.min(this.end, t));
    this.apply(this.at(this.cursor));
  }

  /** Back to the live world, exactly as it was. */
  goLive() {
    if (!this.reviewing || !this.live) return;
    this.live();
    this.live = null;
    this.reviewing = false;
  }

  /** Snapshot at time t, interpolated between recorded frames for smooth playback. */
  at(t: number): Snap {
    const s = this.snaps;
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid].t <= t) lo = mid; else hi = mid; }
    const a = s[lo], b = s[hi];
    if (!b || a === b || b.t - a.t < 1e-6 || t <= a.t) return a;
    if (t >= b.t) return b;
    const u = (t - a.t) / (b.t - a.t);
    return {
      ...(u < 0.5 ? a : b),
      t,
      creature: lerpArr(a.creature, b.creature, u, ANGLES),
      player: lerpArr(a.player, b.player, u, ANGLES),
      nodes: a.nodes.length === b.nodes.length ? lerpArr(a.nodes, b.nodes, u) : a.nodes,
    };
  }

  /** Save everything apply() touches, exactly; returns a function that puts it all back. */
  private saveLive(): () => void {
    const sim = this.sim, w = sim.world;
    this.refreshTracked();
    const cp = structuredClone(sim.creature.pose), pp = structuredClone(sim.player.pose);
    const nodes = this.tracked.map((n) => ({ n, pos: { ...n.pos }, heading: n.heading, gait: n.render.gait, flap: n.render.flap, rot: n.render.bodyRot ? { ...n.render.bodyRot } : undefined }));
    const flags = this.flaggable.map((n) => [n, n.removed] as const);
    const { t, clock, sun, wind } = w;
    return () => {
      Object.assign(sim.creature.pose, cp);
      Object.assign(sim.player.pose, pp);
      for (const s of nodes) {
        s.n.pos.x = s.pos.x; s.n.pos.y = s.pos.y; s.n.pos.z = s.pos.z;
        s.n.heading = s.heading; s.n.render.gait = s.gait; s.n.render.flap = s.flap;
        if (s.rot) s.n.render.bodyRot = s.rot;
      }
      for (const [n, r] of flags) n.removed = r;
      w.t = t; w.clock = clock; w.sun = sun; w.wind = wind;
    };
  }

  /** Put a snapshot into the objects the renderer reads. */
  private apply(s: Snap) {
    const sim = this.sim, w = sim.world;
    this.refreshTracked();
    unpackPose(s.creature, sim.creature.pose);
    unpackPose(s.player, sim.player.pose);
    if (s.nodes.length === this.tracked.length * NODE_STRIDE) {
      this.tracked.forEach((n, i) => {
        const k = i * NODE_STRIDE;
        n.pos.x = s.nodes[k]; n.pos.y = s.nodes[k + 1]; n.pos.z = s.nodes[k + 2];
        n.heading = s.nodes[k + 3];
        n.render.gait = s.nodes[k + 4];
        n.render.flap = s.nodes[k + 5];
        if (n.render.bodyRot) n.render.bodyRot = { x: s.nodes[k + 6], y: s.nodes[k + 7], z: s.nodes[k + 8], w: s.nodes[k + 9] };
      });
    }
    for (const n of this.flaggable) n.removed = s.removed.has(n.id);
    w.t = s.t;
    w.clock = clockAt(s.t);
    w.sun = sunAt(w.clock.hour);
    w.wind = windAt(s.t);
  }

  /** The snapshot being shown (review) or the latest (live). */
  current(): Snap | null {
    if (this.reviewing) return this.at(this.cursor);
    return this.snaps[this.snaps.length - 1] ?? null;
  }
}
