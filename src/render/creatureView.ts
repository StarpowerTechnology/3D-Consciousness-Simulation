// L0 RENDER: the creature's body, drawn from the motion layer's pose (blueprint 14.4–14.6).
// Shell-textured fur, eyeballs with a live pupil and a wet cornea, lids that blink and follow the gaze.
import * as THREE from 'three';
import { bodyFrame, type CreaturePose, type RigDims } from '../body/motion';
import { Tube, shapedSphere } from './geom';
import { Rng } from '../util/rng';

export interface Palette { fur: string; belly: string; skin: string; iris: [number, number, number]; nose: string; shells: number }

/** Objects on this layer are hidden from the creature's own eye camera. */
export const HEAD_LAYER = 1;

function tailRings(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 256; y++) { const v = 128 + 90 * Math.sin(y * 0.9); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 16, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const CREATURE_PALETTE: Palette = { fur: '#9a6236', belly: '#f0dcb8', skin: '#c48a7c', iris: [120, 70, 25], nose: '#2a1a16', shells: 14 };
export const PLAYER_PALETTE: Palette = { fur: '#6f7a86', belly: '#c9cfd6', skin: '#b58a86', iris: [70, 140, 70], nose: '#1b1d22', shells: 12 };

function furColorMap(top: string, bottom: string, seed: number): THREE.CanvasTexture {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, top);
  grad.addColorStop(0.78, bottom);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const r = new Rng(seed);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${r.chance(0.5) ? '255,240,210' : '30,18,8'},${r.range(0.03, 0.09)})`;
    g.fillRect(r.range(0, W), r.range(0, H), r.range(1, 3), r.range(3, 9));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let strandTex: THREE.DataTexture | null = null;
function strands(): THREE.DataTexture {
  if (strandTex) return strandTex;
  const S = 256;
  const d = new Uint8Array(S * S * 4);
  const r = new Rng(21);
  for (let i = 0; i < S * S; i++) {
    const v = Math.pow(r.next(), 0.7) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  strandTex = new THREE.DataTexture(d, S, S);
  strandTex.wrapS = strandTex.wrapT = THREE.RepeatWrapping;
  strandTex.magFilter = THREE.NearestFilter;
  strandTex.minFilter = THREE.NearestFilter;
  strandTex.needsUpdate = true;
  return strandTex;
}

/** Fur by shells: the same geometry drawn N times, pushed out along the normal, with strands cut by noise. */
function furMaterial(map: THREE.Texture, len: number, shells: number, density: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.furLen = { value: len };
    sh.uniforms.shells = { value: shells };
    sh.uniforms.strands = { value: strands() };
    sh.uniforms.density = { value: density };
    sh.vertexShader = 'uniform float furLen;\nuniform float shells;\nvarying float vShell;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float shF = float(gl_InstanceID) / shells;
       vShell = shF;
       transformed += normalize(objectNormal) * shF * furLen;
       transformed.y -= shF * shF * furLen * 0.3;`,
    );
    sh.fragmentShader = 'uniform sampler2D strands;\nuniform float density;\nvarying float vShell;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float st = texture2D(strands, vMapUv * density).r;
       if (vShell > 0.001 && st < vShell * 1.05) discard;
       diffuseColor.rgb *= mix(0.42, 1.08, vShell);`,
    );
  };
  m.customProgramCacheKey = () => `fur-${len}-${shells}-${density}`;
  return m;
}

function furred(geom: THREE.BufferGeometry, mat: THREE.Material, shells: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geom, mat, shells + 1);
  const I = new THREE.Matrix4();
  for (let i = 0; i <= shells; i++) m.setMatrixAt(i, I);
  m.frustumCulled = false;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

interface Eye { socket: THREE.Group; ball: THREE.Group; pupil: THREE.Mesh; upper: THREE.Mesh; lower: THREE.Mesh }

export class CreatureView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  private neck: Tube;
  private legs: Tube[] = [];
  private paws: THREE.Mesh[] = [];
  private tail: Tube;
  private eyes: Eye[] = [];
  private ears: THREE.Group[] = [];
  private tongue: THREE.Mesh;
  private bodyMesh: THREE.InstancedMesh;
  readonly pickables: THREE.Object3D[] = [];
  hideHead = false;

  constructor(private d: RigDims, pal: Palette, envMap: THREE.Texture | null, nodeId: string) {
    const s = d.scale;
    const map = furColorMap(pal.fur, pal.belly, Math.round(s * 10));
    const fur = furMaterial(map, 0.0032 * s, pal.shells, 6);
    const furShort = furMaterial(map, 0.0016 * s, Math.round(pal.shells * 0.6), 9);
    const skin = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.6 });

    // body: an ellipsoid, fuller at the hips, with a belly
    const L = 0.05 * s, W = 0.023 * s, H = 0.022 * s;
    const bodyGeo = shapedSphere(40, 28, (v) => {
      const rear = Math.max(0, -v.z), front = Math.max(0, v.z);
      return new THREE.Vector3(v.x * W * (1 + 0.18 * rear - 0.15 * front), v.y * H * (1 + 0.1 * rear - 0.12 * front) - (v.y < 0 ? 0.002 * s : 0), v.z * L);
    });
    this.bodyMesh = furred(bodyGeo, fur, pal.shells);
    this.body.add(this.bodyMesh);
    this.root.add(this.body);

    // head: a sphere drawn out into a snout
    const headGeo = shapedSphere(36, 26, (v) => {
      const f = Math.max(0, v.z);
      const r = 0.0165 * s;
      return new THREE.Vector3(v.x * r * (1 - 0.42 * f), v.y * r * 0.92 * (1 - 0.38 * f) - f * f * 0.002 * s, v.z * r * (v.z > 0 ? 1.55 : 1.0));
    });
    const headMesh = furred(headGeo, furShort, Math.round(pal.shells * 0.6));
    this.head.add(headMesh);
    this.root.add(this.head);

    // nose, whiskers, tongue
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0028 * s, 16, 12), new THREE.MeshPhysicalMaterial({ color: pal.nose, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 }));
    nose.position.set(0, -0.0012 * s, 0.0252 * s);
    nose.scale.set(1.2, 0.9, 0.8);
    this.head.add(nose);
    const wPts: number[] = [];
    const wr = new Rng(3 + Math.round(s));
    for (const side of [-1, 1])
      for (let i = 0; i < 6; i++) {
        const sx = side * 0.004 * s, sy = -0.002 * s + i * 0.0005 * s, sz = 0.021 * s;
        const len = (0.02 + wr.range(0, 0.012)) * s;
        const a = side * (0.6 + i * 0.12), b = wr.range(-0.3, 0.25);
        wPts.push(sx, sy, sz, sx + Math.sin(a) * len, sy + b * len * 0.5, sz + Math.cos(a) * len * 0.35);
      }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wPts, 3));
    this.head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#e9e2d6', transparent: true, opacity: 0.55 })));
    this.tongue = new THREE.Mesh(new THREE.CapsuleGeometry(0.0018 * s, 0.006 * s, 4, 8), new THREE.MeshStandardMaterial({ color: '#d9737a', roughness: 0.35 }));
    this.tongue.rotation.x = Math.PI / 2;
    this.tongue.position.set(0, -0.0045 * s, 0.018 * s);
    this.head.add(this.tongue);

    // eyes
    const irisMap = (() => {
      const S = 256;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d')!;
      const [r, gg, b] = pal.iris;
      const grad = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
      grad.addColorStop(0, `rgb(${r * 0.4},${gg * 0.4},${b * 0.4})`);
      grad.addColorStop(0.4, `rgb(${r},${gg},${b})`);
      grad.addColorStop(0.85, `rgb(${r * 0.7},${gg * 0.6},${b * 0.5})`);
      grad.addColorStop(1, '#120a05');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      const rr = new Rng(8);
      for (let i = 0; i < 220; i++) {
        const a = rr.range(0, Math.PI * 2);
        g.strokeStyle = `rgba(${rr.chance(0.5) ? '255,210,150' : '20,10,4'},${rr.range(0.1, 0.3)})`;
        g.beginPath();
        g.moveTo(S / 2 + Math.cos(a) * S * 0.12, S / 2 + Math.sin(a) * S * 0.12);
        g.lineTo(S / 2 + Math.cos(a) * S * 0.47, S / 2 + Math.sin(a) * S * 0.47);
        g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const er = 0.0054 * s; // a little larger than life: cartoon eyes read better at a distance
    const cap = (radius: number, theta: number, planarUv: boolean) => {
      const g = new THREE.SphereGeometry(radius, 32, 12, 0, Math.PI * 2, 0, theta);
      g.rotateX(Math.PI / 2); // pole toward +z
      if (planarUv) {
        const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
        const R = radius * Math.sin(theta);
        for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * R), 0.5 + p.getY(i) / (2 * R));
      }
      return g;
    };
    const sclera = new THREE.MeshStandardMaterial({ color: '#4a3226', roughness: 0.35 });
    const irisMat = new THREE.MeshStandardMaterial({ map: irisMap, roughness: 0.4 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: '#050302', roughness: 0.2 });
    const cornea = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, roughness: 0.0, metalness: 0, clearcoat: 1, clearcoatRoughness: 0, envMap, envMapIntensity: 3, specularIntensity: 1, depthWrite: false });
    const lidMat = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const socket = new THREE.Group();
      socket.position.set(side * 0.0088 * s, 0.0058 * s, 0.0118 * s);
      socket.rotation.y = side * 0.5; // eyes sit a little to the sides
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(new THREE.SphereGeometry(er, 28, 20), sclera));
      ball.add(new THREE.Mesh(cap(er * 1.003, 1.05, true), irisMat));
      const pupil = new THREE.Mesh(cap(er * 1.006, 0.42, false), pupilMat);
      ball.add(pupil);
      ball.add(new THREE.Mesh(cap(er * 1.07, 1.05, false), cornea));
      // a catchlight: the small white glint that makes cartoon eyes look alive
      const glint = new THREE.Mesh(new THREE.SphereGeometry(er * 0.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      glint.position.set(er * 0.32, er * 0.38, er * 0.98);
      ball.add(glint);
      socket.add(ball);
      const upper = new THREE.Mesh(new THREE.SphereGeometry(er * 1.16, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), lidMat);
      const lower = new THREE.Mesh(new THREE.SphereGeometry(er * 1.14, 24, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), lidMat);
      socket.add(upper, lower);
      this.head.add(socket);
      this.eyes.push({ socket, ball, pupil, upper, lower });
    }

    // ears: thin cupped discs with pink insides
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.0098 * s, 0.0118 * s, -0.003 * s);
      const outer = new THREE.Mesh(shapedSphere(20, 14, (v) => new THREE.Vector3(v.x * 0.0105 * s, v.y * 0.0118 * s + 0.009 * s, v.z * 0.0024 * s - Math.abs(v.x) * 0.002 * s)), new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
      const inner = new THREE.Mesh(shapedSphere(16, 12, (v) => new THREE.Vector3(v.x * 0.0078 * s, v.y * 0.0088 * s + 0.0092 * s, v.z * 0.0012 * s + 0.0016 * s)), new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.55 }));
      outer.castShadow = true;
      g.add(outer, inner);
      this.head.add(g);
      this.ears.push(g);
    }

    // neck, legs, tail: tubes rebuilt from the pose every frame
    this.neck = new Tube(6, 14, false);
    this.root.add(furred(this.neck.geometry, fur, Math.round(pal.shells * 0.8)));
    for (let i = 0; i < 4; i++) {
      const t = new Tube(8, 10);
      this.legs.push(t);
      this.root.add(furred(t.geometry, furShort, 5));
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.0042 * s, 12, 8), skin);
      paw.scale.set(1, 0.45, 1.4);
      paw.castShadow = true;
      this.paws.push(paw);
      this.root.add(paw);
    }
    this.tail = new Tube(16, 8);
    const tailMesh = new THREE.Mesh(this.tail.geometry, new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.55, bumpMap: tailRings(), bumpScale: 1.5 }));
    tailMesh.castShadow = true;
    tailMesh.frustumCulled = false;
    this.root.add(tailMesh);

    this.root.traverse((o) => { o.userData.nodeId = nodeId; });
    if (nodeId === 'creature') this.head.traverse((o) => o.layers.set(HEAD_LAYER)); // only its own head is hidden from its own eyes
    this.pickables.push(this.bodyMesh, headMesh);
  }

  update(p: CreaturePose) {
    const s = this.d.scale;
    this.body.position.set(p.root.x, p.root.y, p.root.z);
    this.body.rotation.set(-p.bodyPitch, p.heading, p.bodyRoll, 'YXZ');
    const br = 1 + 0.035 * p.breathe;
    this.body.scale.set(br, br, 1 + 0.01 * p.breathe);

    this.head.position.set(p.head.x, p.head.y, p.head.z);
    this.head.rotation.set(-p.headPitch, p.headYaw, 0, 'YXZ');
    this.head.visible = !this.hideHead;

    // neck from the chest to the back of the head
    const fw = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    // anchored inside the chest through the same body frame the motion layer uses, so the neck stays attached on slopes
    const c0 = bodyFrame({ x: 0, y: 0.006 * s, z: 0.032 * s }, p.root, p.heading, p.bodyPitch, p.bodyRoll);
    const chest = new THREE.Vector3(c0.x, c0.y, c0.z);
    const hf = new THREE.Vector3(Math.sin(p.headYaw) * Math.cos(p.headPitch), Math.sin(p.headPitch), Math.cos(p.headYaw) * Math.cos(p.headPitch));
    const nape = new THREE.Vector3(p.head.x, p.head.y - 0.002 * s, p.head.z).addScaledVector(hf, -0.008 * s);
    const mid = chest.clone().lerp(nape, 0.5).add(new THREE.Vector3(0, 0.003 * s, 0));
    this.neck.update([chest, mid, nape], [0.0175 * s, 0.015 * s, 0.0135 * s]);

    // legs: hip → knee → foot, thinner at the bottom; paws planted where the feet are
    for (let i = 0; i < 4; i++) {
      const hip = p.hips[i], knee = p.knees[i], foot = p.feet[i];
      if (!hip || !knee || !foot) continue;
      const front = i < 2;
      this.legs[i].update([hip, knee, { x: foot.x, y: foot.y + 0.003 * s, z: foot.z }], front ? [0.0075 * s, 0.0042 * s, 0.003 * s] : [0.0095 * s, 0.005 * s, 0.0032 * s]);
      this.paws[i].position.set(foot.x + fw.x * 0.002 * s, foot.y + 0.0015 * s, foot.z + fw.z * 0.002 * s);
      this.paws[i].rotation.y = p.heading;
    }
    if (p.tail.length) this.tail.update(p.tail, [0.0055 * s, 0.003 * s, 0.0014 * s]);

    // ears turn toward sounds and flatten when scared
    this.ears.forEach((g, e) => {
      const side = e === 0 ? -1 : 1;
      g.rotation.set(-0.25 + p.ears[e].pitch * 0.8, p.ears[e].yaw * 0.6 + side * 0.25, side * (0.35 - p.earsFlat * 0.6), 'YXZ');
    });

    // eyes: each turns to the fixated point (vergence) or along the gaze; lids follow and blink
    const gz = new THREE.Vector3(Math.sin(p.gazeYaw) * Math.cos(p.gazePitch), Math.sin(p.gazePitch), Math.cos(p.gazeYaw) * Math.cos(p.gazePitch));
    this.head.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    const eyePitch = p.gazePitch - p.headPitch;
    this.eyes.forEach((e, i) => {
      e.socket.getWorldPosition(tmp);
      const target = p.fixation && tmp.distanceTo(p.fixation as THREE.Vector3) < 1.5 ? new THREE.Vector3(p.fixation.x, p.fixation.y, p.fixation.z) : tmp.clone().addScaledVector(gz, 1);
      e.ball.lookAt(target);
      // keep the eye inside its range in the socket
      e.ball.rotation.x = THREE.MathUtils.clamp(e.ball.rotation.x, -0.6, 0.6);
      e.ball.rotation.y = THREE.MathUtils.clamp(e.ball.rotation.y, -0.75, 0.75);
      const ps = 0.55 + 0.75 * p.pupil;
      e.pupil.scale.set(ps, ps, 1);
      const open = 1 - p.blink;
      const squint = p.squint * 0.35;
      e.upper.rotation.x = -0.95 * open + 0.62 * (1 - open) + squint - eyePitch * 0.6;
      e.lower.rotation.x = 0.35 * open - 0.1 * (1 - open) - squint * 0.5 - eyePitch * 0.25;
      void i;
    });
    this.tongue.scale.set(1, 1 + p.tongue * 1.6, 1);
    this.tongue.position.z = (0.017 + p.tongue * 0.008) * s;
    this.tongue.visible = p.tongue > 0.03;
  }
}
