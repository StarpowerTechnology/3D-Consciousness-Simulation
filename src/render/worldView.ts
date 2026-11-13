// L0 RENDER: draws the world from the same node instances the senses read. Never writes to the simulation.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { World } from '../world/world';
import type { NodeInst } from '../world/nodes';
import { flutter } from '../world/fields';
import { surfaceAt, POND, WATER_LEVEL } from '../world/terrain';
import { staticTube, leafGeometry, shapedSphere } from './geom';
import { barkTexture, groundTexture, leafTexture, noiseTexture, petalTexture, spotsTexture, waterNormals, wingTexture } from './textures';
import { fbm2, Rng } from '../util/rng';

interface InstGroup { mesh: THREE.InstancedMesh; nodes: NodeInst[] }

export class WorldView {
  readonly scene = new THREE.Scene();
  readonly sun = new THREE.DirectionalLight('#fff2dd', 2.4);
  readonly hemi = new THREE.HemisphereLight('#bcd7ff', '#4a3a22', 0.4);
  private sky = new Sky();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  envMap: THREE.Texture | null = null;
  private skyScene = new THREE.Scene();
  private lastEnvHour = -10;
  private leaves!: InstGroup;
  private fallen!: InstGroup;
  private berries!: InstGroup;
  private nuts!: THREE.InstancedMesh;
  private nutNodes: NodeInst[] = [];
  private petals!: InstGroup;
  private grassMat!: THREE.MeshStandardMaterial;
  private grassUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0) }, uStrength: { value: 0.3 }, uGust: { value: 0 } };
  private water!: THREE.Mesh;
  private waterNormal!: THREE.Texture;
  private ants: { node: NodeInst; g: THREE.Group; legs: THREE.Mesh[] }[] = [];
  private flies: { node: NodeInst; g: THREE.Group; wings: THREE.Mesh[] }[] = [];
  private stars: THREE.Points;
  /** pickable meshes; instanced ones map instanceId → node */
  readonly pickables: THREE.Object3D[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  constructor(private world: World, private renderer: THREE.WebGLRenderer) {
    const sc = this.scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    sc.fog = new THREE.FogExp2('#b9c9d6', 0.035);

    this.sky.scale.setScalar(400);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
    sc.add(this.sky);
    this.skyScene.add(this.sky.clone());

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -2.2;
    cam.right = cam.top = 2.2;
    cam.near = 0.1;
    cam.far = 40;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.002;
    this.sun.shadow.radius = 3;
    sc.add(this.sun, this.sun.target, this.hemi);

    // stars for the night
    const sp: number[] = [];
    const r = new Rng(17);
    for (let i = 0; i < 1500; i++) {
      const a = r.range(0, Math.PI * 2), b = Math.acos(r.range(0.05, 1));
      sp.push(Math.cos(a) * Math.sin(b) * 300, Math.cos(b) * 300, Math.sin(a) * Math.sin(b) * 300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    sc.add(this.stars);

    this.buildTerrain();
    this.buildGrass();
    this.buildPlants();
    this.buildRocks();
    this.buildPondAndLog();
    this.buildBugs();
    this.updateEnvironment(true);
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain() {
    const t = this.world.terrain;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
    g.setIndex(new THREE.BufferAttribute(t.indices, 1));
    const n = t.positions.length / 3;
    const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = t.positions[i * 3], z = t.positions[i * 3 + 2];
      const s = surfaceAt(x, z);
      const v = fbm2(x * 0.9, z * 0.9, 3, 5) * 0.12;
      if (s === 'grass') c.setRGB(0.3 + v, 0.36 + v, 0.17);
      else if (s === 'dirt') c.setRGB(0.46 + v, 0.35 + v, 0.24 + v);
      else if (s === 'mud') c.setRGB(0.28, 0.22, 0.16);
      else if (s === 'sand') c.setRGB(0.68 + v, 0.6 + v, 0.45);
      else c.setRGB(0.22, 0.2, 0.16);
      col.set([c.r, c.g, c.b], i * 3);
      uv[i * 2] = x * 1.4;
      uv[i * 2 + 1] = z * 1.4;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTexture(), roughness: 0.95, bumpMap: noiseTexture(256, 3, 0.4), bumpScale: 0.6 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.userData.nodeId = 'ground';
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- grass: instanced blades swaying by the same wind the creature perceives

  private buildGrass() {
    const blade = new THREE.PlaneGeometry(1, 1, 1, 5);
    blade.translate(0, 0.5, 0);
    const p = blade.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - y * 0.92));
      p.setZ(i, y * y * 0.18);
    }
    blade.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide, vertexColors: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassUniforms);
      sh.vertexShader = 'uniform float uTime; uniform vec3 uWind; uniform float uStrength; uniform float uGust;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 wp0 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
         float h = position.y;
         // same sway function as world/fields.ts swayAngle
         float sway = (0.05 + 0.25 * uStrength) * sin(uTime * 2.2 + wp0.x * 1.7 + wp0.z * 1.3) * (0.4 + 0.6 * uGust) + 0.12 * uStrength;
         vec3 localWind = (inverse(mat3(instanceMatrix)) * uWind);
         transformed.xz += normalize(localWind.xz + 1e-5) * sway * h * h * 1.2;
         transformed.y -= abs(sway) * h * h * 0.25;`,
      );
    };
    this.grassMat = mat;
    const patches = this.world.nodes.tops.filter((n) => n.entity === 'grass');
    const per = 220;
    const mesh = new THREE.InstancedMesh(blade, mat, patches.length * per);
    const r = new Rng(31);
    const col = new THREE.Color();
    let k = 0;
    for (const n of patches) {
      const { base, h, r: R } = n.render;
      for (let i = 0; i < per; i++) {
        const a = r.range(0, Math.PI * 2), d = Math.sqrt(r.next()) * R;
        const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
        const y = this.world.groundY(x, z) - 0.003;
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(r.range(-0.15, 0.15), r.range(0, Math.PI * 2), r.range(-0.15, 0.15));
        const hh = h * r.range(0.55, 1.25);
        this.dummy.scale.set(hh * r.range(0.025, 0.045), hh, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(k, this.dummy.matrix);
        col.setHSL(0.21 + r.range(-0.04, 0.05), 0.5 + r.range(0, 0.2), 0.2 + r.range(-0.05, 0.08));
        mesh.setColorAt(k, col);
        k++;
      }
    }
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- plants

  private buildPlants() {
    const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95, color: '#7d5f44' });
    const stalkMat = new THREE.MeshStandardMaterial({ color: '#4f7f2a', roughness: 0.7 });
    const leafMap = leafTexture();
    const leafMat = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62 });
    const leafDepth = new THREE.MeshDepthMaterial({ map: leafMap, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
    const leafGeo = leafGeometry();
    const leafNodes: NodeInst[] = [];
    const berryNodes: NodeInst[] = [];
    const petalNodes: NodeInst[] = [];
    const walk = (n: NodeInst) => {
      if (n.spec.key === 'leaf' && n.parent) leafNodes.push(n);
      if (n.spec.key === 'berry') berryNodes.push(n);
      if (n.spec.key === 'petals') petalNodes.push(n);
      if (n.spec.key === 'nut' && n.parent) this.nutNodes.push(n);
      n.children.forEach(walk);
    };
    for (const top of this.world.nodes.tops) {
      walk(top);
      if (top.entity === 'tree' || top.entity === 'bush' || top.entity === 'flower') {
        const geos: THREE.BufferGeometry[] = [];
        for (const c of top.children) if (c.render.tube) {
          const m = new THREE.Mesh(staticTube(c.render.tube, c.render.radii, top.entity === 'tree' && c.spec.key === 'trunk' ? 18 : 10, top.entity === 'tree' && c.spec.key === 'trunk' ? 16 : 7), top.entity === 'flower' ? stalkMat : bark);
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.nodeId = c.id;
          if (top.entity === 'tree' && c.spec.key === 'trunk') (m.material as THREE.MeshStandardMaterial).map!.repeat.set(2, 3);
          this.scene.add(m);
          this.pickables.push(m);
          geos.push(m.geometry);
        }
        // roots flaring into the ground for big trees
        if (top.entity === 'tree' && top.render.big) {
          const r0 = top.children.find((c) => c.spec.key === 'trunk')!.render.radii[0];
          const rr = new Rng(top.id.length * 7);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + rr.range(-0.3, 0.3);
            const b = top.render.base;
            const pts = [{ x: b.x + Math.cos(a) * r0 * 0.6, y: b.y + r0 * 0.9, z: b.z + Math.sin(a) * r0 * 0.6 }, { x: b.x + Math.cos(a) * r0 * 1.5, y: b.y + r0 * 0.15, z: b.z + Math.sin(a) * r0 * 1.5 }, { x: b.x + Math.cos(a) * r0 * 3.2, y: b.y - r0 * 0.4, z: b.z + Math.sin(a) * r0 * 3.2 }];
            const m = new THREE.Mesh(staticTube(pts, [r0 * 0.42, r0 * 0.2, r0 * 0.04], 10, 10), bark);
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
          }
        }
      }
      if (top.entity === 'mushroom') this.mushroom(top);
    }
    // leaves on plants: one instanced mesh, moved each frame by the same flutter function the senses use
    const lm = new THREE.InstancedMesh(leafGeo, leafMat, leafNodes.length);
    lm.customDepthMaterial = leafDepth;
    lm.castShadow = true;
    lm.receiveShadow = true;
    const col = new THREE.Color();
    leafNodes.forEach((n, i) => {
      const big = n.top.entity === 'tree' && n.top.render.big;
      col.setHSL(0.24 + (n.phase - 0.5) * 0.06 + (big ? -0.02 : 0), 0.55, 0.42 + (n.phase - 0.5) * 0.12);
      lm.setColorAt(i, col);
    });
    lm.userData.instanceNodes = leafNodes;
    this.scene.add(lm);
    this.pickables.push(lm);
    this.leaves = { mesh: lm, nodes: leafNodes };

    // fallen leaves on the ground, blown by the wind through physics
    const fallenNodes = this.world.nodes.tops.filter((n) => n.entity === 'leaf');
    const fm = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ map: leafTexture('#b8862e', '#7a3f14', true), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), fallenNodes.length);
    fm.customDepthMaterial = new THREE.MeshDepthMaterial({ map: (fm.material as THREE.MeshStandardMaterial).map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
    fm.castShadow = fm.receiveShadow = true;
    fm.userData.instanceNodes = fallenNodes;
    this.scene.add(fm);
    this.pickables.push(fm);
    this.fallen = { mesh: fm, nodes: fallenNodes };

    // berries: glossy and red
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#b3121b', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.3 }), berryNodes.length);
    bm.castShadow = true;
    bm.userData.instanceNodes = berryNodes;
    this.scene.add(bm);
    this.pickables.push(bm);
    this.berries = { mesh: bm, nodes: berryNodes };

    // petals: six around each flower head, with a fuzzy yellow centre
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ map: petalTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.55 }), petalNodes.length * 7);
    pm.castShadow = true;
    const centerGeo = new THREE.SphereGeometry(0.5, 12, 8);
    const centerMat = new THREE.MeshStandardMaterial({ color: '#f0c22a', roughness: 0.9 });
    let k = 0;
    for (const n of petalNodes) {
      const c = new THREE.Color().setHSL(n.render.hue ?? 0.78, 0.55, 0.62);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + n.phase;
        this.dummy.position.set(n.pos.x, n.pos.y, n.pos.z);
        this.dummy.rotation.set(0, a, 0, 'YXZ');
        this.dummy.rotateX(Math.PI / 2 - 0.35);
        this.dummy.scale.set(n.size * 0.42, n.size * 0.55, 1);
        this.dummy.updateMatrix();
        pm.setMatrixAt(k, this.dummy.matrix);
        pm.setColorAt(k, c);
        k++;
      }
      const ctr = new THREE.Mesh(centerGeo, centerMat);
      ctr.position.set(n.pos.x, n.pos.y + 0.003, n.pos.z);
      ctr.scale.set(0.014, 0.008, 0.014);
      ctr.userData.nodeId = n.children[0]?.id ?? n.id;
      this.scene.add(ctr);
      this.pickables.push(ctr);
    }
    pm.userData.instanceNodes = petalNodes.flatMap((n) => Array(7).fill(n));
    this.scene.add(pm);
    this.pickables.push(pm);
    this.petals = { mesh: pm, nodes: petalNodes };

    // nuts, attached to trees and fallen
    this.nuts = new THREE.InstancedMesh(shapedSphere(14, 10, (v) => new THREE.Vector3(v.x * 0.5, v.y * 0.62, v.z * 0.5)), new THREE.MeshPhysicalMaterial({ color: '#7a4a22', roughness: 0.35, clearcoat: 0.6 }), 64);
    this.nuts.castShadow = true;
    this.scene.add(this.nuts);
    this.pickables.push(this.nuts);
  }

  private mushroom(top: NodeInst) {
    const { base, h, cr } = top.render;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(Math.sin(t * Math.PI * 0.5) * cr * (1 - 0.08 * t), Math.cos(t * Math.PI * 0.5) * cr * 0.62));
    }
    pts.push(new THREE.Vector2(cr * 0.85, -cr * 0.05), new THREE.Vector2(cr * 0.2, -cr * 0.08));
    const cap = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshPhysicalMaterial({ map: spotsTexture(), roughness: 0.35, clearcoat: 0.5 }));
    cap.position.set(base.x, base.y + h, base.z);
    cap.castShadow = cap.receiveShadow = true;
    cap.userData.nodeId = top.children.find((c) => c.spec.key === 'cap')!.id;
    const stalkPts = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(cr * 0.32, 0), new THREE.Vector2(cr * 0.26, h * 0.5), new THREE.Vector2(cr * 0.22, h), new THREE.Vector2(0.0001, h)];
    const stalk = new THREE.Mesh(new THREE.LatheGeometry(stalkPts, 18), new THREE.MeshStandardMaterial({ color: '#efe6d4', roughness: 0.8 }));
    stalk.position.set(base.x, base.y - 0.003, base.z);
    stalk.castShadow = stalk.receiveShadow = true;
    stalk.userData.nodeId = top.children.find((c) => c.spec.key === 'stalk')!.id;
    this.scene.add(cap, stalk);
    this.pickables.push(cap, stalk);
  }

  // ---------------------------------------------------------------- rocks, pond, log

  private buildRocks() {
    for (const n of this.world.nodes.tops.filter((t) => t.entity === 'rock')) {
      const { seed, s, yaw } = n.render;
      const r = new Rng(seed);
      const o1 = r.range(0, 10), o2 = r.range(0, 10);
      const g = shapedSphere(36, 24, (v) => {
        const k = 1 + 0.22 * fbm2(v.x * 1.6 + o1, v.z * 1.6 + v.y * 1.2 + o2, 4, seed % 97) + 0.05 * fbm2(v.x * 6 + o2, v.y * 6, 2, 3);
        return new THREE.Vector3(v.x * k * s * 0.5, v.y * k * s * 0.32, v.z * k * s * 0.46);
      });
      const p = g.attributes.position as THREE.BufferAttribute;
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      const col = new Float32Array(p.count * 3);
      const mossy = n.children.some((c) => c.spec.key === 'moss');
      for (let i = 0; i < p.count; i++) {
        const v = 0.27 + fbm2(p.getX(i) * 30, p.getZ(i) * 30 + p.getY(i) * 20, 3, 7) * 0.18;
        const up = nrm.getY(i);
        const m = mossy ? Math.max(0, up - 0.45) * 1.8 : 0;
        col[i * 3] = v * (1 - m) + 0.22 * m;
        col[i * 3 + 1] = v * (1 - m) + 0.38 * m;
        col[i * 3 + 2] = v * 1.02 * (1 - m) + 0.12 * m;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, bumpMap: noiseTexture(128, seed % 50, 0.5), bumpScale: 2 }));
      mesh.position.set(n.pos.x, n.pos.y - s * 0.08, n.pos.z);
      mesh.rotation.y = yaw;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.nodeId = n.id;
      this.scene.add(mesh);
      this.pickables.push(mesh);
    }
  }

  private buildPondAndLog() {
    this.waterNormal = waterNormals();
    this.waterNormal.repeat.set(3, 3);
    const wm = new THREE.MeshPhysicalMaterial({ color: '#1d3b3a', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.82, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.33, specularIntensity: 1, envMapIntensity: 1.4 });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(POND.r * 1.02, 64), wm);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(POND.x, WATER_LEVEL, POND.z);
    this.water.receiveShadow = true;
    this.water.userData.nodeId = this.world.nodes.tops.find((n) => n.entity === 'pond')!.id;
    this.scene.add(this.water);
    this.pickables.push(this.water);

    const logN = this.world.nodes.tops.find((n) => n.entity === 'log')!;
    const { L, R, inner, rotY } = logN.render;
    const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95, color: '#a89276', side: THREE.FrontSide });
    (bark.map as THREE.Texture).repeat.set(3, 1.5);
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.04, L, 36, 6, true), bark);
    const innerM = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, L, 28, 1, true), new THREE.MeshStandardMaterial({ color: '#3e2c1c', roughness: 1, side: THREE.BackSide }));
    const ringG = new THREE.RingGeometry(inner, R, 36, 1);
    const ringM = new THREE.MeshStandardMaterial({ color: '#b08a5c', roughness: 0.9, side: THREE.DoubleSide, map: noiseTexture(128, 5, 0.3) });
    const r1 = new THREE.Mesh(ringG, ringM), r2 = new THREE.Mesh(ringG, ringM);
    r1.position.y = L / 2; r1.rotation.x = -Math.PI / 2;
    r2.position.y = -L / 2; r2.rotation.x = Math.PI / 2;
    g.add(outer, innerM, r1, r2);
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; o.userData.nodeId = logN.id; });
    g.rotation.set(0, rotY, Math.PI / 2, 'YXZ');
    g.position.set(logN.pos.x, logN.pos.y, logN.pos.z);
    this.scene.add(g);
    this.pickables.push(outer, innerM);
  }

  // ---------------------------------------------------------------- bugs

  private buildBugs() {
    const shell = new THREE.MeshPhysicalMaterial({ color: '#120d0a', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
    const legM = new THREE.MeshStandardMaterial({ color: '#1a120c', roughness: 0.5 });
    for (const a of this.world.ants.ants) {
      const g = new THREE.Group();
      const seg = (r: number, z: number, sy = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), shell); m.position.z = z; m.scale.set(1, sy, 1.35); m.castShadow = true; g.add(m); return m; };
      seg(0.0009, 0.0026, 0.9);
      seg(0.0007, 0.0009, 0.8);
      seg(0.0013, -0.0014, 0.85);
      const legs: THREE.Mesh[] = [];
      const lg = new THREE.CylinderGeometry(0.00012, 0.00008, 0.0034, 4);
      lg.translate(0, -0.0017, 0);
      for (let k = 0; k < 6; k++) {
        const side = k < 3 ? -1 : 1;
        const m = new THREE.Mesh(lg, legM);
        m.position.set(side * 0.0004, 0.0002, ((k % 3) - 1) * 0.0008 + 0.0009);
        m.rotation.z = side * 1.1;
        g.add(m);
        legs.push(m);
      }
      for (const side of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.00006, 0.00006, 0.003, 3), legM);
        ant.position.set(side * 0.0005, 0.0012, 0.0038);
        ant.rotation.set(0.9, 0, side * 0.5);
        g.add(ant);
      }
      g.traverse((o) => (o.userData.nodeId = a.node.id));
      this.scene.add(g);
      this.pickables.push(g);
      this.ants.push({ node: a.node, g, legs });
    }
    const wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 });
    for (const f of this.world.butterflies.flies) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.0015, 0.016, 4, 8), shell);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const wings: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const wg = new THREE.PlaneGeometry(0.03, 0.03);
        wg.translate(0.015, 0, 0);
        const w = new THREE.Mesh(wg, wingMat);
        w.rotation.x = -Math.PI / 2;
        if (side < 0) w.scale.x = -1;
        const pivot = new THREE.Group();
        pivot.add(w);
        g.add(pivot);
        wings.push(pivot as unknown as THREE.Mesh);
      }
      g.traverse((o) => { o.userData.nodeId = f.node.id; o.castShadow = true; });
      this.scene.add(g);
      this.pickables.push(g);
      this.flies.push({ node: f.node, g, wings });
    }
  }

  // ---------------------------------------------------------------- per frame

  updateEnvironment(force = false) {
    const w = this.world;
    const sunDir = new THREE.Vector3(w.sun.dir.x, w.sun.dir.y, w.sun.dir.z);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sunDir);
    if (u.time) u.time.value = w.t;
    if (force || Math.abs(w.clock.hour - this.lastEnvHour) > 0.25) {
      this.lastEnvHour = w.clock.hour;
      const sk = this.skyScene.children[0] as Sky;
      sk.material.uniforms.sunPosition.value.copy(sunDir);
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.skyScene as unknown as THREE.Scene, 0, 0.1, 1000);
      this.envMap = this.envRT.texture;
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = 0.12 + 0.3 * w.sun.ambient;
    }
    const day = w.sun.ambient;
    const warm = w.sun.warmth;
    this.sun.intensity = (0.35 + 0.65 * Math.max(0, Math.sin(Math.max(0, w.sun.elevation)))) * 2.6 * Math.min(1, day * 1.4);
    this.sun.color.setRGB(1, 0.86 + 0.12 * (1 - warm), 0.72 + 0.26 * (1 - warm));
    this.hemi.intensity = 0.08 + 0.32 * day;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.65 + 0.2 * day, 0.85 + 0.1 * day);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - day * 3);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(0.08 + 0.62 * day + 0.08 * warm, 0.1 + 0.68 * day, 0.16 + 0.68 * day - 0.05 * warm);
    this.renderer.toneMappingExposure = 0.62 + 0.28 * Math.min(1, day * 1.2) + (day < 0.2 ? 0.6 : 0);
  }

  /** Keep the shadow map centred on what the camera is looking at, so a 12 cm animal gets crisp shadows. */
  focusShadows(at: THREE.Vector3) {
    const d = new THREE.Vector3(this.world.sun.dir.x, Math.max(0.15, this.world.sun.dir.y), this.world.sun.dir.z).normalize();
    const snap = 0.02;
    const cx = Math.round(at.x / snap) * snap, cz = Math.round(at.z / snap) * snap;
    this.sun.target.position.set(cx, at.y, cz);
    this.sun.position.set(cx + d.x * 15, at.y + d.y * 15, cz + d.z * 15);
    this.sun.target.updateMatrixWorld();
  }

  update(dt: number) {
    const w = this.world;
    this.grassUniforms.uTime.value = w.t;
    this.grassUniforms.uWind.value.set(w.wind.dir.x, 0, w.wind.dir.z);
    this.grassUniforms.uStrength.value = w.wind.strength;
    this.grassUniforms.uGust.value = w.wind.gust;
    this.waterNormal.offset.set(w.t * 0.01, w.t * 0.006);

    // leaves: position from the node (flutter already applied by the world), orientation twisted by the same function
    const L = this.leaves;
    L.nodes.forEach((n, i) => {
      if (n.removed) { this.tmpM.makeScale(0, 0, 0); L.mesh.setMatrixAt(i, this.tmpM); return; }
      const twist = n.render.twist ?? 0;
      this.tmpE.set((n.render.pitch ?? 0) - Math.PI / 2 + twist * 0.6, n.render.yaw ?? 0, twist * 0.4, 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpS.set(n.size * 0.62, n.size, n.size);
      this.tmpP.set(n.pos.x, n.pos.y, n.pos.z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      L.mesh.setMatrixAt(i, this.tmpM);
    });
    L.mesh.instanceMatrix.needsUpdate = true;
    L.mesh.computeBoundingSphere();

    const F = this.fallen;
    F.nodes.forEach((n, i) => {
      const q = n.render.bodyRot;
      const spin = q ? Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) : 0;
      const air = n.pos.y - w.groundY(n.pos.x, n.pos.z);
      this.tmpE.set(-Math.PI / 2 + Math.min(0.9, air * 12) * Math.sin(w.t * 7 + n.phase * 9), (n.render.yaw ?? 0) + spin * 0.3, Math.sin(w.t * 5 + n.phase) * Math.min(0.6, air * 8), 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpS.set(n.size * 0.62, n.size, n.size);
      this.tmpP.set(n.pos.x, Math.max(n.pos.y - 0.004, w.groundY(n.pos.x, n.pos.z) + 0.0015), n.pos.z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      F.mesh.setMatrixAt(i, this.tmpM);
    });
    F.mesh.instanceMatrix.needsUpdate = true;
    F.mesh.computeBoundingSphere();

    const B = this.berries;
    B.nodes.forEach((n, i) => {
      const s = n.removed ? 0 : n.size;
      this.tmpM.makeScale(s, s * 0.95, s);
      this.tmpM.setPosition(n.pos.x, n.pos.y, n.pos.z);
      B.mesh.setMatrixAt(i, this.tmpM);
    });
    B.mesh.instanceMatrix.needsUpdate = true;
    B.mesh.computeBoundingSphere();

    // nuts: still on the tree, or rolling on the ground
    const nuts: NodeInst[] = [...this.nutNodes.filter((n) => !n.removed), ...w.fallenNuts];
    nuts.slice(0, 64).forEach((n, i) => {
      const q = n.render.bodyRot;
      this.tmpQ.set(q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1);
      this.tmpS.setScalar(n.size);
      this.tmpP.set(n.pos.x, n.pos.y, n.pos.z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.nuts.setMatrixAt(i, this.tmpM);
    });
    this.nuts.count = Math.min(64, nuts.length);
    this.nuts.userData.instanceNodes = nuts;
    this.nuts.instanceMatrix.needsUpdate = true;
    this.nuts.computeBoundingSphere();

    for (const a of this.ants) {
      a.g.position.set(a.node.pos.x, a.node.pos.y, a.node.pos.z);
      a.g.rotation.y = a.node.heading;
      const ph = a.node.render.gait ?? 0;
      a.legs.forEach((l, k) => {
        const side = k < 3 ? -1 : 1;
        const tri = (k % 2 === 0 ? 0 : Math.PI) + (k >= 3 ? Math.PI : 0);
        l.rotation.set(Math.sin(ph + tri) * 0.5, 0, side * 1.1);
      });
    }
    for (const f of this.flies) {
      f.g.position.set(f.node.pos.x, f.node.pos.y, f.node.pos.z);
      f.g.rotation.y = f.node.heading;
      const flap = Math.sin((f.node.render.flap ?? 0) * Math.PI * 2);
      f.wings[0].rotation.z = 0.2 + flap * 1.1;
      f.wings[1].rotation.z = -0.2 - flap * 1.1;
    }
    void dt;
  }

  /** Which node does a ray hit hit? */
  nodeOf(hit: THREE.Intersection): string | undefined {
    const o = hit.object as THREE.Object3D & { userData: any };
    if (hit.instanceId !== undefined && o.userData.instanceNodes) return o.userData.instanceNodes[hit.instanceId]?.id;
    let p: THREE.Object3D | null = o;
    while (p) { if (p.userData.nodeId) return p.userData.nodeId; p = p.parent; }
    return undefined;
  }
}

export { flutter };
