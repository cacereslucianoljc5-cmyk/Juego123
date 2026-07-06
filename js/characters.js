// Personajes del juego. Los enemigos y la arena usan los modelos GLB del
// repo clash3deee (optimizados); el héroe blanco con espada, los cofres y
// los objetos siguen siendo procedurales.
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js?v=3';

// --- modelos GLB (enemigos + arena) ---
const MODEL_FILES = ['Esqueleto', 'Arquero', 'Barbaro', 'Gigante', 'Arena'];
const models = {};

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(MODEL_FILES.map(async (name) => {
    const gltf = await loader.loadAsync(`./models/${name}.glb`);
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        // la arena solo recibe sombras (emitirlas con tanta geometría mata el rendimiento)
        o.castShadow = name !== 'Arena';
        o.receiveShadow = name === 'Arena';
      }
    });
    models[name] = gltf.scene;
    done++;
    if (onProgress) onProgress(done / MODEL_FILES.length);
  }));
}

export function getArena() {
  return models.Arena;
}

// clona un modelo, con materiales propios (para el parpadeo de daño)
// y apoyado en el piso dentro de un grupo
function cloneModel(name, scale) {
  const inner = models[name].clone(true);
  inner.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  inner.scale.setScalar(scale);
  const box = new THREE.Box3().setFromObject(inner);
  inner.position.y = -box.min.y;
  const g = new THREE.Group();
  g.add(inner);
  g.userData = {};
  return g;
}

export const makeSkeleton = () => cloneModel('Esqueleto', 1.0);
export const makeArcher = () => cloneModel('Arquero', 1.0);
export const makeBarbarian = () => cloneModel('Barbaro', 1.05);
export const makeGiant = () => cloneModel('Gigante', 2.1);

const COLORS = {
  white: 0xf2eee4,
  bone: 0xe6ddc8,
  skin: 0xf0e4d2,
  blade: 0xb9bfcc,
  bladeDark: 0x848a99,
  gold: 0xe8b73a,
  wood: 0x7a5230,
  woodDark: 0x5a3c22,
  leather: 0x8a5a2e,
  leatherDark: 0x6b4423,
  blue: 0x2f7bd9,
  yellow: 0xf2c21c,
  orange: 0xf0921e,
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...opts });
}

// --- carita NPC (dos ojos, nariz y sonrisa) dibujada en un canvas ---
let faceTexture = null;
function getFaceTexture() {
  if (faceTexture) return faceTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#101010';
  // ojos
  for (const x of [82, 174]) {
    g.beginPath();
    g.ellipse(x, 92, 15, 17, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#101010';
  g.lineWidth = 12;
  g.lineCap = 'round';
  // nariz (línea que baja y se curva a la izquierda)
  g.beginPath();
  g.moveTo(134, 92);
  g.quadraticCurveTo(128, 128, 118, 142);
  g.stroke();
  // sonrisa
  g.beginPath();
  g.moveTo(104, 176);
  g.quadraticCurveTo(134, 192, 164, 172);
  g.stroke();
  faceTexture = new THREE.CanvasTexture(c);
  return faceTexture;
}

function makeFacePlane(size = 0.7) {
  const geo = new THREE.PlaneGeometry(size, size);
  const m = new THREE.MeshBasicMaterial({ map: getFaceTexture(), transparent: true, depthWrite: false });
  const plane = new THREE.Mesh(geo, m);
  plane.renderOrder = 2;
  return plane;
}

function sphere(r, color, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat(color));
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  return mesh;
}

function box(w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.castShadow = true;
  return mesh;
}

function cyl(rt, rb, h, color, seg = 14) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  mesh.castShadow = true;
  return mesh;
}

// --- espada (hoja plateada, guarda dorada, mango de madera) ---
export function makeSword(scale = 1) {
  const g = new THREE.Group();
  const blade = box(0.1, 0.78, 0.035, COLORS.blade);
  blade.position.y = 0.62;
  const edge = box(0.045, 0.78, 0.04, COLORS.bladeDark);
  edge.position.set(0.028, 0.62, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), mat(COLORS.blade));
  tip.position.y = 1.08;
  tip.rotation.y = Math.PI / 4;
  tip.castShadow = true;
  const guard = box(0.34, 0.08, 0.1, COLORS.gold);
  guard.position.y = 0.2;
  const grip = cyl(0.045, 0.05, 0.26, COLORS.woodDark);
  grip.position.y = 0.06;
  const pommel = sphere(0.07, COLORS.gold);
  pommel.position.y = -0.08;
  g.add(blade, edge, tip, guard, grip, pommel);
  g.scale.setScalar(scale);
  return g;
}

// base común: grupo con referencias para animar (brazos, piernas, cabeza)
function baseBody({ headR, headColor, bodyColor, bodyScale, armR, legR }) {
  const g = new THREE.Group();

  const head = sphere(headR, headColor);
  head.position.y = 1.3;
  const face = makeFacePlane(headR * 1.3);
  face.position.set(0, -headR * 0.02, headR * 0.96);
  head.add(face);

  const body = sphere(0.42, bodyColor, bodyScale[0], bodyScale[1], bodyScale[2]);
  body.position.y = 0.62;

  const armL = new THREE.Group();
  const armR_ = new THREE.Group();
  for (const [arm, side] of [[armL, -1], [armR_, 1]]) {
    const upper = sphere(armR, bodyColor, 1, 1.5, 1);
    upper.position.y = -0.18;
    const hand = sphere(armR * 0.95, headColor);
    hand.position.y = -0.4;
    arm.add(upper, hand);
    arm.position.set(side * 0.46, 0.92, 0);
  }

  const legL = sphere(legR, bodyColor, 1, 1.25, 1);
  legL.position.set(-0.18, 0.16, 0);
  const legR_ = sphere(legR, bodyColor, 1, 1.25, 1);
  legR_.position.set(0.18, 0.16, 0);

  g.add(head, body, armL, armR_, legL, legR_);
  g.userData = { head, body, face, armL, armR: armR_, legL, legR: legR_ };
  return g;
}

// --- HÉROE: figura blanca con espada ---
export function makePlayer() {
  const g = baseBody({
    headR: 0.52, headColor: COLORS.white, bodyColor: COLORS.white,
    bodyScale: [1, 1.05, 0.85], armR: 0.14, legR: 0.15,
  });
  const sword = makeSword(1.2);
  sword.position.set(0, -0.42, 0.05);
  sword.rotation.z = -0.25;
  g.userData.armR.add(sword);
  g.userData.armR.rotation.x = -0.55;
  g.userData.armL.rotation.z = 0.25;
  g.userData.sword = sword;
  return g;
}

// --- cofre del tesoro ---
export function makeChest(rarity = 'common') {
  const colors = {
    common: { body: COLORS.wood, band: 0x777777 },
    rare: { body: 0x8a6a1e, band: COLORS.gold },
    epic: { body: 0x5a2f8f, band: COLORS.gold },
  }[rarity] || { body: COLORS.wood, band: 0x777777 };

  const g = new THREE.Group();
  const base = box(0.9, 0.5, 0.6, colors.body);
  base.position.y = 0.25;
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI),
    mat(colors.body)
  );
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.5;
  lid.castShadow = true;
  const band = box(0.92, 0.52, 0.14, colors.band);
  band.position.y = 0.25;
  const lock = box(0.14, 0.18, 0.08, COLORS.gold);
  lock.position.set(0, 0.42, 0.32);
  g.add(base, lid, band, lock);

  const light = new THREE.PointLight(rarity === 'epic' ? 0xaa66ff : 0xffcc55, 1.2, 4);
  light.position.y = 0.8;
  g.add(light);
  return g;
}

// --- flecha del arquero ---
export function makeArrow() {
  const g = new THREE.Group();
  const shaft = cyl(0.03, 0.03, 0.6, COLORS.wood, 6);
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), mat(COLORS.blade));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.36;
  const feather = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), mat(COLORS.blade));
  feather.rotation.x = -Math.PI / 2;
  feather.position.z = -0.3;
  g.add(shaft, tip, feather);
  return g;
}

// --- pociones / corazones que sueltan los enemigos ---
export function makeHeartPickup() {
  const g = new THREE.Group();
  const m = mat(0xe03040, { emissive: 0x801020, emissiveIntensity: 0.5 });
  for (const side of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), m);
    lobe.position.set(side * 0.11, 0.1, 0);
    lobe.castShadow = true;
    g.add(lobe);
  }
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 4), m);
  point.rotation.x = Math.PI;
  point.rotation.y = Math.PI / 4;
  point.position.y = -0.08;
  point.castShadow = true;
  g.add(point);
  return g;
}
