// Terrain: one height function used by physics (collider), senses (ground), motion (feet) and render (mesh).
import { fbm2 } from '../util/rng';
import { smoothstep } from '../util/vec';

export const WORLD_SIZE = 16; // metres, square, centred on the origin
export const TERRAIN_RES = 0.1; // metres between grid vertices
export const POND = { x: 3.6, z: -3.0, r: 1.6, depth: 0.22 };
export const WATER_LEVEL = -0.07;

export function terrainHeight(x: number, z: number): number {
  let h = fbm2(x * 0.18, z * 0.18, 4, 3) * 0.35 + fbm2(x * 1.3, z * 1.3, 2, 11) * 0.015;
  // flatten a clearing around the spawn so a 12 cm animal can walk it
  const c = Math.hypot(x, z);
  h *= 0.35 + 0.65 * smoothstep(1.5, 5, c);
  // raise the edges into low banks
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(WORLD_SIZE / 2 - 2.2, WORLD_SIZE / 2, e) * 0.6;
  // pond bowl
  const dp = Math.hypot(x - POND.x, z - POND.z);
  const bowl = 1 - smoothstep(POND.r * 0.35, POND.r * 1.15, dp);
  h = h * (1 - bowl) + (WATER_LEVEL - POND.depth) * bowl;
  return h;
}

export function terrainNormal(x: number, z: number): { x: number; y: number; z: number } {
  const e = 0.05;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return { x: nx / l, y: ny / l, z: nz / l };
}

export type Surface = 'grass' | 'dirt' | 'mud' | 'sand' | 'water';

export function surfaceAt(x: number, z: number): Surface {
  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.r * 0.8) return 'water';
  if (dp < POND.r * 1.05) return 'mud';
  if (dp < POND.r * 1.3) return 'sand';
  const n = fbm2(x * 0.5, z * 0.5, 3, 41);
  return n > 0.08 ? 'dirt' : 'grass';
}

export interface TerrainMesh { positions: Float32Array; indices: Uint32Array; n: number }

export function buildTerrainMesh(): TerrainMesh {
  const n = Math.round(WORLD_SIZE / TERRAIN_RES) + 1;
  const positions = new Float32Array(n * n * 3);
  const half = WORLD_SIZE / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -half + i * TERRAIN_RES, z = -half + j * TERRAIN_RES;
      const k = (j * n + i) * 3;
      positions[k] = x;
      positions[k + 1] = terrainHeight(x, z);
      positions[k + 2] = z;
    }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  return { positions, indices, n };
}
