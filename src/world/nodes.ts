// Semantic node instances: the part trees that make up the world (blueprint 3.2).
// Every visible piece of the world is one of these, with one ID shared by physics, senses, mind and render.
import type { PartSpec } from '../ontology/types';
import type { V3 } from '../util/vec';

export type NodeMotion = 'static' | 'flutter' | 'physics' | 'agent' | 'attached' | 'sway';

export interface NodeInst {
  id: string;
  spec: PartSpec;
  entity: string; // top-level ontology entity key
  parent: NodeInst | null;
  children: NodeInst[];
  top: NodeInst;
  pos: V3; // current world centre
  basePos: V3; // rest position (flutter swings around this)
  vel: V3;
  size: number; // characteristic visible extent, metres
  motion: NodeMotion;
  local?: V3; // offset from parent, in the parent's heading frame (attached parts of moving things)
  heading: number; // radians, for agents and attached frames
  phase: number; // per-node random phase for flutter and gait
  body?: number; // physics rigid-body handle
  removed: boolean;
  respawnAt?: number;
  /** Render-only hints (geometry, orientation). Never read by senses or mind. */
  render: Record<string, any>;
}

export class NodeRegistry {
  readonly byId = new Map<string, NodeInst>();
  /** Bumped on every create/delete, so caches over the node set know when to rebuild. */
  version = 0;
  readonly tops: NodeInst[] = [];
  private counters = new Map<string, number>();

  nextId(base: string): string {
    const n = this.counters.get(base) ?? 0;
    this.counters.set(base, n + 1);
    return `${base}_${String(n).padStart(2, '0')}`;
  }

  create(spec: PartSpec, entity: string, parent: NodeInst | null, pos: V3, size: number, opts: Partial<NodeInst> = {}): NodeInst {
    const id = parent ? `${parent.id}/${spec.key}_${parent.children.filter((c) => c.spec.key === spec.key).length}` : this.nextId(entity);
    const node: NodeInst = {
      id,
      spec,
      entity,
      parent,
      children: [],
      top: null as unknown as NodeInst,
      pos: { ...pos },
      basePos: { ...pos },
      vel: { x: 0, y: 0, z: 0 },
      size,
      motion: 'static',
      heading: 0,
      phase: 0,
      removed: false,
      render: {},
      ...opts,
    };
    node.top = parent ? parent.top : node;
    if (parent) parent.children.push(node);
    else this.tops.push(node);
    this.byId.set(id, node);
    this.version++;
    return node;
  }

  /** Remove a node and its whole subtree from the registry. */
  delete(node: NodeInst): void {
    this.version++;
    const walk = (n: NodeInst) => {
      n.children.forEach(walk);
      this.byId.delete(n.id);
    };
    walk(node);
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    else this.tops.splice(this.tops.indexOf(node), 1);
  }

  get(id: string): NodeInst | undefined {
    return this.byId.get(id);
  }
}

export function partSpec(spec: PartSpec, key: string): PartSpec {
  const p = spec.parts.find((x) => x.key === key);
  if (!p) throw new Error(`ontology: ${spec.path} has no part '${key}'`);
  return p;
}
