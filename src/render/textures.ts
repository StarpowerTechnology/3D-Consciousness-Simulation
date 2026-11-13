// Procedural textures painted on canvases: no downloaded assets, so everything is generated and consistent.
import * as THREE from 'three';
import { fbm2, noise2, Rng } from '../util/rng';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** A leaf with a stem running through it and veins coming off the stem — the same structure the ontology describes. */
export function leafTexture(base = '#4f8a2c', edge = '#2f5e18', autumn = false): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const path = new Path2D();
  path.moveTo(S / 2, S * 0.97);
  path.bezierCurveTo(S * 0.05, S * 0.72, S * 0.08, S * 0.22, S / 2, S * 0.03);
  path.bezierCurveTo(S * 0.92, S * 0.22, S * 0.95, S * 0.72, S / 2, S * 0.97);
  const grad = g.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, autumn ? '#c89a3a' : base);
  grad.addColorStop(1, autumn ? '#8a4a1e' : edge);
  g.fillStyle = grad;
  g.fill(path);
  // a soft darker outline, cartoon style
  g.strokeStyle = autumn ? 'rgba(120,60,20,0.6)' : 'rgba(30,80,20,0.55)';
  g.lineWidth = 7;
  g.stroke(path);
  g.save();
  g.clip(path);
  // mottling
  const r = new Rng(autumn ? 7 : 3);
  for (let i = 0; i < 25; i++) {
    g.fillStyle = `rgba(${autumn ? '90,50,10' : '20,40,5'},${r.range(0.02, 0.05)})`;
    g.beginPath();
    g.arc(r.range(0, S), r.range(0, S), r.range(2, 14), 0, Math.PI * 2);
    g.fill();
  }
  // stem
  g.strokeStyle = autumn ? 'rgba(230,190,120,0.8)' : 'rgba(190,220,140,0.85)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(S / 2, S * 0.99);
  g.quadraticCurveTo(S * 0.52, S * 0.5, S / 2, S * 0.06);
  g.stroke();
  // veins branching from the stem
  g.lineWidth = 1.6;
  for (let i = 0; i < 9; i++) {
    const y = S * (0.82 - i * 0.08);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(S / 2, y);
      g.quadraticCurveTo(S / 2 + side * S * 0.18, y - S * 0.05, S / 2 + side * S * (0.36 - i * 0.025), y - S * 0.12);
      g.stroke();
    }
  }
  g.restore();
  return tex(c);
}

export function barkTexture(): THREE.CanvasTexture {
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm2(x * 0.06, y * 0.012, 4, 21) * 0.6 + fbm2(x * 0.3, y * 0.04, 2, 4) * 0.25;
      const crack = Math.abs(noise2(x * 0.05, y * 0.006, 9)) < 0.07 ? -0.35 : 0;
      const v = 0.42 + n + crack;
      const k = (y * W + x) * 4;
      img.data[k] = Math.max(0, Math.min(255, 95 * v + 10));
      img.data[k + 1] = Math.max(0, Math.min(255, 70 * v + 6));
      img.data[k + 2] = Math.max(0, Math.min(255, 48 * v + 4));
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, true, true);
}

export function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // tileable-ish: sample on a torus
      const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + Math.cos(b) * 3, 5, 2) * 0.5 + fbm2(Math.sin(b) * 6, Math.cos(a) * 6, 3, 8) * 0.5;
      const pebble = noise2(x * 0.3, y * 0.3, 5) > 0.72 ? 0.25 : 0;
      const v = 0.75 + n * 0.6 + pebble;
      const k = (y * S + x) * 4;
      img.data[k] = 255 * Math.min(1, v * 0.62);
      img.data[k + 1] = 255 * Math.min(1, v * 0.56);
      img.data[k + 2] = 255 * Math.min(1, v * 0.46);
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, true, true);
}

export function noiseTexture(size = 256, seed = 1, scale = 0.08): THREE.CanvasTexture {
  const { c, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (noise2(x * scale, y * scale, seed) * 0.5 + 0.5) * 255;
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, false, true);
}

/** Water normal map: soft overlapping ripples. */
export function waterNormals(): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  const h = (x: number, y: number) => {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    return Math.sin(a * 3 + Math.sin(b * 2) * 1.5) * 0.5 + Math.sin(b * 5 + a) * 0.3 + noise2(Math.cos(a) * 4, Math.sin(b) * 4, 3) * 0.4;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const k = (y * S + x) * 4;
      img.data[k] = 128 + dx * 60;
      img.data[k + 1] = 128 + dy * 60;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, false, true);
}

/** An iris with fibres, a dark limbal ring and room for a live pupil. */
export function irisTexture(color: [number, number, number], ring = '#1a0f08'): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#f2ece4';
  g.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  const R = S * 0.46;
  const grad = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  const [r, gg, b] = color;
  grad.addColorStop(0, `rgb(${r * 0.5},${gg * 0.5},${b * 0.5})`);
  grad.addColorStop(0.35, `rgb(${r},${gg},${b})`);
  grad.addColorStop(0.8, `rgb(${r * 0.75},${gg * 0.7},${b * 0.6})`);
  grad.addColorStop(1, ring);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  const rng = new Rng(11);
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r0 = R * rng.range(0.18, 0.3), r1 = R * rng.range(0.6, 0.98);
    g.strokeStyle = `rgba(${rng.chance(0.5) ? '255,220,160' : '40,20,8'},${rng.range(0.08, 0.25)})`;
    g.lineWidth = rng.range(0.6, 1.8);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a + rng.range(-0.08, 0.08)) * r1, cy + Math.sin(a + rng.range(-0.08, 0.08)) * r1);
    g.stroke();
  }
  return tex(c);
}

export function wingTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const p = new Path2D();
  p.moveTo(S * 0.02, S * 0.5);
  p.bezierCurveTo(S * 0.2, S * -0.05, S * 0.95, S * 0.0, S * 0.98, S * 0.35);
  p.bezierCurveTo(S * 0.9, S * 0.55, S * 0.75, S * 0.6, S * 0.7, S * 0.62);
  p.bezierCurveTo(S * 0.85, S * 0.8, S * 0.6, S * 1.0, S * 0.35, S * 0.92);
  p.bezierCurveTo(S * 0.2, S * 0.85, S * 0.1, S * 0.65, S * 0.02, S * 0.5);
  const grad = g.createRadialGradient(S * 0.1, S * 0.5, 4, S * 0.4, S * 0.45, S * 0.8);
  grad.addColorStop(0, '#6b2a04');
  grad.addColorStop(0.3, '#e8741a');
  grad.addColorStop(0.85, '#f39a2c');
  grad.addColorStop(1, '#1b0e05');
  g.fillStyle = grad;
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = 'rgba(25,12,4,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(S * 0.05, S * 0.5);
    g.quadraticCurveTo(S * 0.4, S * (0.2 + i * 0.1), S * 0.95, S * (0.1 + i * 0.13));
    g.stroke();
  }
  g.lineWidth = 14;
  g.stroke(p);
  g.fillStyle = '#fff7e8';
  const r = new Rng(4);
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.arc(S * r.range(0.7, 0.95), S * r.range(0.1, 0.55), r.range(3, 7), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return tex(c);
}

export function spotsTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#d8291c');
  grad.addColorStop(1, '#9c1410');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const r = new Rng(5);
  g.fillStyle = '#f6efe2';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.ellipse(r.range(0, S), r.range(0, S * 0.85), r.range(5, 13), r.range(4, 10), r.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

export function petalTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const p = new Path2D();
  p.moveTo(S / 2, S);
  p.bezierCurveTo(S * 0.05, S * 0.6, S * 0.2, S * 0.02, S / 2, S * 0.05);
  p.bezierCurveTo(S * 0.8, S * 0.02, S * 0.95, S * 0.6, S / 2, S);
  const grad = g.createLinearGradient(0, S, 0, 0);
  grad.addColorStop(0, '#fff0a0');
  grad.addColorStop(0.25, '#ffffff');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = 'rgba(80,20,90,0.18)';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(S / 2, S);
    g.lineTo(S * (0.2 + i * 0.1), S * 0.05);
    g.stroke();
  }
  g.restore();
  return tex(c);
}
