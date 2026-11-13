// The browser app: runs the simulation, draws it in one or two views, and gives an observer the tools to follow it:
// docked, minimizable panels; a timeline to pause, scrub and replay; any creature to follow or see through; and an
// overlay of what the creature's eyes are measuring.
import * as THREE from 'three';
import ontologyYaml from '../../ontology/world.yaml?raw';
import { Simulation } from '../sim/simulation';
import { WorldView } from '../render/worldView';
import { CreatureView, CREATURE_PALETTE, PLAYER_PALETTE, HEAD_LAYER } from '../render/creatureView';
import { CREATURE_DIMS, scaledDims } from '../body/motion';
import { PLAYER_SCALE } from '../body/player';
import type { NodeInst } from '../world/nodes';
import type { MindReport, ThoughtRecord } from '../protocol/types';
import { describe } from '../mind/language/innate';
import { Recorder, type Snap } from './recorder';
import { listSubjects, type Subject } from './subjects';
import { drawMeasurements, type Rect } from './overlay';

type Cam = 'eyes' | 'follow' | 'fp' | 'tp' | 'free';
type Layout = 'single' | 'split' | 'pip';
interface Pane { cam: Cam; rect: Rect; role: 'main' | 'second' }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get(k: string): string | null { try { return localStorage.getItem('cs:' + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem('cs:' + k, v); } catch { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ renderer and world

const canvas = $('view') as HTMLCanvasElement;
const overlay = $('overlay') as HTMLCanvasElement;
const og = overlay.getContext('2d')!;
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the cartoon colours saturated
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const params = new URLSearchParams(location.search);
const sim = await new Simulation(ontologyYaml, Number(params.get('seed') ?? 1)).init();
const wv = new WorldView(sim.world, renderer);
const creatureView = new CreatureView(CREATURE_DIMS, CREATURE_PALETTE, null, 'creature');
const playerView = new CreatureView(scaledDims(CREATURE_DIMS, PLAYER_SCALE), PLAYER_PALETTE, null, sim.player.node.id);
wv.scene.add(creatureView.root, playerView.root);
creatureView.update(sim.creature.pose);
playerView.update(sim.player.pose);
const rec = new Recorder(sim);
const subjects = listSubjects(sim);
$('loading').classList.add('gone');

// ------------------------------------------------------------------ state

const st = {
  subject: subjects.find((s) => s.id === params.get('subject')) ?? subjects[0],
  main: ((params.get('cam') as Cam) || (store.get('main') as Cam) || 'follow') as Cam,
  second: ((store.get('second') as Cam) || 'eyes') as Cam,
  layout: ((params.get('layout') as Layout) || (store.get('layout') as Layout) || 'pip') as Layout,
  overlay: store.get('overlay') !== '0',
  orbitYaw: 2.4, orbitPitch: 0.5, orbitZoom: 1,
  yaw: Math.PI, pitch: -0.1,
  free: new THREE.Vector3(0.6, 0.35, 0.9), freeYaw: -2.6, freePitch: -0.3,
  raw: false, paused: false, playing: true, scale: 1,
};
const keys = new Set<string>();
const followTarget = new THREE.Vector3();
let followFor = '';

const cams: Record<string, THREE.PerspectiveCamera> = {};
function camFor(key: string) {
  if (!cams[key]) cams[key] = new THREE.PerspectiveCamera(55, 1, 0.0015, 400);
  return cams[key];
}
const eyeQ = new Map<string, THREE.Quaternion>();

// the eye view goes through a foveation pass: sharp where it looks, blurred and greyer at the edges
const eyeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4 });
const fovea = new THREE.ShaderMaterial({
  uniforms: { tex: { value: eyeRT.texture }, light: { value: 1 }, locked: { value: 0 }, aspect: { value: 1 }, sleep: { value: 0 }, under: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tex; uniform float light; uniform float locked; uniform float aspect; uniform float sleep; uniform float under;
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
      col.rgb = mix(col.rgb, col.rgb * vec3(0.55, 0.95, 1.0), under);
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

let W = 1, H = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width));
  H = Math.max(1, Math.round(r.height));
  renderer.setSize(W, H, false);
  const pr = window.devicePixelRatio || 1;
  overlay.width = Math.round(W * pr);
  overlay.height = Math.round(H * pr);
  og.setTransform(pr, 0, 0, pr, 0, 0);
  lastPaneKey = '';
}
let lastPaneKey = '';
new ResizeObserver(resize).observe(stage);
resize();

// ------------------------------------------------------------------ layout: which views are on screen, and where

function panes(): Pane[] {
  const main: Pane = { cam: st.main, rect: { x: 0, y: 0, w: W, h: H }, role: 'main' };
  if (st.layout === 'single') return [main];
  if (st.layout === 'split') {
    const half = Math.floor(W / 2);
    main.rect = { x: 0, y: 0, w: half - 1, h: H };
    return [main, { cam: st.second, rect: { x: half + 1, y: 0, w: W - half - 1, h: H }, role: 'second' }];
  }
  const pw = Math.round(Math.min(420, W * 0.34)), ph = Math.round(pw * 0.62);
  return [main, { cam: st.second, rect: { x: W - pw - 12, y: 12, w: pw, h: ph }, role: 'second' }];
}

function paneAt(x: number, y: number): Pane {
  const ps = panes();
  for (let i = ps.length - 1; i >= 0; i--) {
    const r = ps[i].rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return ps[i];
  }
  return ps[0];
}

const CAM_NAME: Record<Cam, string> = { eyes: 'through its eyes', follow: 'following', free: 'free camera', fp: 'you · first person', tp: 'you · third person' };
function paneTitle(p: Pane): string {
  if (p.cam === 'fp' || p.cam === 'tp' || p.cam === 'free') return CAM_NAME[p.cam];
  return `${st.subject.label} · ${CAM_NAME[p.cam]}`;
}

// ------------------------------------------------------------------ cameras

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

function aimEye(cam: THREE.PerspectiveCamera, s: Subject, dt: number) {
  const e = s.eye();
  const g = new THREE.Vector3(Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), Math.cos(e.yaw) * Math.cos(e.pitch));
  cam.fov = e.fov;
  cam.position.copy(v3(e.pos)).addScaledVector(g, s.size * 0.025);
  const m = new THREE.Matrix4().lookAt(cam.position, cam.position.clone().add(g), new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  let cur = eyeQ.get(s.id);
  if (!cur) { cur = q.clone(); eyeQ.set(s.id, cur); }
  // stabilized by default: raw saccades are hard to watch for long
  if (st.raw || rec.reviewing) cur.copy(q); else cur.slerp(q, 1 - Math.exp(-dt / 0.07));
  cam.quaternion.copy(cur);
  // the creature does not see its own head
  cam.layers.set(0);
  if (s.kind !== 'creature') cam.layers.enable(HEAD_LAYER);
}

function aimCamera(p: Pane, cam: THREE.PerspectiveCamera, dt: number) {
  const s = st.subject, pp = sim.player.pose;
  cam.fov = 55;
  cam.layers.set(0);
  cam.layers.enable(HEAD_LAYER);
  if (p.cam === 'eyes') return aimEye(cam, s, dt);
  if (p.cam === 'follow') {
    const at = v3(s.pos()).add(new THREE.Vector3(0, s.size * 0.2, 0));
    if (followFor !== s.id) { followTarget.copy(at); followFor = s.id; }
    followTarget.lerp(at, 1 - Math.exp(-dt * 6));
    const dist = st.orbitZoom * Math.max(0.05, s.size * 3.1);
    const off = new THREE.Vector3(Math.sin(st.orbitYaw) * Math.cos(st.orbitPitch), Math.sin(st.orbitPitch), Math.cos(st.orbitYaw) * Math.cos(st.orbitPitch)).multiplyScalar(dist);
    cam.position.copy(followTarget).add(off);
    const gy = sim.world.groundY(cam.position.x, cam.position.z) + Math.min(0.012, dist * 0.05);
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(followTarget);
  } else if (p.cam === 'fp') {
    cam.position.set(pp.head.x, pp.head.y + 0.03, pp.head.z);
    cam.rotation.set(st.pitch, st.yaw + Math.PI, 0, 'YXZ');
  } else if (p.cam === 'tp') {
    const t = new THREE.Vector3(pp.root.x, pp.root.y + 0.16, pp.root.z);
    const f = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    cam.position.copy(t).addScaledVector(f, -0.95);
    const gy = sim.world.groundY(cam.position.x, cam.position.z) + 0.05;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(t.clone().addScaledVector(f, 0.5));
  } else {
    cam.position.copy(st.free);
    const f = new THREE.Vector3(Math.sin(st.freeYaw) * Math.cos(st.freePitch), Math.sin(st.freePitch), Math.cos(st.freeYaw) * Math.cos(st.freePitch));
    cam.lookAt(st.free.clone().add(f));
  }
}

const driving = () => st.main === 'fp' || st.main === 'tp';

function moveFree(dt: number) {
  if (!panes().some((p) => p.cam === 'free') || driving()) return;
  const f = new THREE.Vector3(Math.sin(st.freeYaw) * Math.cos(st.freePitch), Math.sin(st.freePitch), Math.cos(st.freeYaw) * Math.cos(st.freePitch));
  const r = new THREE.Vector3(-Math.cos(st.freeYaw), 0, Math.sin(st.freeYaw));
  const sp = (keys.has('shift') ? 4 : 0.9) * dt;
  if (keys.has('w')) st.free.addScaledVector(f, sp);
  if (keys.has('s')) st.free.addScaledVector(f, -sp);
  if (keys.has('a')) st.free.addScaledVector(r, -sp);
  if (keys.has('d')) st.free.addScaledVector(r, sp);
  if (keys.has('e')) st.free.y += sp;
  if (keys.has('q')) st.free.y -= sp;
  st.free.y = Math.max(st.free.y, sim.world.groundY(st.free.x, st.free.z) + 0.01);
}

function drivePlayer() {
  const inp = sim.player.input;
  inp.yaw = st.yaw;
  inp.pitch = st.pitch;
  const on = driving() && !rec.reviewing;
  inp.forward = on ? (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0) : 0;
  inp.right = on ? (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) : 0;
  inp.run = keys.has('shift');
}

// ------------------------------------------------------------------ drawing one pane

function renderPane(p: Pane, dt: number, report: MindReport | null, snap: Snap | null) {
  const cam = camFor(p.role);
  cam.aspect = p.rect.w / p.rect.h;
  aimCamera(p, cam, dt);
  cam.updateProjectionMatrix();
  // the visitor's head is hidden only when seeing through the visitor's eyes
  playerView.head.visible = !(p.cam === 'fp' || (p.cam === 'eyes' && st.subject.kind === 'visitor'));
  const under = wv.isUnderwater(cam.position);
  wv.setUnderwater(under);
  const { x, w, h } = p.rect;
  const y = H - p.rect.y - p.rect.h; // WebGL viewports start at the bottom
  if (p.cam === 'eyes') {
    const pr = renderer.getPixelRatio();
    const rw = Math.round(w * pr), rh = Math.round(h * pr);
    if (eyeRT.width !== rw || eyeRT.height !== rh) eyeRT.setSize(rw, rh);
    renderer.setRenderTarget(eyeRT);
    renderer.clear();
    renderer.render(wv.scene, cam);
    renderer.setRenderTarget(null);
    const kind = st.subject.kind;
    fovea.uniforms.light.value = sim.world.lightAt(st.subject.eye().pos);
    fovea.uniforms.locked.value = kind === 'creature' && report && report.gaze.mode !== 'scan' ? 1 : 0;
    fovea.uniforms.sleep.value = kind === 'creature' ? sim.creature.pose.blink * 0.92 : kind === 'visitor' ? sim.player.pose.blink * 0.92 : 0;
    fovea.uniforms.aspect.value = w / h;
    fovea.uniforms.under.value = under ? 1 : 0;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.render(quadScene, quadCam);
    renderer.setScissorTest(false);
    if (st.overlay && st.subject.hasMind) {
      const measured = rec.reviewing ? snap?.measured ?? [] : rec.measured();
      drawMeasurements(og, p.rect, cam, sim.world, measured, report);
    }
  } else {
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(wv.scene, cam);
    renderer.setScissorTest(false);
  }
  wv.setUnderwater(false);
}

function paneDecor(ps: Pane[]) {
  const key = ps.map((p) => `${p.cam}:${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}`).join('|') + st.subject.id + st.layout;
  if (key === lastPaneKey) return;
  lastPaneKey = key;
  $('paneLabels').innerHTML = ps.map((p) => {
    const frame = st.layout === 'pip' && p.role === 'second' ? `<div class="paneFrame" style="left:${p.rect.x - 2}px;top:${p.rect.y - 2}px;width:${p.rect.w + 4}px;height:${p.rect.h + 4}px"></div>` : '';
    const div = st.layout === 'split' && p.role === 'second' ? `<div class="paneDivider" style="left:${p.rect.x - 2}px"></div>` : '';
    return `${frame}${div}<div class="paneLabel" style="left:${p.rect.x + 10}px;top:${p.rect.y + 10}px">${paneTitle(p)}</div>`;
  }).join('');
}

// ------------------------------------------------------------------ controls: top bar

const subjectSel = $('subject') as HTMLSelectElement;
const groups: Record<string, Subject[]> = {};
for (const s of subjects) (groups[s.kind] ??= []).push(s);
const GROUP_NAME: Record<string, string> = { creature: 'Minds', visitor: 'You', ant: 'Ants', butterfly: 'Butterflies' };
subjectSel.innerHTML = Object.entries(groups).map(([k, list]) => `<optgroup label="${GROUP_NAME[k]}">${list.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</optgroup>`).join('');
function setSubject(s: Subject) {
  st.subject = s;
  subjectSel.value = s.id;
  lastPaneKey = '';
  updateMindPanel();
}
subjectSel.addEventListener('change', () => setSubject(subjects.find((s) => s.id === subjectSel.value)!));

function setMain(m: Cam) {
  st.main = m;
  store.set('main', m);
  document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
  if (!driving() && document.pointerLockElement) document.exitPointerLock();
  if (st.layout !== 'single' && st.second === m) setSecond(m === 'eyes' ? 'follow' : 'eyes');
}
document.querySelectorAll<HTMLButtonElement>('#cams button').forEach((b) => b.addEventListener('click', () => setMain(b.dataset.cam as Cam)));

function setLayout(l: Layout) {
  st.layout = l;
  store.set('layout', l);
  document.querySelectorAll<HTMLButtonElement>('#layouts button').forEach((b) => b.classList.toggle('on', b.dataset.layout === l));
  $('secondWrap').style.display = l === 'single' ? 'none' : '';
  if (l !== 'single' && st.second === st.main) setSecond(st.main === 'eyes' ? 'follow' : 'eyes');
}
document.querySelectorAll<HTMLButtonElement>('#layouts button').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout as Layout)));

const secondSel = $('second') as HTMLSelectElement;
function setSecond(c: Cam) { st.second = c; secondSel.value = c; store.set('second', c); }
secondSel.addEventListener('change', () => setSecond(secondSel.value as Cam));

function setOverlay(on: boolean) {
  st.overlay = on;
  store.set('overlay', on ? '1' : '0');
  $('overlayBtn').classList.toggle('on', on);
}
$('overlayBtn').addEventListener('click', () => setOverlay(!st.overlay));

// side panels: minimize to a slim rail, remembered between visits
function setPanel(id: 'stream' | 'mind', min: boolean) {
  document.body.classList.toggle(id === 'stream' ? 'left-min' : 'right-min', min);
  store.set('min-' + id, min ? '1' : '0');
}
document.querySelectorAll<HTMLButtonElement>('.collapse').forEach((b) => b.addEventListener('click', () => {
  const id = b.dataset.for as 'stream' | 'mind';
  setPanel(id, !document.body.classList.contains(id === 'stream' ? 'left-min' : 'right-min'));
}));
document.querySelectorAll<HTMLElement>('.rail-label').forEach((el) => el.addEventListener('click', () => setPanel(el.parentElement!.id as 'stream' | 'mind', false)));
const narrow = window.matchMedia('(max-width: 860px)').matches;
setPanel('stream', store.get('min-stream') === '1' || (narrow && store.get('min-stream') === null));
setPanel('mind', store.get('min-mind') === '1' || (narrow && store.get('min-mind') === null));

// ------------------------------------------------------------------ timeline

const scrubber = $('scrubber') as HTMLInputElement;
const fmt = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function hourText() {
  const h = sim.world.clock.hour;
  return `day ${sim.world.clock.day + 1} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

function seek(t: number) {
  if (!rec.snaps.length) return;
  if (t >= rec.end - 0.01) { if (rec.reviewing) goLive(); return; }
  rec.seek(t);
  st.playing = false;
  syncTransport();
  rebuildThoughts();
}
function goLive() {
  rec.goLive();
  st.playing = true;
  st.paused = false;
  syncTransport();
  rebuildThoughts();
}
function togglePlay() {
  if (rec.reviewing) st.playing = !st.playing;
  else { st.paused = !st.paused; st.playing = !st.paused; }
  syncTransport();
}
function syncTransport() {
  const running = rec.reviewing ? st.playing : !st.paused;
  $('play').textContent = running ? '❚❚' : '▶';
  $('live').classList.toggle('on', !rec.reviewing && !st.paused);
  $('reviewBadge').hidden = !rec.reviewing;
}
scrubber.addEventListener('input', () => seek(rec.start + (Number(scrubber.value) / 1000) * (rec.end - rec.start)));
$('play').addEventListener('click', togglePlay);
$('back10').addEventListener('click', () => seek((rec.reviewing ? rec.cursor : rec.end) - 10));
$('fwd10').addEventListener('click', () => { if (rec.reviewing) seek(rec.cursor + 10); });
$('live').addEventListener('click', goLive);
$('toLive').addEventListener('click', goLive);

const SCALES = [0.25, 0.5, 1, 2, 4, 8];
function setScale(d: number) {
  const i = Math.max(0, Math.min(SCALES.length - 1, SCALES.indexOf(st.scale) + d));
  st.scale = SCALES[i];
  $('scale').textContent = `${st.scale}×`;
}
$('slower').addEventListener('click', () => setScale(-1));
$('faster').addEventListener('click', () => setScale(1));

function updateTimeline() {
  const span = Math.max(1e-6, rec.end - rec.start);
  const t = rec.reviewing ? rec.cursor : rec.end;
  if (document.activeElement !== scrubber) scrubber.value = String(Math.round(((t - rec.start) / span) * 1000));
  $('tStart').textContent = `−${fmt(rec.end - rec.start)}`;
  $('tEnd').textContent = 'now';
  $('tNow').textContent = rec.reviewing ? `${hourText()} · ${fmt(rec.end - rec.cursor)} ago` : hourText();
}

// ------------------------------------------------------------------ input

const say = $('say') as HTMLInputElement;
window.addEventListener('keydown', (e) => {
  if (document.activeElement === say) { if (e.key === 'Escape') say.blur(); return; }
  if (document.activeElement instanceof HTMLSelectElement && e.key.startsWith('Arrow')) return;
  const k = e.key.toLowerCase();
  keys.add(k === ' ' ? 'space' : k);
  if (k === 'enter') { e.preventDefault(); say.focus(); if (document.pointerLockElement) document.exitPointerLock(); }
  if ('12345'.includes(k) && k.length === 1) setMain((['eyes', 'follow', 'fp', 'tp', 'free'] as Cam[])[Number(k) - 1]);
  if (k === 'tab') { e.preventDefault(); const i = subjects.indexOf(st.subject); setSubject(subjects[(i + (e.shiftKey ? subjects.length - 1 : 1)) % subjects.length]); }
  if (k === ' ' && driving()) { sim.player.input.jump = true; e.preventDefault(); }
  if (k === 'e' && driving()) toast(sim.player.toggleCarry());
  if (k === 'f' && driving()) sim.player.throwCarried();
  if (k === 'l') setLayout(st.layout === 'single' ? 'split' : st.layout === 'split' ? 'pip' : 'single');
  if (k === 'v') setLayout(st.layout === 'single' ? 'pip' : 'single');
  if (k === 'o') setOverlay(!st.overlay);
  if (k === 'r') { st.raw = !st.raw; toast(st.raw ? 'raw eye motion' : 'stabilized eye view'); }
  if (k === 'h') document.body.classList.toggle('clean');
  if (k === 'p') togglePlay();
  if (k === 'arrowleft') { e.preventDefault(); seek((rec.reviewing ? rec.cursor : rec.end) - 10); }
  if (k === 'arrowright' && rec.reviewing) { e.preventDefault(); seek(rec.cursor + 10); }
  if (k === '[') setScale(-1);
  if (k === ']') setScale(1);
  if (k === 'k') toggleKnowledge();
  if (k === '?') $('help').hidden = !$('help').hidden;
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k === ' ' ? 'space' : k); });
window.addEventListener('blur', () => keys.clear());

const local = (e: { clientX: number; clientY: number }) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
let down: { x: number; y: number; t: number; pane: Pane } | null = null;
canvas.addEventListener('pointerdown', (e) => { const l = local(e); down = { ...l, t: performance.now(), pane: paneAt(l.x, l.y) }; });
window.addEventListener('pointerup', (e) => {
  if (!down) return;
  const l = local(e);
  const moved = Math.hypot(l.x - down.x, l.y - down.y);
  const quick = performance.now() - down.t < 350;
  if (moved < 5 && quick && e.target === canvas) {
    const r = down.pane.rect;
    if (driving() && down.pane.role === 'main' && !document.pointerLockElement) canvas.requestPointerLock();
    else if (document.pointerLockElement) inspectAt(down.pane, r.x + r.w / 2, r.y + r.h / 2);
    else inspectAt(down.pane, l.x, l.y);
  }
  down = null;
});
window.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) {
    st.yaw -= e.movementX * 0.0025;
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * 0.0025, -1.2, 1.2);
    return;
  }
  if (!down || !(e.buttons & 1)) return;
  const c = down.pane.cam;
  if (c === 'follow' || c === 'eyes') {
    st.orbitYaw -= e.movementX * 0.006;
    st.orbitPitch = THREE.MathUtils.clamp(st.orbitPitch + e.movementY * 0.005, -0.15, 1.4);
  } else if (c === 'free') {
    st.freeYaw -= e.movementX * 0.004;
    st.freePitch = THREE.MathUtils.clamp(st.freePitch - e.movementY * 0.004, -1.5, 1.5);
  } else {
    st.yaw -= e.movementX * 0.004;
    st.pitch = THREE.MathUtils.clamp(st.pitch - e.movementY * 0.004, -1.2, 1.2);
  }
});
canvas.addEventListener('wheel', (e) => {
  st.orbitZoom = THREE.MathUtils.clamp(st.orbitZoom * Math.exp(e.deltaY * 0.001), 0.25, 40);
}, { passive: true });

$('talk').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = say.value.trim();
  if (!text) return;
  if (rec.reviewing) goLive();
  sim.say(text);
  pushThought({ t: sim.world.t, intent: 'you', text, mood: '', aloud: true }, 'you');
  say.value = '';
});

let toastEl: HTMLDivElement | null = null;
function toast(msg: string) {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.textContent = msg;
  document.body.appendChild(toastEl);
  const el = toastEl;
  setTimeout(() => el.remove(), 1600);
}

// ------------------------------------------------------------------ inspector: the world's truth, with what the creature has measured highlighted

const raycaster = new THREE.Raycaster();
function inspectAt(p: Pane, x: number, y: number) {
  const ndc = new THREE.Vector2(((x - p.rect.x) / p.rect.w) * 2 - 1, -((y - p.rect.y) / p.rect.h) * 2 + 1);
  raycaster.setFromCamera(ndc, camFor(p.role));
  const hits = raycaster.intersectObjects([...wv.pickables, ...creatureView.pickables, ...playerView.pickables], true);
  for (const h of hits) {
    const id = wv.nodeOf(h);
    if (!id || id === 'ground') continue;
    if (id === 'creature') { toggleKnowledge(true); return; }
    const n = sim.world.nodes.get(id);
    if (n) {
      // clicking an ant or butterfly starts watching it
      const s = subjects.find((q) => q.id === n.top.id && (q.kind === 'ant' || q.kind === 'butterfly'));
      if (s && s !== st.subject) { setSubject(s); toast(`watching ${s.label}`); return; }
      showInspector(n);
      return;
    }
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
    const kids = new Map<string, NodeInst[]>();
    for (const ch of node.children) { const k = ch.spec.key; kids.set(k, [...(kids.get(k) ?? []), ch]); }
    const sub = [...kids.values()].map((group) => {
      if (group.length === 1) return li(group[0]);
      const seen = group.filter((g) => m.noticed.has(g.id)).length;
      return `<li><span class="${seen ? 'm' : 'u'}">${group[0].spec.words[0]} ×${group.length}</span> <small>(${seen} noticed)</small>${seen ? `<ul>${li(group.find((g) => m.noticed.has(g.id))!).replace(/^<li>|<\/li>$/g, '')}</ul>` : ''}</li>`;
    }).join('');
    return `<li><span class="${measured || c ? 'm' : 'u'}">${node.spec.words[0]}</span> <small>${describe(node.spec.looks, node.spec.attrs.color, undefined, false)}</small>${its}${sub ? `<ul>${sub}</ul>` : ''}</li>`;
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
$('helpBtn').addEventListener('click', () => ($('help').hidden = !$('help').hidden));
$('helpClose').addEventListener('click', () => ($('help').hidden = true));

// ------------------------------------------------------------------ stream of thought (kept here too, so it can be replayed)

const thoughtsEl = $('thoughts');
interface Line { r: ThoughtRecord; cls: string; hour: string }
const allThoughts: Line[] = [];
function lineFor(x: Line) {
  const li = document.createElement('li');
  li.className = x.cls;
  const tag = x.cls === 'you' ? 'YOU' : x.r.aloud ? 'says' : x.r.intent.toLowerCase().replace(/_/g, ' ');
  li.innerHTML = `<span class="t">${x.hour}<span class="i">${tag}</span></span>`;
  li.appendChild(document.createTextNode(x.r.text));
  return li;
}
function pushThought(r: ThoughtRecord, cls: string) {
  const x = { r, cls, hour: hourText() };
  allThoughts.push(x);
  if (allThoughts.length > 3000) allThoughts.splice(0, 500);
  if (rec.reviewing) return;
  thoughtsEl.prepend(lineFor(x));
  while (thoughtsEl.children.length > 80) thoughtsEl.lastChild!.remove();
}
let shownUpTo = -2;
function rebuildThoughts() {
  const t = rec.reviewing ? rec.cursor : Infinity;
  const list = allThoughts.filter((x) => x.r.t <= t).slice(-80);
  const key = rec.reviewing ? (list.length ? list[list.length - 1].r.t : -1) : -2;
  if (key === shownUpTo && rec.reviewing) return;
  shownUpTo = key;
  thoughtsEl.replaceChildren(...list.reverse().map(lineFor));
}
sim.onThought = (t) => pushThought(t, t.aloud ? 'aloud' : 'thought');

// ------------------------------------------------------------------ mind panel

const totalKinds = new Set<string>();
for (const e of Object.values(sim.ont.entities)) {
  const walk = (p: typeof e) => { totalKinds.add(p.words[0]); p.parts.forEach(walk); };
  walk(e);
}
function meters(el: HTMLElement, vals: Record<string, number>, invert: string[] = []) {
  el.innerHTML = Object.entries(vals).map(([k, raw]) => {
    const v = Number.isFinite(raw) ? raw : 0;
    return `<div class="meter"><span>${k}</span><div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;${invert.includes(k) ? 'background:var(--bad)' : ''}"></i></div><span class="n">${v.toFixed(2)}</span></div>`;
  }).join('');
}

function updateMindPanel() {
  const s = st.subject;
  $('mindTitle').textContent = s.hasMind ? 'Mind' : s.label;
  $('mindBody').hidden = !s.hasMind;
  $('noMind').hidden = s.hasMind;
  if (!s.hasMind) {
    const p = s.pos();
    $('noMind').innerHTML = `<p>${s.kind === 'visitor' ? 'This is you. Your body is driven by your keys; nothing models your thoughts.' : `This ${s.kind} moves by simple rules; it has no modelled mind.`}</p>
      <div class="row"><span class="k">position</span><span class="v">${p.x.toFixed(2)}, ${p.z.toFixed(2)} m</span></div>
      <div class="row"><span class="k">height</span><span class="v">${(p.y - sim.world.groundY(p.x, p.z)).toFixed(3)} m up</span></div>
      <div class="row"><span class="k">facing</span><span class="v">${Math.round(((s.heading() * 180) / Math.PI + 360) % 360)}°</span></div>
      <p style="margin-top:12px">Try <b>Its eyes</b> to see the world from where it is.</p>`;
    return;
  }
  const snap = rec.reviewing ? rec.current() : null;
  const r = snap ? snap.report : sim.lastReport;
  if (!r) return;
  $('focus').textContent = r.focus ? `${r.focus.label}` : '—';
  $('behavior').textContent = r.behavior;
  const gc = r.gaze.target ? sim.mind.conceptOfNode(r.gaze.target) : undefined;
  $('gaze').textContent = `${r.gaze.mode}${r.gaze.target ? ' · ' + (gc?.name ?? r.gaze.target.split('/').pop()) : ''}`;
  ($('interest').firstElementChild as HTMLElement).style.width = `${Math.round(r.gaze.interest * 100)}%`;
  meters($('drives'), r.drives, ['hunger', 'thirst', 'safety']);
  meters($('feelings'), r.feelings, ['fear']);
  const b = snap ? snap.bio : sim.creature.bio;
  meters($('bodystate'), { energy: b.energy, hydration: b.hydration, health: b.health, pain: b.pain, nausea: b.nausea }, ['pain', 'nausea']);
  $('salience').innerHTML = r.salience.slice(0, 5).map((x) => `<li><span>${x.label}</span><span>${(Number.isFinite(x.score) ? x.score : 0).toFixed(2)}</span></li>`).join('');
  const named = snap ? snap.named : sim.mind.mem.named().map((c) => ({ name: c.name!, part: c.isPart }));
  $('named').innerHTML = named.map((c) => `<span class="${c.part ? 'part' : ''}">${c.name}</span>`).join('');
  $('disc').textContent = `${named.length} / ${totalKinds.size}`;
  if (!$('knowledge').hidden) $('kList').innerHTML = sim.mind.knowledge().reverse().map((x) => `<li>${x}</li>`).join('');
}

// ------------------------------------------------------------------ start

setSubject(st.subject);
setMain(st.main);
setSecond(st.second);
setLayout(st.layout);
setOverlay(st.overlay);
syncTransport();

// ------------------------------------------------------------------ loop

let last = performance.now();
let hudT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (rec.reviewing) {
    if (st.playing) {
      const t = rec.cursor + dt * st.scale;
      if (t >= rec.end) goLive(); // caught up: carry on live
      else { rec.seek(t); rebuildThoughts(); }
    }
  } else {
    drivePlayer();
    if (!st.paused) sim.advance(dt * st.scale, Math.ceil(8 * st.scale));
    rec.tick();
  }
  moveFree(dt);

  wv.update(dt);
  wv.updateEnvironment();
  creatureView.update(sim.creature.pose);
  playerView.update(sim.player.pose);
  const focus = driving() ? v3(sim.player.pose.root) : st.main === 'free' ? st.free : v3(st.subject.pos());
  wv.focusShadows(focus);

  const snap = rec.reviewing ? rec.current() : null;
  const report = snap ? snap.report : sim.lastReport;
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  og.clearRect(0, 0, W, H);
  const ps = panes();
  for (const p of ps) renderPane(p, dt, report, snap);
  paneDecor(ps);

  hudT += dt;
  if (hudT > 0.12) {
    hudT = 0;
    $('clock').textContent = hourText();
    updateMindPanel();
    updateTimeline();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for debugging and automated checks
Object.assign(window as any, { sim, st, rec, setMain, setLayout, setSubject, setOverlay, seek, goLive, subjects });
