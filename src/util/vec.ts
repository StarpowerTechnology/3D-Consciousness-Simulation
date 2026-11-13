// Small engine-free vector math. Used by world, senses and body. The mind uses almost none of it.

export interface V3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2d = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (o: V3, a: V3): V3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };

export const DEG = Math.PI / 180;

/** Direction from yaw (around +y, 0 = +z) and pitch (up positive). */
export const dirFromYawPitch = (yaw: number, pitch: number): V3 => ({
  x: Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: Math.cos(yaw) * Math.cos(pitch),
});

export const yawPitchFromDir = (d: V3): { yaw: number; pitch: number } => {
  const n = norm(d);
  return { yaw: Math.atan2(n.x, n.z), pitch: Math.asin(clamp(n.y, -1, 1)) };
};

/** Smallest signed angle difference a - b, in radians. */
export const angDiff = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

export const angleBetween = (a: V3, b: V3): number => {
  const la = len(a), lb = len(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1));
};

/** Rotate a vector around +y by yaw. */
export const rotY = (a: V3, yaw: number): V3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: a.x * c + a.z * s, y: a.y, z: -a.x * s + a.z * c };
};

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
