// Every creature in the world you can follow, fly around, or see through: the creature, you (the visitor), and each
// ant and butterfly. A subject says where it is, which way it faces, and where its eyes are and point.
import type { Simulation } from '../sim/simulation';
import type { CreaturePose } from '../body/motion';
import type { NodeInst } from '../world/nodes';
import type { V3 } from '../util/vec';

export type SubjectKind = 'creature' | 'visitor' | 'ant' | 'butterfly';

export interface Subject {
  id: string;
  label: string;
  kind: SubjectKind;
  /** it has a modelled mind: the Mind panel and the measurement overlay apply */
  hasMind: boolean;
  /** rough body size in metres: sets how close the follow camera sits */
  size: number;
  pos(): V3;
  heading(): number;
  /** eye position and gaze direction (yaw, pitch) */
  eye(): { pos: V3; yaw: number; pitch: number; fov: number };
}

function poseEye(p: CreaturePose, fov: number) {
  const pos = { x: (p.eyes[0].x + p.eyes[1].x) / 2, y: (p.eyes[0].y + p.eyes[1].y) / 2, z: (p.eyes[0].z + p.eyes[1].z) / 2 };
  return { pos, yaw: p.gazeYaw, pitch: p.gazePitch, fov };
}

function bugEye(n: NodeInst, ahead: number, up: number, pitch: number, fov: number) {
  const h = n.heading;
  return { pos: { x: n.pos.x + Math.sin(h) * ahead, y: n.pos.y + up, z: n.pos.z + Math.cos(h) * ahead }, yaw: h, pitch, fov };
}

export function listSubjects(sim: Simulation): Subject[] {
  const out: Subject[] = [
    {
      id: 'creature', label: 'The creature', kind: 'creature', hasMind: true, size: 0.12,
      pos: () => sim.creature.pose.root, heading: () => sim.creature.pose.heading,
      eye: () => poseEye(sim.creature.pose, 100),
    },
    {
      id: 'visitor', label: 'You (visitor)', kind: 'visitor', hasMind: false, size: 0.3,
      pos: () => sim.player.pose.root, heading: () => sim.player.pose.heading,
      eye: () => poseEye(sim.player.pose, 90),
    },
  ];
  sim.world.ants.ants.forEach((a, i) => out.push({
    id: a.node.id, label: `Ant ${i + 1}`, kind: 'ant', hasMind: false, size: 0.012,
    pos: () => a.node.pos, heading: () => a.node.heading,
    eye: () => bugEye(a.node, 0.004, 0.0015, -0.05, 110),
  }));
  sim.world.butterflies.flies.forEach((f, i) => out.push({
    id: f.node.id, label: `Butterfly ${i + 1}`, kind: 'butterfly', hasMind: false, size: 0.05,
    pos: () => f.node.pos, heading: () => f.node.heading,
    eye: () => bugEye(f.node, 0.01, 0.003, -0.25, 120),
  }));
  return out;
}
