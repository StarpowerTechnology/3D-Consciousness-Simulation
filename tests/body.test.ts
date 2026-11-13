// Body integrity: every attached part stays joined to the body, for every creature, in every pose it reaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './helpers';
import type { CreaturePose, RigDims } from '../src/body/motion';
import type { V3 } from '../src/util/vec';

/** World point → the body's local frame (inverse of bodyFrame: Ry(heading)·Rx(-pitch)·Rz(roll)). */
function toLocal(q: V3, p: CreaturePose): V3 {
  const dx = q.x - p.root.x, dy = q.y - p.root.y, dz = q.z - p.root.z;
  const ch = Math.cos(-p.heading), sh = Math.sin(-p.heading);
  const x1 = dx * ch + dz * sh, z1 = -dx * sh + dz * ch, y1 = dy;
  const cp = Math.cos(p.bodyPitch), sp = Math.sin(p.bodyPitch);
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  const cr = Math.cos(-p.bodyRoll), sr = Math.sin(-p.bodyRoll);
  return { x: x1 * cr - y2 * sr, y: x1 * sr + y2 * cr, z: z2 };
}

/** Inside the body ellipsoid the renderer draws (half-axes W, H, L scaled by the rig). */
function insideBody(q: V3, p: CreaturePose, d: RigDims): number {
  const s = d.scale, l = toLocal(q, p);
  const W = 0.023 * s, H = 0.022 * s, L = 0.05 * s;
  return (l.x / W) ** 2 + (l.y / H) ** 2 + (l.z / L) ** 2; // < 1 means inside
}

test('body parts stay attached: tail root and hips stay inside the body, tail links keep their length', async () => {
  const sim = await makeSim(3);
  let worstTail = 0, worstHip = 0, worstLink = 0, maxPitch = 0;
  for (let i = 0; i < 60 * 90; i++) {
    sim.step();
    for (const body of [sim.creature, sim.player]) {
      const p = body.pose, d = body.motion.d;
      maxPitch = Math.max(maxPitch, Math.abs(p.bodyPitch), Math.abs(p.bodyRoll));
      worstTail = Math.max(worstTail, insideBody(p.tail[0], p, d));
      for (const h of p.hips) worstHip = Math.max(worstHip, insideBody(h, p, d));
      const seg = d.tailLen / 8;
      for (let k = 1; k < p.tail.length; k++) {
        const a = p.tail[k - 1], b = p.tail[k];
        worstLink = Math.max(worstLink, Math.abs(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - seg) / seg);
      }
    }
  }
  assert.ok(maxPitch > 0.02, 'the run never tilted the body, so the check proved nothing');
  assert.ok(worstTail < 0.9, `tail root left the body (ellipsoid measure ${worstTail.toFixed(2)})`);
  assert.ok(worstHip < 0.85, `a hip left the body (ellipsoid measure ${worstHip.toFixed(2)})`);
  assert.ok(worstLink < 0.01, `a tail link stretched by ${(worstLink * 100).toFixed(1)}%`);
});
