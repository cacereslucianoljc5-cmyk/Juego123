// Modelos 3D procedurales de los personajes, inspirados en las figuras NPC:
// héroe blanco con espada, esqueleto, bárbaro, arquero y gigante (jefe).
import * as THREE from 'three';

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

function makeBow() {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.045, 10, 24, Math.PI * 1.1),
    mat(COLORS.wood)
  );
  arc.rotation.z = -Math.PI * 0.05;
  arc.castShadow = true;
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(Math.cos(-Math.PI * 0.05) * 0.5, Math.sin(-Math.PI * 0.05) * 0.5, 0),
    new THREE.Vector3(Math.cos(Math.PI * 1.05) * 0.5, Math.sin(Math.PI * 1.05) * 0.5, 0),
  ]);
  const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xddccaa }));
  g.add(arc, string);
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

// --- ESQUELETO: rápido y frágil ---
export function makeSkeleton() {
  const g = new THREE.Group();
  const head = sphere(0.48, COLORS.bone);
  head.position.y = 1.42;
  const face = makeFacePlane(0.62);
  face.position.set(0, 0, 0.47);
  head.add(face);

  const spine = cyl(0.055, 0.055, 0.62, COLORS.bone, 8);
  spine.position.y = 0.72;
  const pelvis = sphere(0.14, COLORS.bone, 1.5, 0.7, 1);
  pelvis.position.y = 0.42;

  const ribs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.2 - i * 0.03, 0.035, 8, 16), mat(COLORS.bone));
    rib.rotation.x = Math.PI / 2;
    rib.position.y = 0.98 - i * 0.13;
    rib.scale.z = 0.75;
    rib.castShadow = true;
    ribs.add(rib);
  }

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [arm, side] of [[armL, -1], [armR, 1]]) {
    const boneArm = cyl(0.045, 0.045, 0.42, COLORS.bone, 8);
    boneArm.position.y = -0.2;
    const hand = sphere(0.08, COLORS.bone);
    hand.position.y = -0.42;
    arm.add(boneArm, hand);
    arm.position.set(side * 0.32, 1.02, 0);
  }
  const dagger = makeSword(0.55);
  dagger.position.set(0, -0.44, 0.04);
  armR.add(dagger);
  armR.rotation.x = -0.5;

  const legL = cyl(0.05, 0.05, 0.4, COLORS.bone, 8);
  legL.position.set(-0.13, 0.2, 0);
  const legR = cyl(0.05, 0.05, 0.4, COLORS.bone, 8);
  legR.position.set(0.13, 0.2, 0);

  g.add(head, spine, pelvis, ribs, armL, armR, legL, legR);
  g.userData = { head, armL, armR, legL, legR };
  return g;
}

// --- BÁRBARO: casco amarillo, bigote y espada ---
export function makeBarbarian() {
  const g = baseBody({
    headR: 0.5, headColor: COLORS.skin, bodyColor: COLORS.skin,
    bodyScale: [1.1, 1.05, 0.9], armR: 0.16, legR: 0.16,
  });
  const head = g.userData.head;

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.53, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(COLORS.yellow)
  );
  helmet.castShadow = true;
  helmet.position.y = 0.05;
  const brim = cyl(0.55, 0.55, 0.07, COLORS.yellow);
  brim.position.y = 0.08;
  head.add(helmet, brim);
  g.userData.face.position.z = 0.58;

  // bigote
  for (const side of [-1, 1]) {
    const m = sphere(0.1, COLORS.yellow, 1.4, 0.55, 0.6);
    m.position.set(side * 0.16, -0.16, 0.44);
    m.rotation.z = side * -0.5;
    head.add(m);
  }

  const belt = cyl(0.45, 0.45, 0.12, COLORS.leatherDark);
  belt.position.y = 0.5;
  const buckle = box(0.16, 0.13, 0.05, COLORS.gold);
  buckle.position.set(0, 0.5, 0.4);
  g.add(belt, buckle);

  const sword = makeSword(0.8);
  sword.position.set(0, -0.44, 0.05);
  g.userData.armR.add(sword);
  g.userData.armR.rotation.x = -0.4;
  return g;
}

// --- ARQUERO: capucha azul y arco ---
export function makeArcher() {
  const g = baseBody({
    headR: 0.5, headColor: COLORS.white, bodyColor: COLORS.white,
    bodyScale: [0.95, 1, 0.82], armR: 0.13, legR: 0.14,
  });
  const head = g.userData.head;

  // capucha: cono redondeado + capa
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    mat(COLORS.blue)
  );
  hood.castShadow = true;
  hood.position.y = 0.03;
  const hoodTip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 12), mat(COLORS.blue));
  hoodTip.position.set(0, 0.52, -0.12);
  hoodTip.rotation.x = -0.5;
  hoodTip.castShadow = true;
  head.add(hood, hoodTip);
  g.userData.face.position.z = 0.61;
  g.userData.face.position.y = -0.12;

  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.75, 14, 1, true), mat(COLORS.blue, { side: THREE.DoubleSide }));
  cape.position.set(0, 0.72, -0.14);
  cape.castShadow = true;
  g.add(cape);

  const belt = cyl(0.41, 0.41, 0.1, COLORS.leather);
  belt.position.y = 0.55;
  g.add(belt);

  // carcaj en la espalda
  const quiver = cyl(0.09, 0.09, 0.44, COLORS.leatherDark);
  quiver.position.set(0.2, 0.95, -0.32);
  quiver.rotation.z = -0.4;
  g.add(quiver);

  const bow = makeBow();
  bow.position.set(0, -0.4, 0.08);
  bow.rotation.y = Math.PI / 2;
  g.userData.armL.add(bow);
  g.userData.armL.rotation.x = -0.6;
  g.userData.bow = bow;
  return g;
}

// --- GIGANTE: jefe con pelo naranja y chaleco de cuero ---
export function makeGiant() {
  const g = baseBody({
    headR: 0.55, headColor: COLORS.skin, bodyColor: COLORS.skin,
    bodyScale: [1.35, 1.15, 1.05], armR: 0.22, legR: 0.2,
  });
  const head = g.userData.head;

  // pelo naranja a los costados y atrás
  for (const [x, y, z, s] of [
    [-0.42, -0.05, 0.1, 0.28], [0.42, -0.05, 0.1, 0.28],
    [-0.3, 0.05, -0.35, 0.3], [0.3, 0.05, -0.35, 0.3], [0, 0.02, -0.48, 0.32],
  ]) {
    const tuft = sphere(s, COLORS.orange, 1, 1.3, 1);
    tuft.position.set(x, y, z);
    head.add(tuft);
  }
  // cejas
  for (const side of [-1, 1]) {
    const brow = box(0.22, 0.07, 0.06, COLORS.orange);
    brow.position.set(side * 0.18, 0.2, 0.46);
    head.add(brow);
  }

  // chaleco de cuero
  const vest = cyl(0.52, 0.62, 0.72, COLORS.leather);
  vest.position.y = 0.68;
  const belt = cyl(0.58, 0.58, 0.14, COLORS.leatherDark);
  belt.position.y = 0.42;
  const buckle = box(0.2, 0.16, 0.06, COLORS.gold);
  buckle.position.set(0, 0.42, 0.56);
  g.add(vest, belt, buckle);

  g.scale.setScalar(2.1);
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
