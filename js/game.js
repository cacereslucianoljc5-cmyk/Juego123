// Mazmorra NPC — juego de oleadas estilo Isaac en 3D.
import * as THREE from 'three';
import {
  makePlayer, makeSkeleton, makeBarbarian, makeArcher, makeGiant,
  makeChest, makeArrow, makeHeartPickup, loadAssets, getArena,
} from './characters.js?v=3';

// ------------------------------------------------------------------ constantes
const ROOM = 16;              // mitad del área jugable dentro de la arena
const ARENA_SCALE = 24;       // escala del modelo Arena.glb
const PLAYER_SPEED = 6.2;
const PLAYER_MAX_HP = 12;     // medios corazones (6 corazones)
const ATTACK_RANGE = 2.5;
const ATTACK_ARC = Math.PI * 0.62;
const ATTACK_COOLDOWN = 0.38;
const INVULN_TIME = 1.0;

const ENEMY_TYPES = {
  skeleton:  { make: makeSkeleton,  hp: 2,  speed: 3.6, radius: 0.5, dmg: 1, score: 10,  attackRange: 1.3, cooldown: 1.0 },
  archer:    { make: makeArcher,    hp: 2,  speed: 2.6, radius: 0.5, dmg: 1, score: 15,  attackRange: 11,  cooldown: 2.1, ranged: true, keepDistance: 7 },
  barbarian: { make: makeBarbarian, hp: 5,  speed: 2.7, radius: 0.55, dmg: 2, score: 25, attackRange: 1.5, cooldown: 1.2 },
  giant:     { make: makeGiant,     hp: 40, speed: 1.6, radius: 1.15, dmg: 2, score: 250, attackRange: 2.9, cooldown: 2.4, boss: true },
};

const CHEST_LOOT = {
  common: { icon: '🧰', name: 'Cofre de madera', min: 20, max: 60 },
  rare:   { icon: '✨', name: 'Cofre dorado',    min: 70, max: 180 },
  epic:   { icon: '🔮', name: 'Cofre mágico',    min: 200, max: 500 },
};

const SAVE = {
  get coins() { return parseInt(localStorage.getItem('npc3d_coins') || '0', 10); },
  set coins(v) { localStorage.setItem('npc3d_coins', String(v)); },
  get best() { return parseInt(localStorage.getItem('npc3d_best') || '0', 10); },
  set best(v) { localStorage.setItem('npc3d_best', String(v)); },
  get chests() { try { return JSON.parse(localStorage.getItem('npc3d_chests') || '[]'); } catch { return []; } },
  set chests(v) { localStorage.setItem('npc3d_chests', JSON.stringify(v)); },
};

// ------------------------------------------------------------------ audio
const audio = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    try {
      const a = ac();
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, a.currentTime);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
      gain.gain.setValueAtTime(vol, a.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      osc.connect(gain).connect(a.destination);
      osc.start();
      osc.stop(a.currentTime + dur);
    } catch { /* sin audio */ }
  }
  return {
    unlock: ac,
    swing: () => tone(220, 0.12, 'sawtooth', 0.06, -120),
    hit: () => tone(160, 0.1, 'square', 0.1, -60),
    hurt: () => tone(110, 0.25, 'sawtooth', 0.14, -60),
    kill: () => tone(300, 0.18, 'triangle', 0.12, -180),
    pickup: () => { tone(660, 0.09, 'square', 0.08); setTimeout(() => tone(880, 0.12, 'square', 0.08), 80); },
    chest: () => { tone(523, 0.1, 'triangle', 0.1); setTimeout(() => tone(659, 0.1, 'triangle', 0.1), 100); setTimeout(() => tone(784, 0.2, 'triangle', 0.1), 200); },
    wave: () => { tone(392, 0.15, 'triangle', 0.1); setTimeout(() => tone(523, 0.2, 'triangle', 0.1), 150); },
    boss: () => tone(70, 0.9, 'sawtooth', 0.16, -25),
    arrow: () => tone(500, 0.08, 'square', 0.05, -200),
  };
})();

// ------------------------------------------------------------------ escena
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101624);
scene.fog = new THREE.Fog(0x101624, 40, 85);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 12, 8.6);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// luces
scene.add(new THREE.HemisphereLight(0xbfc4e8, 0x54486a, 0.85));
const dirLight = new THREE.DirectionalLight(0xfff2dd, 1.6);
dirLight.position.set(8, 18, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -26; dirLight.shadow.camera.right = 26;
dirLight.shadow.camera.top = 26; dirLight.shadow.camera.bottom = -26;
scene.add(dirLight);

// ------------------------------------------------------------------ la arena (mapa del repo clash3deee)
const torchLights = [];   // (la arena trae su propia decoración)
const obstacles = [];     // sin rocas: el campo de la arena queda libre

function setupArena() {
  const arena = getArena();
  arena.scale.setScalar(ARENA_SCALE);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  arena.traverse((o) => {
    if (o.isMesh && o.material.map) o.material.map.anisotropy = Math.min(4, maxAniso);
  });
  scene.add(arena);
  arena.updateMatrixWorld(true);

  // apoyar el campo de juego en y=0: medir la altura del pasto con un rayo
  const down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster();
  const heights = [];
  for (const [px, pz] of [[0, ROOM * 0.55], [0, -ROOM * 0.55], [ROOM * 0.4, ROOM * 0.5], [-ROOM * 0.4, -ROOM * 0.5]]) {
    ray.set(new THREE.Vector3(px, 60, pz), down);
    const hit = ray.intersectObject(arena, true)[0];
    if (hit) heights.push(hit.point.y);
  }
  if (heights.length) {
    heights.sort((a, b) => a - b);
    arena.position.y = -heights[Math.floor(heights.length / 2)];
  }
}

// ------------------------------------------------------------------ estado del juego
const ui = {
  hearts: document.getElementById('hearts'),
  score: document.getElementById('score'),
  coins: document.getElementById('coins'),
  chestCount: document.getElementById('chest-count'),
  best: document.getElementById('best'),
  waveLabel: document.getElementById('wave-label'),
  banner: document.getElementById('banner'),
  bossBar: document.getElementById('boss-bar'),
  bossName: document.getElementById('boss-name'),
  bossFill: document.getElementById('boss-fill'),
  chestToast: document.getElementById('chest-toast'),
  damageFlash: document.getElementById('damage-flash'),
  startOverlay: document.getElementById('start-overlay'),
  gameoverOverlay: document.getElementById('gameover-overlay'),
  pauseOverlay: document.getElementById('pause-overlay'),
  chestOverlay: document.getElementById('chest-overlay'),
  finalScore: document.getElementById('final-score'),
  finalWaves: document.getElementById('final-waves'),
  newRecord: document.getElementById('new-record'),
  chestGrid: document.getElementById('chest-grid'),
  chestReward: document.getElementById('chest-reward'),
  menuCoins: document.getElementById('menu-coins'),
};

let state = 'menu';           // menu | playing | paused | chests | gameover
let chestReturnState = 'menu';

const playerMesh = makePlayer();
playerMesh.castShadow = true;
scene.add(playerMesh);

const player = {
  mesh: playerMesh,
  pos: new THREE.Vector3(0, 0, 0),
  facing: 0,
  hp: PLAYER_MAX_HP,
  radius: 0.55,
  attackTimer: 0,
  swingTime: -1,
  swingHit: new Set(),
  invuln: 0,
  walkPhase: 0,
};

let enemies = [];
let dying = [];     // enemigos muertos en plena animación de caída
let arrows = [];
let pickups = [];   // { kind: 'chest'|'heart', mesh, pos, rarity?, bob }
let particles = [];
let telegraphs = []; // { mesh, t, dur, cb }
let spawnQueue = [];
let pendingSpawns = 0;

let wave = 0;
let score = 0;
let waveState = 'idle'; // idle | announcing | spawning | fighting | cleared
let waveTimer = 0;
let shake = 0;
let bossRef = null;

const keys = {};
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();

// ------------------------------------------------------------------ entrada
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); tryAttack(); }
  if (e.code === 'KeyE') toggleChestMenu();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) tryAttack(); });

// ------------------------------------------------------------------ controles táctiles
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const touchInput = { x: 0, z: 0, attacking: false };
if (isTouchDevice) {
  document.body.classList.add('touch');

  const joy = document.getElementById('joystick');
  const stick = document.getElementById('joystick-stick');
  const JOY_MAX = 46;
  let joyPointer = null;
  function moveStick(e) {
    const rect = joy.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    touchInput.x = dx / JOY_MAX;
    touchInput.z = dy / JOY_MAX;
  }
  joy.addEventListener('pointerdown', (e) => {
    joyPointer = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    audio.unlock();
    moveStick(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointer) moveStick(e); });
  const releaseJoy = (e) => {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null;
    touchInput.x = touchInput.z = 0;
    stick.style.transform = 'translate(-50%, -50%)';
  };
  joy.addEventListener('pointerup', releaseJoy);
  joy.addEventListener('pointercancel', releaseJoy);

  const atkBtn = document.getElementById('btn-attack');
  atkBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchInput.attacking = true;
    audio.unlock();
    tryAttack();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    atkBtn.addEventListener(ev, () => { touchInput.attacking = false; });
  }
  atkBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  document.getElementById('btn-chest-touch').addEventListener('click', toggleChestMenu);
  document.getElementById('btn-pause-touch').addEventListener('click', togglePause);
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-close-chests').addEventListener('click', toggleChestMenu);
document.getElementById('btn-chests-start').addEventListener('click', () => openChestMenu('menu'));
document.getElementById('btn-chests-over').addEventListener('click', () => openChestMenu('gameover'));

// ------------------------------------------------------------------ flujo del juego
function startGame() {
  audio.unlock();
  for (const e of enemies) scene.remove(e.mesh);
  for (const d of dying) scene.remove(d.mesh);
  dying = [];
  for (const a of arrows) scene.remove(a.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  for (const t of telegraphs) scene.remove(t.mesh);
  for (const p of particles) scene.remove(p.mesh);
  enemies = []; arrows = []; pickups = []; particles = []; telegraphs = []; spawnQueue = [];
  pendingSpawns = 0;

  player.pos.set(0, 0, 6);   // sobre el pasto, no en el río del centro
  player.hp = PLAYER_MAX_HP;
  player.invuln = 0;
  player.attackTimer = 0;
  player.swingTime = -1;
  wave = 0;
  score = 0;
  bossRef = null;
  waveState = 'cleared';
  waveTimer = 1.2;

  ui.startOverlay.classList.remove('show');
  ui.gameoverOverlay.classList.remove('show');
  ui.pauseOverlay.classList.remove('show');
  ui.chestOverlay.classList.remove('show');
  ui.bossBar.style.display = 'none';
  state = 'playing';
  updateHud();
}

function gameOver() {
  state = 'gameover';
  const survived = Math.max(0, wave - (waveState === 'cleared' ? 0 : 1));
  ui.finalScore.textContent = score;
  ui.finalWaves.textContent = survived;
  const isRecord = score > SAVE.best;
  if (isRecord) SAVE.best = score;
  ui.newRecord.style.display = isRecord ? 'block' : 'none';
  ui.gameoverOverlay.classList.add('show');
  ui.bossBar.style.display = 'none';
  updateHud();
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    ui.pauseOverlay.classList.add('show');
  } else if (state === 'paused') {
    state = 'playing';
    ui.pauseOverlay.classList.remove('show');
  }
}

// ------------------------------------------------------------------ oleadas
function waveComposition(w) {
  if (w % 5 === 0) {
    // oleada de jefe
    const list = [{ type: 'giant', count: 1 + Math.floor(w / 15) }];
    list.push({ type: 'skeleton', count: 2 + Math.floor(w / 4) });
    if (w >= 10) list.push({ type: 'archer', count: 2 });
    return list;
  }
  const list = [{ type: 'skeleton', count: 2 + Math.ceil(w * 1.1) }];
  if (w >= 2) list.push({ type: 'archer', count: Math.min(6, Math.floor(w / 2) + 1) });
  if (w >= 3) list.push({ type: 'barbarian', count: Math.min(7, Math.floor((w - 1) / 2)) });
  return list;
}

function startWave() {
  wave++;
  const comp = waveComposition(wave);
  spawnQueue = [];
  for (const { type, count } of comp) {
    for (let i = 0; i < count; i++) spawnQueue.push(type);
  }
  // mezclar
  for (let i = spawnQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spawnQueue[i], spawnQueue[j]] = [spawnQueue[j], spawnQueue[i]];
  }
  const isBoss = wave % 5 === 0;
  showBanner(isBoss ? `☠️ OLEADA ${wave} — ¡JEFE!` : `Oleada ${wave}`,
    isBoss ? 'El gigante suelta un cofre del tesoro' : `${spawnQueue.length} enemigos`);
  if (isBoss) audio.boss(); else audio.wave();
  waveState = 'spawning';
  waveTimer = 0.7;
  updateHud();
}

function spawnPosition() {
  for (let tries = 0; tries < 24; tries++) {
    const x = (Math.random() * 2 - 1) * (ROOM - 2);
    const z = (Math.random() * 2 - 1) * (ROOM - 2);
    const dx = x - player.pos.x, dz = z - player.pos.z;
    if (dx * dx + dz * dz < 36) continue;                       // lejos del jugador
    if (obstacles.some(o => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 1) ** 2)) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (ROOM - 2), 0, 0);
}

function spawnEnemy(type) {
  const cfg = ENEMY_TYPES[type];
  const pos = spawnPosition();
  pendingSpawns++;
  // círculo de aviso antes de aparecer
  addTelegraph(pos, cfg.boss ? 2.4 : 1.1, 0.85, 0xcc3355, () => {
    pendingSpawns--;
    const mesh = cfg.make();
    mesh.position.copy(pos);
    scene.add(mesh);
    const waveScale = 1 + (wave - 1) * 0.09;
    const enemy = {
      type, cfg, mesh,
      pos: pos.clone(),
      hp: Math.round(cfg.hp * (cfg.boss ? 1 + (wave / 5 - 1) * 0.55 : waveScale)),
      maxHp: 0,
      cooldown: cfg.cooldown * (0.6 + Math.random() * 0.6),
      walkPhase: Math.random() * 6,
      hitFlash: 0,
      slamAt: -1,
      atkT: -1,        // temporizador de la animación de ataque
      moveBlend: 0,    // 0 quieto → 1 caminando
    };
    enemy.maxHp = enemy.hp;
    enemies.push(enemy);
    if (cfg.boss) {
      bossRef = enemy;
      ui.bossName.textContent = `👹 Gigante — oleada ${wave}`;
      ui.bossBar.style.display = 'block';
    }
  });
}

// ------------------------------------------------------------------ combate
function tryAttack() {
  if (state !== 'playing' || player.attackTimer > 0) return;
  player.attackTimer = ATTACK_COOLDOWN;
  player.swingTime = 0;
  player.swingHit = new Set();
  audio.swing();
}

function damageEnemy(enemy, dmg, knockDir) {
  enemy.hp -= dmg;
  enemy.hitFlash = 0.12;
  audio.hit();
  spawnParticles(enemy.pos, 0xffdd88, 6);
  if (knockDir && !enemy.cfg.boss) {
    enemy.pos.addScaledVector(knockDir, 0.55);
  }
  if (enemy.hp <= 0) killEnemy(enemy);
}

function killEnemy(enemy) {
  dying.push({ mesh: enemy.mesh, t: 0 });   // animación de caída antes de desaparecer
  enemies = enemies.filter(e => e !== enemy);
  score += enemy.cfg.score * (1 + Math.floor(wave / 10));
  audio.kill();
  spawnParticles(enemy.pos, 0xffffff, 12);

  if (enemy.cfg.boss) {
    if (bossRef === enemy) { bossRef = null; ui.bossBar.style.display = 'none'; }
    shake = Math.max(shake, 0.5);
    dropChest(enemy.pos);
  } else if (Math.random() < 0.07 && player.hp < PLAYER_MAX_HP) {
    dropHeart(enemy.pos);
  }
  updateHud();
}

function damagePlayer(dmg) {
  if (player.invuln > 0 || state !== 'playing') return;
  player.hp -= dmg;
  player.invuln = INVULN_TIME;
  shake = Math.max(shake, 0.35);
  audio.hurt();
  ui.damageFlash.classList.add('show');
  setTimeout(() => ui.damageFlash.classList.remove('show'), 120);
  updateHud();
  if (player.hp <= 0) gameOver();
}

// ------------------------------------------------------------------ objetos que caen
function rollRarity() {
  const r = Math.random();
  if (r < 0.08) return 'epic';
  if (r < 0.38) return 'rare';
  return 'common';
}

function dropChest(pos) {
  const rarity = rollRarity();
  const mesh = makeChest(rarity);
  mesh.position.set(pos.x, 0, pos.z);
  scene.add(mesh);
  pickups.push({ kind: 'chest', rarity, mesh, pos: mesh.position.clone(), bob: 0 });
}

function dropHeart(pos) {
  const mesh = makeHeartPickup();
  mesh.position.set(pos.x, 0.6, pos.z);
  scene.add(mesh);
  pickups.push({ kind: 'heart', mesh, pos: mesh.position.clone(), bob: Math.random() * 6 });
}

function collectPickup(p) {
  scene.remove(p.mesh);
  pickups = pickups.filter(x => x !== p);
  if (p.kind === 'chest') {
    const inv = SAVE.chests;
    inv.push({ rarity: p.rarity, wave });
    SAVE.chests = inv;
    audio.chest();
    toast(`${CHEST_LOOT[p.rarity].icon} ¡${CHEST_LOOT[p.rarity].name} guardado! Abrilo con E`);
  } else {
    player.hp = Math.min(PLAYER_MAX_HP, player.hp + 2);
    audio.pickup();
  }
  updateHud();
}

// ------------------------------------------------------------------ efectos
const telegraphGeo = new THREE.RingGeometry(0.72, 1, 32);
function addTelegraph(pos, radius, dur, color, cb) {
  const mesh = new THREE.Mesh(telegraphGeo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.03, pos.z);
  mesh.scale.setScalar(0.01);
  scene.add(mesh);
  telegraphs.push({ mesh, t: 0, dur, radius, cb });
}

const particleGeo = new THREE.SphereGeometry(0.07, 6, 5);
function spawnParticles(pos, color, n) {
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(pos.x, 0.8 + Math.random() * 0.6, pos.z);
    scene.add(mesh);
    particles.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5),
      life: 0.5 + Math.random() * 0.3,
      t: 0,
    });
  }
}

// ------------------------------------------------------------------ HUD
function updateHud() {
  const full = Math.floor(player.hp / 2);
  const half = player.hp % 2;
  const empty = Math.floor((PLAYER_MAX_HP - player.hp) / 2);
  ui.hearts.textContent = '❤️'.repeat(full) + '💔'.repeat(half) + '🖤'.repeat(empty);
  ui.score.textContent = score;
  ui.coins.textContent = SAVE.coins;
  ui.chestCount.textContent = SAVE.chests.length;
  ui.best.textContent = SAVE.best;
  ui.waveLabel.textContent = wave > 0 ? `— Oleada ${wave} —` : '';
  if (bossRef) ui.bossFill.style.width = `${Math.max(0, (bossRef.hp / bossRef.maxHp) * 100)}%`;
}

let bannerTimeout = null;
function showBanner(title, sub) {
  ui.banner.innerHTML = `${title}<div class="sub">${sub || ''}</div>`;
  ui.banner.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => ui.banner.classList.remove('show'), 2200);
}

let toastTimeout = null;
function toast(text) {
  ui.chestToast.textContent = text;
  ui.chestToast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => ui.chestToast.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ menú de cofres
function toggleChestMenu() {
  if (state === 'chests') {
    ui.chestOverlay.classList.remove('show');
    state = chestReturnState;
    if (state === 'menu') ui.startOverlay.classList.add('show');
    if (state === 'gameover') ui.gameoverOverlay.classList.add('show');
  } else if (state === 'playing' || state === 'menu' || state === 'gameover') {
    openChestMenu(state);
  }
}

function openChestMenu(from) {
  chestReturnState = from === 'paused' ? 'playing' : from;
  state = 'chests';
  ui.startOverlay.classList.remove('show');
  ui.gameoverOverlay.classList.remove('show');
  ui.chestReward.textContent = '';
  renderChestGrid();
  ui.chestOverlay.classList.add('show');
}

function renderChestGrid() {
  ui.menuCoins.textContent = SAVE.coins;
  const inv = SAVE.chests;
  ui.chestGrid.innerHTML = '';
  if (!inv.length) {
    ui.chestGrid.innerHTML = '<div id="chest-empty">No tenés cofres. ¡Derrotá jefes para conseguirlos!</div>';
    return;
  }
  inv.forEach((chest, i) => {
    const loot = CHEST_LOOT[chest.rarity] || CHEST_LOOT.common;
    const card = document.createElement('div');
    card.className = `chest-card ${chest.rarity}`;
    card.innerHTML = `<div class="icon">${loot.icon}</div><div class="label">${loot.name}<br>oleada ${chest.wave || '?'}</div>`;
    card.addEventListener('click', () => openChest(i, card));
    ui.chestGrid.appendChild(card);
  });
}

let openingChest = false;
function openChest(index, card) {
  if (openingChest) return;
  openingChest = true;
  card.classList.add('opening');
  audio.chest();
  setTimeout(() => {
    const inv = SAVE.chests;
    const chest = inv.splice(index, 1)[0];
    SAVE.chests = inv;
    const loot = CHEST_LOOT[chest?.rarity] || CHEST_LOOT.common;
    const amount = loot.min + Math.floor(Math.random() * (loot.max - loot.min + 1));
    SAVE.coins = SAVE.coins + amount;
    ui.chestReward.textContent = `${loot.icon} ¡+${amount} monedas! 🪙`;
    audio.pickup();
    renderChestGrid();
    updateHud();
    openingChest = false;
  }, 520);
}

// ------------------------------------------------------------------ actualización
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function clampToRoom(pos, radius) {
  const lim = ROOM - radius - 0.2;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
  for (const o of obstacles) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d2 = dx * dx + dz * dz;
    const min = o.r + radius;
    if (d2 > 0.0001 && d2 < min * min) {
      const d = Math.sqrt(d2);
      pos.x = o.x + (dx / d) * min;
      pos.z = o.z + (dz / d) * min;
    }
  }
}

function updatePlayer(dt) {
  // movimiento
  tmpV.set(
    (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
    0,
    (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0)
  );
  // joystick táctil
  if (Math.hypot(touchInput.x, touchInput.z) > 0.18) {
    tmpV.set(touchInput.x, 0, touchInput.z);
  }
  const moving = tmpV.lengthSq() > 0;
  if (moving) {
    if (tmpV.lengthSq() > 1) tmpV.normalize();
    player.pos.addScaledVector(tmpV, PLAYER_SPEED * dt);
    clampToRoom(player.pos, player.radius);
    player.walkPhase += dt * 11;
  }

  if (isTouchDevice) {
    // en el celular: apuntar solo al enemigo más cercano
    let nearest = null, nearestD = Infinity;
    for (const e of enemies) {
      const d = e.pos.distanceToSquared(player.pos);
      if (d < nearestD) { nearestD = d; nearest = e; }
    }
    if (nearest) {
      player.facing = Math.atan2(nearest.pos.x - player.pos.x, nearest.pos.z - player.pos.z);
    } else if (moving) {
      player.facing = Math.atan2(tmpV.x, tmpV.z);
    }
    // mantener apretado el botón = atacar sin parar
    if (touchInput.attacking) tryAttack();
  } else {
    // apuntar con el ratón
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(floorPlane, aimPoint)) {
      const dx = aimPoint.x - player.pos.x;
      const dz = aimPoint.z - player.pos.z;
      if (dx * dx + dz * dz > 0.04) player.facing = Math.atan2(dx, dz);
    } else if (moving) {
      player.facing = Math.atan2(tmpV.x, tmpV.z);
    }
  }

  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.facing;

  // animación de caminar
  const bob = moving ? Math.sin(player.walkPhase) : 0;
  player.mesh.position.y = Math.abs(bob) * 0.09;
  const u = player.mesh.userData;
  u.legL.position.z = bob * 0.14;
  u.legR.position.z = -bob * 0.14;
  u.armL.rotation.x = bob * 0.5;

  // espadazo
  player.attackTimer -= dt;
  if (player.swingTime >= 0) {
    player.swingTime += dt;
    const t = player.swingTime / 0.26;
    if (t >= 1) {
      player.swingTime = -1;
      u.armR.rotation.set(-0.35, 0, 0);
    } else {
      // el brazo barre de izquierda a derecha
      const sweep = (t - 0.5) * ATTACK_ARC * 1.25;
      u.armR.rotation.set(-1.5, -sweep, 0);
      // daño en el arco
      if (t > 0.2 && t < 0.85) {
        for (const e of enemies) {
          if (player.swingHit.has(e)) continue;
          tmpV2.subVectors(e.pos, player.pos);
          const dist = tmpV2.length() - e.cfg.radius * (e.cfg.boss ? 1.6 : 1);
          if (dist > ATTACK_RANGE) continue;
          const ang = Math.atan2(tmpV2.x, tmpV2.z);
          let diff = ang - player.facing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < ATTACK_ARC / 2 + 0.2) {
            player.swingHit.add(e);
            damageEnemy(e, 1, tmpV2.normalize());
          }
        }
        // cortar flechas
        arrows = arrows.filter(a => {
          if (a.pos.distanceTo(player.pos) < ATTACK_RANGE * 0.8) {
            scene.remove(a.mesh);
            spawnParticles(a.pos, 0xccccff, 3);
            return false;
          }
          return true;
        });
      }
    }
  }

  // invulnerabilidad (parpadeo)
  player.invuln -= dt;
  player.mesh.visible = player.invuln <= 0 || Math.sin(performance.now() * 0.03) > -0.3;
}

function updateEnemies(dt) {
  for (const e of enemies) {
    const cfg = e.cfg;
    tmpV.subVectors(player.pos, e.pos);
    const dist = tmpV.length();
    tmpV.normalize();
    e.cooldown -= dt;

    let vx = 0, vz = 0;
    if (cfg.ranged) {
      // el arquero mantiene distancia y dispara
      if (dist > cfg.keepDistance + 1.5) { vx = tmpV.x; vz = tmpV.z; }
      else if (dist < cfg.keepDistance - 1.5) { vx = -tmpV.x; vz = -tmpV.z; }
      else { vx = -tmpV.z * 0.6; vz = tmpV.x * 0.6; } // rodear
      if (e.cooldown <= 0 && dist < cfg.attackRange) {
        e.cooldown = cfg.cooldown;
        e.atkT = 0;
        shootArrow(e);
      }
    } else if (cfg.boss) {
      if (e.slamAt < 0) {
        vx = tmpV.x; vz = tmpV.z;
        if (dist < cfg.attackRange && e.cooldown <= 0) {
          // telegrafiar el pisotón
          e.slamAt = 0.75;
          addTelegraph(e.pos, 3.4, 0.75, 0xff5533, () => {});
        }
      } else {
        e.slamAt -= dt;
        if (e.slamAt <= 0) {
          e.slamAt = -1;
          e.atkT = 0;
          e.cooldown = cfg.cooldown;
          shake = Math.max(shake, 0.45);
          audio.boss();
          spawnParticles(e.pos, 0xffaa55, 14);
          if (player.pos.distanceTo(e.pos) < 3.6) damagePlayer(cfg.dmg);
        }
      }
    } else {
      vx = tmpV.x; vz = tmpV.z;
      if (dist < cfg.attackRange && e.cooldown <= 0) {
        e.cooldown = cfg.cooldown;
        e.atkT = 0;
        damagePlayer(cfg.dmg);
        // pequeño empujón al golpear
        e.pos.addScaledVector(tmpV, -0.3);
      }
    }

    e.pos.x += vx * cfg.speed * dt;
    e.pos.z += vz * cfg.speed * dt;

    // separación entre enemigos
    for (const other of enemies) {
      if (other === e) continue;
      const dx = e.pos.x - other.pos.x, dz = e.pos.z - other.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = cfg.radius + other.cfg.radius;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        e.pos.x += (dx / d) * push;
        e.pos.z += (dz / d) * push;
      }
    }
    clampToRoom(e.pos, cfg.radius);

    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = Math.atan2(tmpV.x, tmpV.z);

    // ---- animación procedural (los GLB no traen esqueleto) ----
    const inner = e.mesh.children[0];
    const moving = (vx !== 0 || vz !== 0) ? 1 : 0;
    e.moveBlend += (moving - e.moveBlend) * Math.min(1, dt * 8);
    const stride = cfg.boss ? 6 : 10;
    e.walkPhase += dt * stride * (0.35 + 0.65 * e.moveBlend);

    // caminar: saltitos + contoneo lateral + leve inclinación hacia adelante
    e.mesh.position.y = Math.abs(Math.sin(e.walkPhase)) * 0.1 * (cfg.boss ? 2.2 : 1) * (0.3 + 0.7 * e.moveBlend);
    let tiltX = 0.09 * e.moveBlend;
    let tiltZ = Math.sin(e.walkPhase) * 0.1 * e.moveBlend;
    let lungeZ = 0;

    // ataque: embestida (cuerpo a cuerpo / pisotón) o retroceso (arquero)
    if (e.atkT >= 0) {
      e.atkT += dt;
      const dur = cfg.boss ? 0.5 : 0.32;
      const k = e.atkT / dur;
      if (k >= 1) {
        e.atkT = -1;
      } else if (cfg.ranged) {
        tiltX = -Math.sin(k * Math.PI) * 0.4;          // el arquero se echa atrás al soltar
      } else {
        tiltX = Math.sin(k * Math.PI) * (cfg.boss ? 0.7 : 0.95);
        lungeZ = Math.sin(k * Math.PI) * (cfg.boss ? 0.5 : 0.35);
      }
    }
    // el gigante se agacha tomando impulso durante el aviso del pisotón
    if (e.slamAt > 0) {
      const kk = (0.75 - e.slamAt) / 0.75;
      e.mesh.position.y += Math.sin(kk * Math.PI) * 1.4;
      tiltX = -0.45 * Math.sin(kk * Math.PI);
    }
    inner.rotation.x = tiltX;
    inner.rotation.z = tiltZ;
    inner.position.z = lungeZ;

    // parpadeo al recibir daño
    if (e.hitFlash > 0) {
      e.hitFlash -= dt;
      e.mesh.traverse(o => { if (o.material && o.material.emissive) o.material.emissive.setHex(0x883322); });
      if (e.hitFlash <= 0) e.mesh.traverse(o => { if (o.material && o.material.emissive) o.material.emissive.setHex(0x000000); });
    }
  }
  if (bossRef) updateHud();
}

function shootArrow(e) {
  const mesh = makeArrow();
  const dir = tmpV2.subVectors(player.pos, e.pos).setY(0).normalize().clone();
  mesh.position.set(e.pos.x, 0.9, e.pos.z);
  mesh.lookAt(player.pos.x, 0.9, player.pos.z);
  scene.add(mesh);
  arrows.push({ mesh, pos: mesh.position.clone(), dir, speed: 8.5, life: 3.2, dmg: e.cfg.dmg });
  audio.arrow();
}

function updateArrows(dt) {
  arrows = arrows.filter(a => {
    a.life -= dt;
    a.pos.addScaledVector(a.dir, a.speed * dt);
    a.mesh.position.copy(a.pos);
    if (a.life <= 0 || Math.abs(a.pos.x) > ROOM || Math.abs(a.pos.z) > ROOM) {
      scene.remove(a.mesh);
      return false;
    }
    for (const o of obstacles) {
      if ((a.pos.x - o.x) ** 2 + (a.pos.z - o.z) ** 2 < o.r * o.r) {
        scene.remove(a.mesh);
        spawnParticles(a.pos, 0x998877, 3);
        return false;
      }
    }
    const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z;
    if (dx * dx + dz * dz < (player.radius + 0.25) ** 2) {
      damagePlayer(a.dmg);
      scene.remove(a.mesh);
      return false;
    }
    return true;
  });
}

function updatePickups(dt) {
  for (const p of [...pickups]) {
    p.bob += dt * 3;
    p.mesh.position.y = p.pos.y + Math.sin(p.bob) * 0.12 + (p.kind === 'heart' ? 0.15 : 0.05);
    p.mesh.rotation.y += dt * (p.kind === 'heart' ? 2.5 : 0.8);
    if (p.pos.distanceTo(player.pos) < 1.1) collectPickup(p);
  }
}

function updateDying(dt) {
  dying = dying.filter((d) => {
    d.t += dt;
    const k = d.t / 0.45;
    if (k >= 1) { scene.remove(d.mesh); return false; }
    d.mesh.rotation.x = k * 1.5;                    // cae de espaldas
    d.mesh.scale.setScalar(Math.max(0.01, 1 - k * 0.7));
    d.mesh.position.y = Math.max(0, d.mesh.position.y - dt * 1.2);
    return true;
  });
}

function updateEffects(dt) {
  telegraphs = telegraphs.filter(t => {
    t.t += dt;
    const k = Math.min(1, t.t / t.dur);
    t.mesh.scale.setScalar(t.radius * k);
    t.mesh.material.opacity = 0.7 - k * 0.25;
    if (k >= 1) {
      scene.remove(t.mesh);
      t.cb();
      return false;
    }
    return true;
  });

  particles = particles.filter(p => {
    p.t += dt;
    if (p.t >= p.life) { scene.remove(p.mesh); return false; }
    p.vel.y -= 9 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.y *= -0.4; }
    p.mesh.material.opacity = 1 - p.t / p.life;
    return true;
  });

  // antorchas titilantes
  const t = performance.now() * 0.004;
  torchLights.forEach(({ light, flame }, i) => {
    light.intensity = 5 + Math.sin(t * 3 + i * 1.7) * 1.2 + Math.sin(t * 7.3 + i) * 0.7;
    flame.scale.y = 1 + Math.sin(t * 9 + i * 2.1) * 0.2;
  });
}

function updateWaves(dt) {
  if (waveState === 'cleared') {
    waveTimer -= dt;
    if (waveTimer <= 0) startWave();
  } else if (waveState === 'spawning') {
    waveTimer -= dt;
    if (waveTimer <= 0 && spawnQueue.length) {
      // aparecen de a tandas
      const batch = Math.min(spawnQueue.length, 2 + Math.floor(Math.random() * 2));
      for (let i = 0; i < batch; i++) spawnEnemy(spawnQueue.shift());
      waveTimer = 0.9 + Math.random() * 0.6;
    }
    if (!spawnQueue.length) waveState = 'fighting';
  } else if (waveState === 'fighting') {
    // sin enemigos vivos ni apariciones pendientes
    if (!enemies.length && pendingSpawns === 0 && !spawnQueue.length) {
      score += wave * 50;
      player.hp = PLAYER_MAX_HP;   // vida completa al superar la oleada
      audio.pickup();
      showBanner(`✔ Oleada ${wave} superada`, `+${wave * 50} puntos · ❤️ vida restaurada`);
      waveState = 'cleared';
      waveTimer = 3.2;
      updateHud();
    }
  }
}

function updateCamera(dt) {
  shake = Math.max(0, shake - dt * 1.4);
  const sx = shake > 0 ? (Math.random() - 0.5) * shake * 0.8 : 0;
  const sz = shake > 0 ? (Math.random() - 0.5) * shake * 0.8 : 0;
  // en pantallas verticales (celular) la cámara sube para ver más campo
  const lift = camera.aspect < 0.8 ? 1.3 : 1;
  const follow = 0.8;
  tmpV.set(player.pos.x * follow + sx, 12 * lift, player.pos.z * follow + 8.6 * lift + sz);
  camera.position.lerp(tmpV, Math.min(1, dt * 5));
  camera.lookAt(player.pos.x * follow, 0, player.pos.z * follow);
}

// ------------------------------------------------------------------ bucle principal
// autoajuste de calidad: si el equipo no llega a ~24 fps, bajar efectos
let perfStart = 0;
let perfFrames = 0;
let perfDone = false;
function checkPerformance(now) {
  if (perfDone) return;
  if (!perfStart) { perfStart = now; return; }
  perfFrames++;
  if (now - perfStart < 3000) return;
  perfDone = true;
  const fps = perfFrames / ((now - perfStart) / 1000);
  if (fps < 24) {
    dirLight.castShadow = false;
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.map) {
        o.material.map.anisotropy = 1;
        o.material.map.needsUpdate = true;
      }
    });
    console.info(`Calidad reducida (${fps.toFixed(0)} fps)`);
  }
}

let lastTime = performance.now();
let frameCount = 0;
function tick() {
  requestAnimationFrame(tick);
  frameCount++;
  checkPerformance(performance.now());
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateDying(dt);
    updateArrows(dt);
    updatePickups(dt);
    updateWaves(dt);
  }
  updateEffects(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ carga de modelos y arranque
const startBtn = document.getElementById('btn-start');
startBtn.disabled = true;
startBtn.textContent = '⏳ Cargando… 0%';
loadAssets((p) => {
  startBtn.textContent = `⏳ Cargando… ${Math.round(p * 100)}%`;
}).then(() => {
  setupArena();
  startBtn.disabled = false;
  startBtn.textContent = '▶ Jugar';
}).catch((err) => {
  console.error(err);
  startBtn.textContent = '⚠ Error al cargar los modelos — recargá la página';
});

updateHud();
tick();

// gancho mínimo para pruebas automatizadas
window.__npc3d = {
  get enemies() { return enemies; },
  get player() { return player; },
  get score() { return score; },
  get wave() { return wave; },
  get pickups() { return pickups; },
  get state() { return state; },
  get waveState() { return waveState; },
  get frames() { return frameCount; },
  attack: tryAttack,
  spawn: spawnEnemy,
};
