// L4 SENSES: each sense is its own agent, sampling the world and the body, sending the mind a frame (blueprint 5).
import type { World } from '../world/world';
import type { CreatureBody } from '../body/creature';
import { SELF_ID } from '../body/creature';
import type { PerceptFrame, SoundPercept } from '../protocol/types';
import { PROTOCOL_VERSION } from '../protocol/types';
import { Vision } from './vision';
import { Rng } from '../util/rng';
import { angDiff, clamp, DEG, dist } from '../util/vec';

export class Senses {
  readonly vision = new Vision();
  private rng: Rng;
  private heardIds = new Set<number>();
  private frameNo = 0;
  private lastT = 0;

  constructor(private world: World, private body: CreatureBody) {
    this.rng = world.rng.fork(55);
  }

  frame(): PerceptFrame {
    const w = this.world, b = this.body;
    const dt = Math.max(1e-3, w.t - this.lastT);
    this.lastT = w.t;
    const es = b.eyeState();
    const asleep = b.intent.sleep;
    const vision = asleep || b.pose.blink > 0.8 ? [] : this.vision.see(w, es, this.rng, dt);

    // smell: one mixed vector at the nose, no direction. Sniffing raises the gain.
    const raw = w.smellAt(b.mouthPos());
    const gain = b.sniffGain * (asleep ? 0.3 : 1);
    // receptors respond roughly in proportion at low concentration and saturate gently at high
    const mix = raw.map((x) => clamp((x * gain) / (x * gain + 0.35) + this.rng.gauss() * 0.005, 0, 1));
    const strength = Math.max(...mix);

    // hearing: loudness falls with distance and obstacles; direction comes from the two ears, with error
    const sounds: SoundPercept[] = [];
    const ears = b.pose.head;
    const seen = new Set<number>();
    for (const s of w.sounds) {
      if (s.source === SELF_ID) continue;
      const d = dist(s.pos, ears);
      const falloff = s.speech ? 1 + (d / 1.2) ** 2 : 1 + (d / 0.5) ** 2;
      let loud = s.loudness / falloff;
      const block = w.raycast(ears, s.pos, b.handle);
      if (block && block.dist < d - 0.1 && block.node !== s.source) loud *= 0.45;
      if (asleep) loud *= 0.4;
      if (loud < 0.008) continue;
      seen.add(s.id);
      const trueBearing = angDiff(Math.atan2(s.pos.x - ears.x, s.pos.z - ears.z), b.heading) / DEG;
      let est = trueBearing + this.rng.gauss() * (6 + 25 * (1 - clamp(loud * 5, 0, 1)));
      if (Math.abs(trueBearing) > 100 && this.rng.chance(0.25)) est = Math.sign(est) * (180 - Math.abs(est)); // front-back confusion
      sounds.push({
        id: s.id,
        sig: s.sig.map((x, i) => (i === 1 ? loud : x)),
        loudness: loud,
        bearingDeg: est,
        onset: !this.heardIds.has(s.id),
        speech: s.speech && loud > 0.012 ? { ...s.speech } : undefined,
      });
    }
    this.heardIds = seen;

    const touch = b.touches.splice(0);
    const taste = b.tastes.splice(0);
    const p = b.pos;
    return {
      v: PROTOCOL_VERSION,
      frame: this.frameNo++,
      time: { t: w.t, day: w.clock.day, hour: w.clock.hour, ambientLight: w.lightAt(p) },
      vision,
      smell: { mix, strength },
      sounds,
      touch,
      taste,
      body: { ...b.bio },
      proprio: {
        pos: { x: p.x, z: p.z },
        headingDeg: b.heading / DEG,
        speed: Math.hypot(b.vel.x, b.vel.z),
        gazeNode: b.intent.gaze.target,
        mouthBusy: !!b.mouthAction,
        reach: b.reachable(),
        inShelter: !!w.inShelter(b.pose.head),
      },
      startle: b.startle,
    };
  }
}
