// The browser app: runs the simulation, draws it, and gives you a body, cameras and tools to observe it.
import * as THREE from 'three';
import ontologyYaml from '../../ontology/world.yaml?raw';
import { Simulation } from '../sim/simulation';
import { WorldView } from '../render/worldView';
import { CreatureView, CREATURE_PALETTE, PLAYER_PALETTE, HEAD_LAYER } from '../render/creatureView';
import { CREATURE_DIMS, scaledDims } from '../body/motion';
import { PLAYER_SCALE } from '../body/player';
import type { NodeInst } from '../world/nodes';
import { describe } from '../mind/language/innate';

type Cam = 'eyes' | 'follow' | 'fp' | 'tp' | 'free';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the cartoon colours saturated
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const params = new URLSearchParams(location.search);
const sim = await new Simulation(ontologyYaml, Number(params.get('seed') ?? 1)).init();
const wv = new WorldView(sim.world, renderer);
const creatureView = new CreatureView(CREATURE_DIMS, CREATURE_PALETTE, null, 'creature');
const playerView = new CreatureView(scaledDims(CREATURE_DIMS, PLAYER_SCALE), PLAYER_PALETTE, null, sim.player.node.id);
wv.scene.add(creatureView.root, playerView.root);
creatureView.update(sim.creature.pose);
playerView.update(sim.player.pose);
$('loading').classList.add('gone');

// ------------------------------------------------------------------ cameras

const cam = new THREE.PerspectiveCamera(55, 1, 0.002, 400);
const eyeCam = new THREE.PerspectiveCamera(100, 1, 0.0015, 400);
cam.layers.enable(HEAD_LAYER); // the main camera sees heads; the creature's eye camera does not see its own
let mode: Cam = (params.get('cam') as Cam) || 'follow';
const st = {
  orbitYaw: 2.4, orbitPitch: 0.5, orbitDist: 0.38,
  yaw: Math.PI, pitch: -0.1,
  free: new THREE.Vector3(0.6, 0.35, 0.9), freeYaw: -2.6, freePitch: -0.3,
  pip: true, raw: false, paused: false, scale: 1,
};
const keys = new Set<string>();
const followTarget = new THREE.Vector3();
const eyeQ = new THREE.Quaternion();

// the creature's-eye view goes through a foveation pass: sharp where it looks, blurred and greyer at the edges
const eyeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4 });
const fovea = new THREE.ShaderMaterial({
  uniforms: { tex: { value: eyeRT.texture }, light: { value: 1 }, locked: { value: 0 }, aspect: { value: 1 }, time: { value: 0 }, sleep: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tex; uniform float light; uniform float locked; uniform float aspect; uniform float time; uniform float sleep;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; c.x *= aspect;
      float ecc = length(c);
      float blur = smoothstep(0.04, 0.55, ecc) * 0.012;
      vec4 col = vec4(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236;
        for (int j = 1; j <= 2; j++) {
          vec2 o = vec2(cos(a), sin(a)) * blur * float(j) * 0.5;
          float w = 1.0 / float(j);
          col += texture2D(tex, vUv + o) * w; wsum += w;
        }
      }
      col = mix(texture2D(tex, vUv), col / wsum, smoothstep(0.03, 0.2, ecc));
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      float colorSight = smoothstep(0.12, 0.3, light) * (1.0 - smoothstep(0.35, 0.75, ecc) * 0.55);
      col.rgb = mix(vec3(lum), col.rgb, colorSight);
      col.rgb *= 1.0 - smoothstep(0.42, 0.85, ecc) * 0.75;
      float ring = locked * smoothstep(0.004, 0.0, abs(ecc - 0.03)) * 0.5;
      col.rgb += vec3(1.0, 0.85, 0.5) * ring;
      col.rgb *= 1.0 - sleep;
      gl_FragColor = vec4(col.rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});
const quadScene = new THREE.Scene();
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fovea));
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function updateCameras(dt: number) {
  const cp = sim.creature.pose, pp = sim.player.pose;
  // the creature's eyes: between the two eyes, pointed where it is actually looking
  const eyeMid = new THREE.Vector3((cp.eyes[0].x + cp.eyes[1].x) / 2, (cp.eyes[0].y + cp.eyes[1].y) / 2, (cp.eyes[0].z + cp.eyes[1].z) / 2);
  const g = new THREE.Vector3(Math.sin(cp.gazeYaw) * Math.cos(cp.gazePitch), Math.sin(cp.gazePitch), Math.cos(cp.gazeYaw) * Math.cos(cp.gazePitch));
  eyeCam.position.copy(eyeMid).addScaledVector(g, 0.003);
  const m = new THREE.Matrix4().lookAt(eyeCam.position, eyeCam.position.clone().add(g), new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  // stabilized by default: raw saccades are hard to watch for long
  if (st.raw) eyeQ.copy(q); else eyeQ.slerp(q, 1 - Math.exp(-dt / 0.07));
  eyeCam.quaternion.copy(eyeQ);

  creatureView.hideHead = false;
  playerView.hideHead = mode === 'fp';
  const root = new THREE.Vector3(cp.root.x, cp.root.y, cp.root.z);
  if (mode === 'follow' || mode === 'eyes') {
    followTarget.lerp(root.clone().add(new THREE.Vector3(0, 0.025, 0)), 1 - Math.exp(-dt * 6));
    const off = new THREE.Vector3(Math.sin(st.orbitYaw) * Math.cos(st.orbitPitch), Math.sin(st.orbitPitch), Math.cos(st.orbitYaw) * Math.cos(st.orbitPitch)).multiplyScalar(st.orbitDist);
    cam.position.copy(followTarget).add(off);
    const gy = sim.world.groundY(cam.position.x, cam.position.z) + 0.012;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(followTarget);
  } else if (mode === 'fp') {
    cam.position.set(pp.head.x, pp.head.y + 0.03, pp.head.z);
    cam.rotation.set(st.pitch, st.yaw + Math.PI, 0, 'YXZ');
  } else if (mode === 'tp') {
    const t = new THREE.Vector3(pp.root.x, pp.root.y + 0.16, pp.root.z);
    const f = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    cam.position.copy(t).addScaledVector(f, -0.95);
    const gy = sim.world.groundY(cam.position.x, cam.position.z) + 0.05;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(t.clone().addScaledVector(f, 0.5));
  } else {
    const f = new THREE.Vector3(Math.sin(st.freeYaw) * Math.cos(st.freePitch), Math.sin(st.freePitch), Math.cos(st.freeYaw) * Math.cos(st.freePitch));
    const r = new THREE.Vector3(-Math.cos(st.freeYaw), 0, Math.sin(st.freeYaw));
    const sp = (keys.has('shift') ? 3 : 0.7) * dt;
    if (keys.has('w')) st.free.addScaledVector(f, sp);
    if (keys.has('s')) st.free.addScaledVector(f, -sp);
    if (keys.has('a')) st.free.addScaledVector(r, -sp);
    if (keys.has('d')) st.free.addScaledVector(r, sp);
    if (keys.has('e')) st.free.y += sp;
    if (keys.has('q')) st.free.y -= sp;
    st.free.y = Math.max(st.free.y, sim.world.groundY(st.free.x, st.free.z) + 0.01);
    cam.position.copy(st.free);
    cam.lookAt(st.free.clone().add(f));
  }
  // player controls in its own views
  const inp = sim.player.input;
  inp.yaw = st.yaw;
  inp.pitch = st.pitch;
  const driving = mode === 'fp' || mode === 'tp';
  inp.forward = driving ? (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0) : 0;
  inp.right = driving ? (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) : 0;
  inp.run = keys.has('shift');
}

// ------------------------------------------------------------------ input

document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.cam as Cam)));
function setMode(m: Cam) {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
  if (m !== 'fp' && m !== 'tp' && document.pointerLockElement) document.exitPointerLock();
}
setMode(mode);

const say = $('say') as HTMLInputElement;
window.addEventListener('keydown', (e) => {
  if (document.activeElement === say) {
    if (e.key === 'Escape') say.blur();
    return;
  }
  const k = e.key.toLowerCase();
  keys.add(k === ' ' ? 'space' : k);
  if (k === 'enter') { e.preventDefault(); say.focus(); if (document.pointerLockElement) document.exitPointerLock(); }
  if ('12345'.includes(k) && k.length === 1) setMode((['eyes', 'follow', 'fp', 'tp', 'free'] as Cam[])[Number(k) - 1]);
  if (k === ' ' && (mode === 'fp' || mode === 'tp')) { sim.player.input.jump = true; e.preventDefault(); }
  if (k === 'e' && (mode === 'fp' || mode === 'tp')) toast(sim.player.toggleCarry());
  if (k === 'f' && (mode === 'fp' || mode === 'tp')) sim.player.throwCarried();
  if (k === 'v') st.pip = !st.pip;
  if (k === 'r') { st.raw = !st.raw; toast(st.raw ? 'raw eye motion' : 'stabilized eye view'); }
  if (k === 'h') document.body.classList.toggle('clean');
  if (k === 'p') togglePause();
  if (k === '[') setScale(-1);
  if (k === ']') setScale(1);
  if (k === 'k') toggleKnowledge();
  if (k === 'i') inspectAt(window.innerWidth / 2, window.innerHeight / 2);
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k === ' ' ? 'space' : k); });
window.addEventListener('blur', () => keys.clear());

let down: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
window.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 350;
  if (moved < 5 && quick && e.target === canvas) {
    if ((mode === 'fp' || mode === 'tp') && !document.pointerLockElement) canvas.requestPointerLock();
    else if (document.pointerLockElement) inspectAt(window.innerWidth / 2, window.innerHeight / 2);
    else inspectAt(e.clientX, e.clientY);
  }
  down = null;
});
window.addEventListener('pointermove', (e) => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    st.yaw -= e.movementX * 0.0025;
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * 0.0025, -1.2, 1.2);
    return;
  }
  if (!down || !(e.buttons & 1)) return;
  if (mode === 'follow' || mode === 'eyes') {
    st.orbitYaw -= e.movementX * 0.006;
    st.orbitPitch = THREE.MathUtils.clamp(st.orbitPitch + e.movementY * 0.005, -0.15, 1.4);
  } else if (mode === 'free') {
    st.freeYaw -= e.movementX * 0.004;
    st.freePitch = THREE.MathUtils.clamp(st.freePitch - e.movementY * 0.004, -1.5, 1.5);
  } else {
    st.yaw -= e.movementX * 0.004;
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * 0.004, -1.2, 1.2);
  }
});
canvas.addEventListener('wheel', (e) => {
  st.orbitDist = THREE.MathUtils.clamp(st.orbitDist * Math.exp(e.deltaY * 0.001), 0.07, 4);
}, { passive: true });

$('talk').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = say.value.trim();
  if (!text) return;
  sim.say(text);
  addLine(text, 'you', 'YOU');
  say.value = '';
});

const SCALES = [0.25, 0.5, 1, 2, 4, 8];
function setScale(d: number) {
  const i = Math.max(0, Math.min(SCALES.length - 1, SCALES.indexOf(st.scale) + d));
  st.scale = SCALES[i];
  $('scale').textContent = `${st.scale}×`;
}
function togglePause() { st.paused = !st.paused; $('pause').textContent = st.paused ? '▶' : '❚❚'; }
$('pause').addEventListener('click', togglePause);
$('slower').addEventListener('click', () => setScale(-1));
$('faster').addEventListener('click', () => setScale(1));

let toastEl: HTMLDivElement | null = null;
function toast(msg: string) {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.textContent = msg;
  Object.assign(toastEl.style, { position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.6)', padding: '6px 12px', borderRadius: '8px', zIndex: '9' });
  document.body.appendChild(toastEl);
  const el = toastEl;
  setTimeout(() => el.remove(), 1600);
}

// ------------------------------------------------------------------ inspector: the world's truth, with what the creature has measured highlighted

const raycaster = new THREE.Raycaster();
function inspectAt(x: number, y: number) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, mode === 'eyes' ? eyeCam : cam);
  const hits = raycaster.intersectObjects([...wv.pickables, ...creatureView.pickables, ...playerView.pickables], true);
  for (const h of hits) {
    const id = wv.nodeOf(h);
    if (!id || id === 'ground') continue;
    if (id === 'creature') { toggleKnowledge(true); return; }
    const n = sim.world.nodes.get(id);
    if (n) { showInspector(n); return; }
  }
}

function showInspector(n: NodeInst) {
  const top = n.top;
  const m = sim.mind;
  $('insTitle').textContent = `${top.spec.words[0]} · ${top.id}`;
  const li = (node: NodeInst): string => {
    const measured = m.noticed.has(node.id);
    const c = m.conceptOfNode(node.id);
    const its = c?.name ? ` <span class="name">it calls it “${c.name}”</span>` : c ? ' <span class="name">(seen, unnamed)</span>' : '';
    const label = node.spec.words[0] + (node.spec.key !== node.spec.words[0] ? '' : '');
    const kids = new Map<string, NodeInst[]>();
    for (const ch of node.children) { const k = ch.spec.key; kids.set(k, [...(kids.get(k) ?? []), ch]); }
    const sub = [...kids.values()].map((group) => {
      if (group.length === 1) return li(group[0]);
      const seen = group.filter((g) => m.noticed.has(g.id)).length;
      return `<li><span class="${seen ? 'm' : 'u'}">${group[0].spec.words[0]} ×${group.length}</span> <small>(${seen} noticed)</small>${seen ? `<ul>${li(group.find((g) => m.noticed.has(g.id))!).replace(/^<li>|<\/li>$/g, '')}</ul>` : ''}</li>`;
    }).join('');
    return `<li><span class="${measured || c ? 'm' : 'u'}">${label}</span> <small>${describe(node.spec.looks, node.spec.attrs.color, undefined, false)}</small>${its}${sub ? `<ul>${sub}</ul>` : ''}</li>`;
  };
  $('insTree').innerHTML = li(top);
  $('inspector').hidden = false;
}
$('insClose').addEventListener('click', () => ($('inspector').hidden = true));

function toggleKnowledge(force?: boolean) {
  const el = $('knowledge');
  el.hidden = force === undefined ? !el.hidden : !force;
  if (!el.hidden) $('kList').innerHTML = sim.mind.knowledge().reverse().map((r) => `<li>${r}</li>`).join('') || '<li>nothing yet</li>';
}
$('kbtn').addEventListener('click', () => toggleKnowledge());
$('kClose').addEventListener('click', () => toggleKnowledge(false));

// ------------------------------------------------------------------ HUD

const thoughtsEl = $('thoughts');
function addLine(text: string, cls: string, tag: string) {
  const li = document.createElement('li');
  li.className = cls;
  const h = sim.world.clock.hour;
  const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
  li.innerHTML = `<span class="t">day ${sim.world.clock.day + 1} · ${hh}:${mm}<span class="i">${tag}</span></span>`;
  li.appendChild(document.createTextNode(text));
  thoughtsEl.prepend(li);
  while (thoughtsEl.children.length > 60) thoughtsEl.lastChild!.remove();
}
sim.onThought = (t) => addLine(t.text, t.aloud ? 'aloud' : 'thought', t.aloud ? 'says' : t.intent.toLowerCase().replace(/_/g, ' '));

const totalKinds = new Set<string>();
for (const e of Object.values(sim.ont.entities)) {
  const walk = (p: typeof e) => { totalKinds.add(p.words[0]); p.parts.forEach(walk); };
  walk(e);
}
function meters(el: HTMLElement, vals: Record<string, number>, invert: string[] = []) {
  el.innerHTML = Object.entries(vals).map(([k, v]) => `<div class="meter"><span>${k}</span><div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;${invert.includes(k) ? 'background:var(--bad)' : ''}"></i></div><span class="n">${v.toFixed(2)}</span></div>`).join('');
}
function hud() {
  const r = sim.lastReport;
  const w = sim.world;
  const h = w.clock.hour;
  $('clock').textContent = `day ${w.clock.day + 1} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  if (!r) return;
  $('focus').textContent = r.focus ? `${r.focus.label}` : '—';
  $('behavior').textContent = r.behavior;
  const gc = r.gaze.target ? sim.mind.conceptOfNode(r.gaze.target) : undefined;
  $('gaze').textContent = `${r.gaze.mode}${r.gaze.target ? ' · ' + (gc?.name ?? r.gaze.target.split('/').pop()) : ''}`;
  ($('interest').firstElementChild as HTMLElement).style.width = `${Math.round(r.gaze.interest * 100)}%`;
  meters($('drives'), r.drives, ['hunger', 'thirst', 'safety']);
  meters($('feelings'), r.feelings, ['fear']);
  const b = sim.creature.bio;
  meters($('bodystate'), { energy: b.energy, hydration: b.hydration, health: b.health, pain: b.pain, nausea: b.nausea }, ['pain', 'nausea']);
  $('salience').innerHTML = r.salience.slice(0, 5).map((s) => `<li><span>${s.label}</span><span>${s.score.toFixed(2)}</span></li>`).join('');
  const named = sim.mind.mem.named();
  $('named').innerHTML = named.map((c) => `<span class="${c.isPart ? 'part' : ''}">${c.name}</span>`).join('');
  $('disc').textContent = `${named.length} / ${totalKinds.size}`;
  if (!$('knowledge').hidden) $('kList').innerHTML = sim.mind.knowledge().reverse().map((x) => `<li>${x}</li>`).join('');
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let hudT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!st.paused) sim.advance(dt * st.scale, Math.ceil(8 * st.scale));
  updateCameras(dt);
  wv.update(dt);
  wv.updateEnvironment();
  creatureView.update(sim.creature.pose);
  playerView.update(sim.player.pose);
  wv.focusShadows(mode === 'fp' || mode === 'tp' ? new THREE.Vector3(sim.player.pose.root.x, sim.player.pose.root.y, sim.player.pose.root.z) : mode === 'free' ? st.free : followTarget);

  const W = window.innerWidth, H = window.innerHeight;
  const pr = renderer.getPixelRatio();
  fovea.uniforms.light.value = sim.world.lightAt(sim.creature.pose.head);
  fovea.uniforms.locked.value = sim.mind.eye.locked ? 1 : 0;
  fovea.uniforms.sleep.value = sim.creature.pose.blink * 0.92;
  const drawEye = (x: number, y: number, w: number, h: number) => {
    const rw = Math.round(w * pr), rh = Math.round(h * pr);
    if (eyeRT.width !== rw || eyeRT.height !== rh) eyeRT.setSize(rw, rh);
    eyeCam.aspect = w / h;
    eyeCam.updateProjectionMatrix();
    fovea.uniforms.aspect.value = w / h;
    renderer.setRenderTarget(eyeRT);
    renderer.render(wv.scene, eyeCam);
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.render(quadScene, quadCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
  };
  if (mode === 'eyes') {
    drawEye(0, 0, W, H);
    $('pipLabel').style.display = 'none';
  } else {
    renderer.setRenderTarget(null);
    renderer.render(wv.scene, cam);
    if (st.pip) {
      const pw = Math.round(Math.min(380, W * 0.28)), ph = Math.round(pw * 0.62);
      const px = W - pw - 330, py = 76;
      drawEye(Math.max(10, px), py, pw, ph);
      const lbl = $('pipLabel');
      lbl.style.display = 'block';
      lbl.style.left = `${Math.max(10, px) + 8}px`;
      lbl.style.bottom = `${py + ph - 20}px`;
    } else $('pipLabel').style.display = 'none';
  }

  hudT += dt;
  if (hudT > 0.12) { hudT = 0; hud(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for debugging and automated checks
(window as any).sim = sim;
(window as any).setMode = setMode;
(window as any).st = st;
