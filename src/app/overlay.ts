// The measurement overlay on the creature's-eye view: what its eyes are measuring right now, drawn where it is.
// Tracking brackets sized by how big each thing looks, labelled with the creature's own word for it (or how it
// would describe it, if it has no word yet), how clearly it is resolved, how far, and how strongly it pulls the eye.
import * as THREE from 'three';
import type { World } from '../world/world';
import type { Measured } from './recorder';
import type { MindReport } from '../protocol/types';

export interface Rect { x: number; y: number; w: number; h: number }

const LEVEL: Record<string, string> = { detected: 'glimpse', identified: 'seen', detail: 'detail' };

function brackets(g: CanvasRenderingContext2D, x: number, y: number, r: number, len: number) {
  const L = Math.min(len, r);
  g.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.moveTo(x + sx * r, y + sy * (r - L));
    g.lineTo(x + sx * r, y + sy * r);
    g.lineTo(x + sx * (r - L), y + sy * r);
  }
  g.stroke();
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, lines: string[], color: string, bold: boolean) {
  g.font = `${bold ? 600 : 500} 11px Inter, system-ui, sans-serif`;
  const w = Math.max(...lines.map((l, i) => (i === 0 ? g.measureText(l).width : g.measureText(l).width * 0.92))) + 12;
  const h = 6 + lines.length * 13;
  g.fillStyle = 'rgba(10,14,12,0.72)';
  g.beginPath();
  g.roundRect(x, y, w, h, 6);
  g.fill();
  g.fillStyle = color;
  g.fillText(lines[0], x + 6, y + 14);
  g.font = '500 10px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(233,236,230,0.72)';
  for (let i = 1; i < lines.length; i++) g.fillText(lines[i], x + 6, y + 14 + i * 13);
}

/**
 * Draw the overlay for one eye-view pane. `cam` is the eye camera exactly as rendered, so positions line up.
 */
export function drawMeasurements(g: CanvasRenderingContext2D, rect: Rect, cam: THREE.PerspectiveCamera, world: World, measured: Measured[], report: MindReport | null) {
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  const target = report?.gaze.target;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const v = new THREE.Vector3();
  // labels placed so they do not pile on each other
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  // in a small pane, label only what it is locked onto; brackets show the rest
  const compact = rect.w < 520;
  const order = [...measured].sort((a, b) => (a.node === target ? -1 : b.node === target ? 1 : b.salience - a.salience));
  for (const m of order) {
    const n = world.nodes.get(m.node);
    if (!n || n.removed) continue;
    v.set(n.pos.x, n.pos.y, n.pos.z).project(cam);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
    const x = rect.x + (v.x * 0.5 + 0.5) * rect.w, y = rect.y + (-v.y * 0.5 + 0.5) * rect.h;
    const r = Math.max(7, Math.min(rect.h * 0.45, (Math.tan(THREE.MathUtils.degToRad(m.angleDeg / 2)) / tanHalf) * (rect.h / 2)));
    const isTarget = m.node === target || (!!target && target.startsWith(m.node + '/'));
    const col = isTarget ? '#ffd27a' : m.known ? '#9fe08f' : '#cfe3ff';
    g.strokeStyle = col;
    g.globalAlpha = isTarget ? 1 : 0.45 + 0.5 * Math.min(1, m.salience / 1.5);
    g.lineWidth = isTarget ? 2.2 : 1.3;
    if (!m.known) g.setLineDash([4, 3]);
    brackets(g, x, y, r, Math.max(5, r * 0.4));
    g.setLineDash([]);
    if (isTarget) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
    }
    if (compact && !isTarget) continue;
    // label
    const lines = [
      (m.known ? m.label : `? ${m.label}`) + (isTarget ? (report?.gaze.mode === 'pursue' ? '  · tracking' : '  · locked') : ''),
      `${LEVEL[m.level] ?? m.level} · ${m.distance < 1 ? Math.round(m.distance * 100) + ' cm' : m.distance.toFixed(1) + ' m'} · pull ${m.salience.toFixed(2)}`,
    ];
    let lx = x + r + 4, ly = y - r;
    const lw = 190, lh = 34;
    for (let k = 0; k < 6 && placed.some((p) => lx < p.x + p.w && lx + lw > p.x && ly < p.y + p.h && ly + lh > p.y); k++) ly += lh + 2;
    if (lx + lw > rect.x + rect.w) lx = x - r - 4 - lw;
    lx = Math.max(rect.x + 4, Math.min(lx, rect.x + rect.w - lw - 4));
    ly = Math.max(rect.y + 30, Math.min(ly, rect.y + rect.h - lh - 4));
    placed.push({ x: lx, y: ly, w: lw, h: lh });
    g.globalAlpha = isTarget ? 1 : 0.9;
    pill(g, lx, ly, lines, col, isTarget);
  }
  g.globalAlpha = 1;
  // where the eye is pointed: the centre of the fovea
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - 9, cy); g.lineTo(cx - 3, cy); g.moveTo(cx + 3, cy); g.lineTo(cx + 9, cy);
  g.moveTo(cx, cy - 9); g.lineTo(cx, cy - 3); g.moveTo(cx, cy + 3); g.lineTo(cx, cy + 9);
  g.stroke();
  // a legend strip
  if (report && !compact) {
    const txt = `eyes: ${report.gaze.mode}${target ? '' : ' (searching)'} · interest ${Math.round(report.gaze.interest * 100)}% · ${measured.length} things in view`;
    g.font = '500 10.5px ui-monospace, Menlo, monospace';
    const w = g.measureText(txt).width + 14;
    g.fillStyle = 'rgba(10,14,12,0.7)';
    g.beginPath();
    g.roundRect(rect.x + 10, rect.y + rect.h - 28, w, 20, 6);
    g.fill();
    g.fillStyle = 'rgba(233,236,230,0.85)';
    g.fillText(txt, rect.x + 17, rect.y + rect.h - 14);
  }
  g.restore();
}
