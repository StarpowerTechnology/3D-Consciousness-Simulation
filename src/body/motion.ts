// L2 MOTION (blueprint 14.3, 14.4): turns motor targets into a pose. This is the layer the high-quality
// version replaces. It outputs plain data (CreaturePose); the renderer draws it, the senses read eye geometry from it.
import { angDiff, clamp, DEG, dirFromYawPitch, lerp, rotY, smoothstep, type V3 } from '../util/vec';
import type { Rng } from '../util/rng';

export interface RigDims {
  scale: number;
  bodyHeight: number; // body centre above ground
  headFwd: number;
  headUp: number;
  eyeFwd: number;
  eyeUp: number;
  eyeSide: number;
  hipSide: number;
  hipFront: number;
  hipRear: number;
  hipDown: number;
  legUpper: number;
  legLower: number;
  stride: number;
  tailLen: number;
  tailBase: number;
}

export const CREATURE_DIMS: RigDims = {
  scale: 1, bodyHeight: 0.036, headFwd: 0.05, headUp: 0.022, eyeFwd: 0.012, eyeUp: 0.006, eyeSide: 0.009,
  hipSide: 0.0145, hipFront: 0.028, hipRear: -0.026, hipDown: 0.004, legUpper: 0.019, legLower: 0.02, stride: 0.05,
  tailLen: 0.085, tailBase: -0.05,
};

export function scaledDims(d: RigDims, s: number): RigDims {
  const o: any = { ...d };
  for (const k of Object.keys(o)) if (k !== 'scale') o[k] *= s;
  o.scale = s;
  return o as RigDims;
}

export interface CreaturePose {
  root: V3;
  heading: number;
  bodyPitch: number;
  bodyRoll: number;
  crouch: number;
  breathe: number;
  head: V3;
  headYaw: number; // world
  headPitch: number;
  gazeYaw: number; // world, cyclopean
  gazePitch: number;
  fixation: V3 | null; // what both eyes converge on
  eyes: [V3, V3]; // world positions of the two eyes
  blink: number; // 0 open .. 1 closed
  pupil: number;
  squint: number;
  hips: V3[];
  knees: V3[];
  feet: V3[];
  ears: { yaw: number; pitch: number }[];
  tail: V3[];
  tongue: number;
  jaw: number;
  earsFlat: number;
}

export interface MotionInput {
  root: V3; // physics body centre
  vel: V3;
  heading: number;
  gazeTarget: V3 | null; // world point to look at
  gazeMode: 'scan' | 'fixate' | 'pursue';
  scanYaw?: number; // world yaw/pitch for scan saccades with no target
  scanPitch?: number;
  crouch: number;
  headDown: number;
  earsBearing?: number; // radians relative to heading
  earsFlat: number;
  tailUp: number;
  arousal: number;
  light: number;
  pupilHint: number;
  squint: number;
  tongue: number;
  jaw: number;
  sleeping: boolean;
  ground: (x: number, z: number) => number;
}

interface Saccade { t: number; dur: number; y0: number; p0: number; y1: number; p1: number }

export class Motion {
  pose: CreaturePose;
  private sacc: Saccade | null = null;
  private gYaw = 0;
  private gPitch = -0.1;
  private hYaw = 0;
  private hPitch = -0.05;
  private hYawVel = 0;
  private hPitchVel = 0;
  private headLagT = 0;
  private nextMicro = 0.6;
  private nextBlink = 2;
  private blinkT = -1;
  private gaitPhase = 0;
  private planted: { pos: V3; swing: number; from: V3 }[] = [];
  private tailPts: V3[] = [];
  private tailPrev: V3[] = [];
  private earYaw = [0, 0];
  private earVel = [0, 0];
  private t = 0;
  private lastTarget: V3 | null = null;

  constructor(readonly d: RigDims, private rng: Rng, root: V3, heading: number) {
    this.gYaw = this.hYaw = heading;
    this.pose = this.emptyPose(root, heading);
    for (let i = 0; i < 4; i++) {
      const h = this.hipWorld(i, root, heading, 0);
      this.planted.push({ pos: { x: h.x, y: 0, z: h.z }, swing: -1, from: { x: h.x, y: 0, z: h.z } });
    }
    for (let i = 0; i < 9; i++) {
      const p = { x: root.x - Math.sin(heading) * (d.tailBase * -1 + (i * d.tailLen) / 8), y: root.y, z: root.z - Math.cos(heading) * (-d.tailBase + (i * d.tailLen) / 8) };
      this.tailPts.push(p);
      this.tailPrev.push({ ...p });
    }
  }

  private emptyPose(root: V3, heading: number): CreaturePose {
    return {
      root, heading, bodyPitch: 0, bodyRoll: 0, crouch: 0, breathe: 0, head: root, headYaw: heading, headPitch: 0,
      gazeYaw: heading, gazePitch: 0, fixation: null, eyes: [root, root], blink: 0, pupil: 0.5, squint: 0,
      hips: [], knees: [], feet: [], ears: [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }], tail: [], tongue: 0, jaw: 0, earsFlat: 0,
    };
  }

  /**
   * A point fixed to the body, in world space. Every attachment (hips, tail, neck, head) goes through this one
   * transform, which matches the renderer's body rotation exactly (Euler YXZ: heading, -pitch, roll), so parts
   * stay joined however the body tilts on a slope.
   */
  bodyPoint(local: V3, root: V3 = this.pose.root, heading = this.pose.heading, pitch = this.pose.bodyPitch, roll = this.pose.bodyRoll): V3 {
    return bodyFrame(local, root, heading, pitch, roll);
  }

  private hipWorld(i: number, root: V3, heading: number, crouch: number): V3 {
    const d = this.d;
    const side = i % 2 === 0 ? -1 : 1;
    const fz = i < 2 ? d.hipFront : d.hipRear;
    return this.bodyPoint({ x: side * d.hipSide, y: -d.hipDown - crouch * d.bodyHeight * 0.25, z: fz }, root, heading);
  }

  /** Head centre for a given root, heading and head angles. */
  headPos(root: V3, heading: number, crouch: number, headDown: number): V3 {
    const d = this.d;
    // the head rides on the neck, so it follows the body's pitch on slopes (roll is left to the neck)
    return bodyFrame({ x: 0, y: d.headUp * (1 - 0.6 * headDown) - crouch * d.bodyHeight * 0.3, z: d.headFwd * (1 + 0.15 * headDown) }, root, heading, this.pose.bodyPitch, 0);
  }

  update(dt: number, inp: MotionInput): CreaturePose {
    this.t += dt;
    const d = this.d;
    const p = this.pose;
    const crouch = lerp(p.crouch, inp.crouch, 1 - Math.exp(-dt * 6));
    p.crouch = crouch;
    p.heading = inp.heading;
    const speed = Math.hypot(inp.vel.x, inp.vel.z);

    // ---- breathing: faster with arousal, slower asleep
    const bRate = inp.sleeping ? 0.6 : 1.2 + 2.2 * inp.arousal;
    p.breathe = Math.sin(this.t * bRate * Math.PI * 2) * (0.5 + 0.5 * inp.arousal);

    // ---- body follows the ground
    const fw = rotY({ x: 0, y: 0, z: 1 }, inp.heading), rt = rotY({ x: 1, y: 0, z: 0 }, inp.heading);
    const L = d.hipFront - d.hipRear;
    const gF = inp.ground(inp.root.x + fw.x * L / 2, inp.root.z + fw.z * L / 2);
    const gB = inp.ground(inp.root.x - fw.x * L / 2, inp.root.z - fw.z * L / 2);
    const gR = inp.ground(inp.root.x + rt.x * d.hipSide, inp.root.z + rt.z * d.hipSide);
    const gL = inp.ground(inp.root.x - rt.x * d.hipSide, inp.root.z - rt.z * d.hipSide);
    p.bodyPitch = lerp(p.bodyPitch, Math.atan2(gF - gB, L) * 0.8, 1 - Math.exp(-dt * 8));
    p.bodyRoll = lerp(p.bodyRoll, Math.atan2(gR - gL, 2 * d.hipSide) * 0.6, 1 - Math.exp(-dt * 8));
    const bob = speed > 0.02 ? Math.abs(Math.sin(this.gaitPhase * Math.PI * 2)) * d.bodyHeight * 0.06 : 0;
    const root = { x: inp.root.x, y: inp.root.y + bob - crouch * d.bodyHeight * 0.35 + (inp.sleeping ? -d.bodyHeight * 0.3 : 0), z: inp.root.z };
    p.root = root;

    // ---- eyes: saccades, pursuit, fixation, microsaccades, drift (blueprint 14.4)
    let tYaw = inp.scanYaw ?? this.gYaw, tPitch = inp.scanPitch ?? this.gPitch;
    const head0 = this.headPos(root, inp.heading, crouch, inp.headDown);
    const eyeC = { x: head0.x, y: head0.y + d.eyeUp, z: head0.z };
    if (inp.gazeTarget) {
      const dx = inp.gazeTarget.x - eyeC.x, dy = inp.gazeTarget.y - eyeC.y, dz = inp.gazeTarget.z - eyeC.z;
      tYaw = Math.atan2(dx, dz);
      tPitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    const errYaw = angDiff(tYaw, this.gYaw), errPitch = tPitch - this.gPitch;
    const err = Math.hypot(errYaw, errPitch) / DEG;
    const targetChanged = inp.gazeTarget !== this.lastTarget && (!this.lastTarget || !inp.gazeTarget || Math.hypot(inp.gazeTarget.x - this.lastTarget.x, inp.gazeTarget.z - this.lastTarget.z) > 1e-6);
    if (this.sacc) {
      const s = this.sacc;
      s.t += dt;
      const u = clamp(s.t / s.dur, 0, 1);
      // minimum-jerk profile with a small overshoot that settles
      const m = u * u * u * (10 - 15 * u + 6 * u * u);
      const over = Math.sin(u * Math.PI) * 0.04 * (u > 0.5 ? 1 : 0);
      this.gYaw = s.y0 + angDiff(s.y1, s.y0) * (m + over);
      this.gPitch = s.p0 + (s.p1 - s.p0) * (m + over);
      if (u >= 1) this.sacc = null;
    } else if (inp.gazeMode === 'pursue' && inp.gazeTarget && err < 6) {
      // smooth pursuit at ~90% gain; catch-up saccades handle the rest
      const k = 1 - Math.exp(-dt * 14);
      this.gYaw += errYaw * k * 0.9;
      this.gPitch += errPitch * k * 0.9;
    } else if (err > (inp.gazeMode === 'pursue' ? 2 : 0.8) || (targetChanged && err > 0.3)) {
      this.startSaccade(tYaw, tPitch, err);
    } else {
      // fixation: slow drift and occasional microsaccades so the eyes are never still
      this.gYaw += this.rng.gauss() * 0.0006 + errYaw * 0.05;
      this.gPitch += this.rng.gauss() * 0.0005 + errPitch * 0.05;
      this.nextMicro -= dt;
      if (this.nextMicro <= 0) {
        this.nextMicro = this.rng.range(0.35, 1.4);
        this.startSaccade(tYaw + this.rng.gauss() * 0.005, tPitch + this.rng.gauss() * 0.004, 0.4);
      }
    }
    this.lastTarget = inp.gazeTarget;

    // ---- head follows the eyes after a short lag; eyes stay within their range in the head
    const eyeYawLim = 30 * DEG, eyePitchLim = 22 * DEG;
    const offY = angDiff(this.gYaw, this.hYaw), offP = this.gPitch - this.hPitch;
    if (Math.abs(offY) > 10 * DEG || Math.abs(offP) > 8 * DEG) this.headLagT += dt;
    else this.headLagT = Math.max(0, this.headLagT - dt);
    const headActive = this.headLagT > 0.07;
    const kH = 70, cH = 2 * Math.sqrt(kH) * 1.05;
    const goalY = headActive ? this.gYaw : this.hYaw + offY * 0.15 * dt;
    const goalP = headActive ? clamp(this.gPitch, -60 * DEG, 50 * DEG) : this.hPitch;
    this.hYawVel += (kH * angDiff(goalY, this.hYaw) - cH * this.hYawVel) * dt;
    this.hPitchVel += (kH * (goalP - this.hPitch) - cH * this.hPitchVel) * dt;
    this.hYaw += this.hYawVel * dt;
    this.hPitch += this.hPitchVel * dt;
    // head can turn ±85° from the body
    const hb = angDiff(this.hYaw, inp.heading);
    if (Math.abs(hb) > 85 * DEG) this.hYaw = inp.heading + Math.sign(hb) * 85 * DEG;
    // eyes counter-rotate as the head moves, and are clamped to their range within the head
    const ey = clamp(angDiff(this.gYaw, this.hYaw), -eyeYawLim, eyeYawLim);
    const ep = clamp(this.gPitch - this.hPitch, -eyePitchLim, eyePitchLim);
    this.gYaw = this.hYaw + ey;
    this.gPitch = this.hPitch + ep;

    // head stabilization: the head keeps its height while the body bobs
    const head = this.headPos({ x: root.x, y: inp.root.y - crouch * d.bodyHeight * 0.35, z: root.z }, inp.heading, crouch, inp.headDown);
    head.y += Math.sin(this.hPitch) * d.headFwd * 0.25;
    p.head = head;
    p.headYaw = this.hYaw;
    p.headPitch = this.hPitch;
    p.gazeYaw = this.gYaw;
    p.gazePitch = this.gPitch;
    const hf = dirFromYawPitch(this.hYaw, this.hPitch);
    const hr = { x: Math.cos(this.hYaw), y: 0, z: -Math.sin(this.hYaw) };
    const eyeBase = { x: head.x + hf.x * d.eyeFwd, y: head.y + d.eyeUp + hf.y * d.eyeFwd, z: head.z + hf.z * d.eyeFwd };
    p.eyes = [
      { x: eyeBase.x - hr.x * d.eyeSide, y: eyeBase.y, z: eyeBase.z - hr.z * d.eyeSide },
      { x: eyeBase.x + hr.x * d.eyeSide, y: eyeBase.y, z: eyeBase.z + hr.z * d.eyeSide },
    ];
    // vergence: both eyes converge on the fixated point when it is near
    p.fixation = inp.gazeTarget && !this.sacc ? { ...inp.gazeTarget } : null;

    // ---- blinks: fast close, slower open; fewer while staring, often during big gaze shifts
    this.nextBlink -= dt;
    if (inp.sleeping) p.blink = lerp(p.blink, 1, 1 - Math.exp(-dt * 3));
    else {
      if (this.blinkT < 0 && this.nextBlink <= 0) {
        this.blinkT = 0;
        this.nextBlink = this.rng.range(2.5, 6) * (inp.gazeMode === 'fixate' || inp.gazeMode === 'pursue' ? 1.5 : 1);
      }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const bt = this.blinkT;
        p.blink = bt < 0.09 ? bt / 0.09 : bt < 0.27 ? 1 - (bt - 0.09) / 0.18 : 0;
        if (bt >= 0.27) this.blinkT = -1;
      } else p.blink = 0;
    }
    // pupils widen in low light and with arousal
    const pupilGoal = clamp(0.25 + 0.55 * (1 - inp.light) + 0.25 * inp.arousal + 0.1 * inp.pupilHint, 0.15, 1);
    p.pupil = lerp(p.pupil, pupilGoal, 1 - Math.exp(-dt * 3));
    p.squint = lerp(p.squint, inp.squint, 1 - Math.exp(-dt * 5));

    // ---- legs: gait by speed, planted feet, swing arcs, two-bone IK
    const strideF = speed / Math.max(1e-3, d.stride * (speed > 0.25 * d.scale ? 1.5 : 1));
    this.gaitPhase = (this.gaitPhase + strideF * dt) % 1;
    const trot = speed > 0.22 * d.scale;
    const offsets = trot ? [0, 0.5, 0.5, 0] : [0, 0.5, 0.75, 0.25]; // FL, FR, RL, RR
    const duty = trot ? 0.55 : 0.7;
    p.hips = [];
    p.knees = [];
    p.feet = [];
    for (let i = 0; i < 4; i++) {
      const hip = this.hipWorld(i, root, inp.heading, crouch);
      const home = { x: hip.x + inp.vel.x * 0.12, y: 0, z: hip.z + inp.vel.z * 0.12 };
      home.y = inp.ground(home.x, home.z);
      const f = this.planted[i];
      const ph = (this.gaitPhase + offsets[i]) % 1;
      const moving = speed > 0.015 * d.scale;
      if (moving) {
        if (ph < duty) {
          if (f.swing >= 0) { f.swing = -1; f.pos = { ...home, x: hip.x + inp.vel.x * 0.18, z: hip.z + inp.vel.z * 0.18 }; f.pos.y = inp.ground(f.pos.x, f.pos.z); }
        } else {
          const u = (ph - duty) / (1 - duty);
          if (f.swing < 0) f.from = { ...f.pos };
          f.swing = u;
          const target = { x: hip.x + inp.vel.x * 0.18, z: hip.z + inp.vel.z * 0.18 };
          const s = smoothstep(0, 1, u);
          f.pos = { x: lerp(f.from.x, target.x, s), y: 0, z: lerp(f.from.z, target.z, s) };
          f.pos.y = inp.ground(f.pos.x, f.pos.z) + Math.sin(u * Math.PI) * d.legUpper * 0.6;
        }
      } else {
        // settle: a foot that is too far from home takes a small step
        const dx = home.x - f.pos.x, dz = home.z - f.pos.z;
        if (Math.hypot(dx, dz) > d.stride * 0.35) f.pos = { x: home.x, y: inp.ground(home.x, home.z), z: home.z };
        f.swing = -1;
      }
      const foot = { ...f.pos };
      foot.y = Math.max(foot.y, inp.ground(foot.x, foot.z));
      const knee = ik2(hip, foot, d.legUpper, d.legLower, i < 2 ? 1 : -1, inp.heading);
      p.hips.push(hip);
      p.knees.push(knee);
      p.feet.push(foot);
    }

    // ---- ears: springs toward a sound, flattened when scared, small idle twitches
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      let goal = side * 0.35 + (inp.earsBearing !== undefined ? clamp(inp.earsBearing, -1.2, 1.2) * 0.6 : 0);
      if (this.rng.chance(dt * 0.3)) this.earVel[e] += this.rng.gauss() * 4;
      this.earVel[e] += (40 * (goal - this.earYaw[e]) - 8 * this.earVel[e]) * dt;
      this.earYaw[e] += this.earVel[e] * dt;
      p.ears[e] = { yaw: this.earYaw[e], pitch: -inp.earsFlat * 1.1 };
    }
    p.earsFlat = inp.earsFlat;

    // ---- tail: a verlet chain with stiffness, lagging behind the body.
    // The base is anchored *inside* the rump through the body frame, so it can never pull away from the body;
    // stiffness falls off toward the tip, so the root of the tail follows the spine and the tip trails.
    const seg = d.tailLen / 8;
    const anchorZ = d.tailBase * 0.88;
    this.tailPts[0] = this.bodyPoint({ x: 0, y: d.bodyHeight * 0.12, z: anchorZ });
    for (let i = 1; i < this.tailPts.length; i++) {
      const cur = this.tailPts[i], prev = this.tailPrev[i];
      const vx = (cur.x - prev.x) * 0.9, vy = (cur.y - prev.y) * 0.9, vz = (cur.z - prev.z) * 0.9;
      this.tailPrev[i] = { ...cur };
      // rest shape: behind the body, slightly up, swaying
      const sway = Math.sin(this.t * 1.6 + i * 0.5) * 0.15 * (1 + inp.arousal);
      const rp = this.bodyPoint({ x: sway * i * seg * 0.3, y: d.bodyHeight * 0.12 + (inp.tailUp * 0.6 - 0.15) * i * seg, z: anchorZ - i * seg });
      const k = i === 1 ? 0.85 : i === 2 ? 0.5 : 0.12 + 0.2 / i;
      let nx = cur.x + vx + (rp.x - cur.x) * k, ny = cur.y + vy - 9.8 * dt * dt * 0.2 + (rp.y - cur.y) * k, nz = cur.z + vz + (rp.z - cur.z) * k;
      const g = inp.ground(nx, nz) + 0.004 * d.scale;
      if (ny < g) ny = g;
      const a = this.tailPts[i - 1];
      const dx = nx - a.x, dy = ny - a.y, dz = nz - a.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.tailPts[i] = { x: a.x + (dx / l) * seg, y: a.y + (dy / l) * seg, z: a.z + (dz / l) * seg };
    }
    p.tail = this.tailPts.map((q) => ({ ...q }));

    p.tongue = lerp(p.tongue, inp.tongue, 1 - Math.exp(-dt * 18));
    p.jaw = lerp(p.jaw, inp.jaw, 1 - Math.exp(-dt * 14));
    return p;
  }

  private startSaccade(yaw: number, pitch: number, ampDeg: number) {
    // main sequence: duration grows with amplitude (~21 ms + 2.2 ms per degree)
    const dur = (21 + 2.2 * Math.min(ampDeg, 60)) / 1000;
    this.sacc = { t: 0, dur, y0: this.gYaw, p0: this.gPitch, y1: yaw, p1: pitch };
    if (ampDeg > 20 && this.blinkT < 0 && this.rng.chance(0.35)) this.nextBlink = 0;
  }

  /** Current gaze and head directions, for the senses. */
  gazeDir(): V3 { return dirFromYawPitch(this.gYaw, this.gPitch); }
  headDir(): V3 { return dirFromYawPitch(this.hYaw, this.hPitch); }
  inSaccade(): boolean { return this.sacc !== null; }
}

/** Local body offset → world, with the same rotation order the renderer uses (Euler YXZ: Ry(heading)·Rx(-pitch)·Rz(roll)). */
export function bodyFrame(l: V3, root: V3, heading: number, pitch: number, roll: number): V3 {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = l.x * cr - l.y * sr, y1 = l.x * sr + l.y * cr, z1 = l.z;
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  return { x: root.x + x1 * ch + z2 * sh, y: root.y + y2, z: root.z - x1 * sh + z2 * ch };
}

/** Two-bone IK: knee position for a hip and foot. Front knees bend back, rear knees bend forward. */
function ik2(hip: V3, foot: V3, a: number, b: number, bend: number, heading: number): V3 {
  const dx = foot.x - hip.x, dy = foot.y - hip.y, dz = foot.z - hip.z;
  let c = Math.hypot(dx, dy, dz);
  c = clamp(c, Math.abs(a - b) + 1e-5, a + b - 1e-5);
  const cosA = (a * a + c * c - b * b) / (2 * a * c);
  const ang = Math.acos(clamp(cosA, -1, 1));
  const ux = dx / (Math.hypot(dx, dy, dz) || 1), uy = dy / (Math.hypot(dx, dy, dz) || 1), uz = dz / (Math.hypot(dx, dy, dz) || 1);
  // bend direction: along the body's forward axis
  const fw = rotY({ x: 0, y: 0, z: bend * -1 }, heading);
  // remove the component along u
  const k = fw.x * ux + fw.y * uy + fw.z * uz;
  let px = fw.x - ux * k, py = fw.y - uy * k, pz = fw.z - uz * k;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  return {
    x: hip.x + ux * a * Math.cos(ang) + px * a * Math.sin(ang),
    y: hip.y + uy * a * Math.cos(ang) + py * a * Math.sin(ang),
    z: hip.z + uz * a * Math.cos(ang) + pz * a * Math.sin(ang),
  };
}
