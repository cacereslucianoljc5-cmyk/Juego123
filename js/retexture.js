// retexture.js — Retexturizador 3D con IA (procedural, sin API externa).
// Carga un modelo GLB/GLTF, interpreta un prompt y repinta el modelo con
// texturas generadas al vuelo. Permite exportar el resultado como .glb.

import * as THREE from 'three';
import { OrbitControls } from '../lib/OrbitControls.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { GLTFExporter } from '../lib/GLTFExporter.js';
import { RoomEnvironment } from '../lib/RoomEnvironment.js';
import { materialFromPrompt, interpretPrompt } from './texture-engine.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Escena
// ---------------------------------------------------------------------------
const canvas = $('viewer');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(2.6, 1.9, 3.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.92;

// Entorno para reflejos PBR
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// Luces
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2438, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2d6, 2.1);
key.position.set(4, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 25;
key.shadow.camera.left = key.shadow.camera.bottom = -5;
key.shadow.camera.right = key.shadow.camera.top = 5;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
fill.position.set(-5, 3, -3);
scene.add(fill);
// luz de borde (rim): ilumina el contorno, para el look cartoon "bordes iluminados"
const rim = new THREE.DirectionalLight(0xfff0e0, 1.1);
rim.position.set(-2, 4, -6);
scene.add(rim);

// Suelo receptor de sombras
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(16, 32, 0x4a3f66, 0x2a2440);
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

// ---------------------------------------------------------------------------
// Estado del modelo
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
let root = null;               // grupo del modelo actual
const meshes = [];             // { mesh, name }
const originalMaterials = new Map(); // mesh -> material original (para reset)
const appliedMaterials = new Map();  // mesh -> material aplicado (para sliders)
const maxAniso = renderer.capabilities.getMaxAnisotropy();
let lastPrompt = null;               // último prompt aplicado (para recalcular al cambiar estilo)

function clearModel() {
  if (root) {
    scene.remove(root);
    root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
      }
    });
  }
  root = null;
  meshes.length = 0;
  originalMaterials.clear();
  appliedMaterials.clear();
}

function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2.2 / maxDim;
  object.scale.setScalar(scale);

  // recentrar y apoyar en el suelo
  box.setFromObject(object);
  const c2 = box.getCenter(new THREE.Vector3());
  object.position.x -= c2.x;
  object.position.z -= c2.z;
  object.position.y -= box.min.y;

  const newBox = new THREE.Box3().setFromObject(object);
  const h = newBox.getSize(new THREE.Vector3()).y;
  controls.target.set(0, h * 0.5, 0);
  camera.position.set(h * 1.4, h * 0.9, h * 1.7 + 0.8);
  controls.update();
}

// Muchos modelos generados por IA (Hunyuan, etc.) o escaneos vienen como malla
// "cruda": solo POSITION, sin normales (se ven negros) y sin UVs (las texturas
// no se pueden mapear). Los generamos al vuelo para que sean retexturizables.
function ensureNormalsAndUVs(geometry) {
  if (!geometry || !geometry.attributes.position) return;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    const inv = 1 / (Math.max(sx, sy, sz) || 1);
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = (pos.getX(i) - bb.min.x) * inv;
      const y = (pos.getY(i) - bb.min.y) * inv;
      const z = (pos.getZ(i) - bb.min.z) * inv;
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      let u, v;
      if (nx >= ny && nx >= nz) { u = z; v = y; }        // cara mirando en X -> proyecta YZ
      else if (ny >= nx && ny >= nz) { u = x; v = z; }   // cara mirando en Y -> proyecta XZ
      else { u = x; v = y; }                              // cara mirando en Z -> proyecta XY
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
}

function registerMeshes() {
  const sel = $('mesh-target');
  sel.innerHTML = '<option value="all">🎯 Todo el modelo</option>';
  root.traverse((o) => {
    if (o.isMesh) {
      ensureNormalsAndUVs(o.geometry);
      o.castShadow = true;
      o.receiveShadow = true;
      const name = o.name || `parte ${meshes.length + 1}`;
      const idx = meshes.length;
      meshes.push({ mesh: o, name });
      originalMaterials.set(o, o.material);
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `▸ ${name}`;
      sel.appendChild(opt);
    }
  });
  $('mesh-count').textContent = meshes.length;
}

function loadFromArrayBuffer(buffer, label) {
  setStatus('Cargando modelo…');
  loader.parse(buffer, '', (gltf) => {
    clearModel();
    root = gltf.scene || gltf.scenes[0];
    scene.add(root);
    frameModel(root);
    registerMeshes();
    setStatus(`Modelo cargado: ${label} · ${meshes.length} malla(s). Escribí un prompt y tocá “Repintar”.`);
    $('btn-download').disabled = true;
  }, (err) => {
    console.error(err);
    setStatus('❌ No se pudo leer el modelo. ¿Es un .glb/.gltf válido?', true);
  });
}

function loadFromUrl(url, label) {
  setStatus('Cargando modelo de ejemplo…');
  loader.load(url, (gltf) => {
    clearModel();
    root = gltf.scene || gltf.scenes[0];
    scene.add(root);
    frameModel(root);
    registerMeshes();
    setStatus(`Modelo cargado: ${label} · ${meshes.length} malla(s). Probá un prompt o subí tu propio .glb.`);
    $('btn-download').disabled = true;
  }, undefined, (err) => {
    console.error(err);
    setStatus('No se pudo cargar el modelo de ejemplo. Subí tu propio .glb.', true);
  });
}

// ---------------------------------------------------------------------------
// Retexturizado
// ---------------------------------------------------------------------------
function targetMeshes() {
  const val = $('mesh-target').value;
  if (val === 'all') return meshes.map((m) => m.mesh);
  const idx = parseInt(val, 10);
  return meshes[idx] ? [meshes[idx].mesh] : [];
}

function applyPrompt() {
  if (!root) { setStatus('Primero cargá un modelo.', true); return; }
  const prompt = $('prompt').value.trim();
  if (!prompt) { setStatus('Escribí qué material/color querés (ej: “oro viejo con gemas rojas”).', true); return; }

  const targets = targetMeshes();
  if (!targets.length) { setStatus('No hay malla seleccionada.', true); return; }

  lastPrompt = prompt;
  setStatus('🎨 Generando texturas…');
  const style = $('style').value;
  // deja pintar el frame de estado antes del trabajo pesado
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const t0 = performance.now();
    const { material, spec, preview } = materialFromPrompt(prompt, maxAniso, { style });

    for (const mesh of targets) {
      mesh.material = material;
      appliedMaterials.set(mesh, material);
    }
    syncSlidersToSpec(spec);
    updatePreview(preview, spec);

    const ms = Math.round(performance.now() - t0);
    $('btn-download').disabled = false;
    const scope = $('mesh-target').value === 'all' ? 'todo el modelo' : `la malla “${meshes[parseInt($('mesh-target').value, 10)].name}”`;
    setStatus(`✅ Repintado ${scope} · ${describeSpec(spec)} · ${ms} ms`);
  }));
}

function describeSpec(spec) {
  const parts = [];
  const matNames = {
    gold: 'oro', silver: 'plata', copper: 'cobre', metal: 'metal', wood: 'madera',
    stone: 'piedra', marble: 'mármol', fabric: 'tela', leather: 'cuero', plastic: 'plástico',
    glass: 'cristal', ice: 'hielo', lava: 'lava', rust: 'óxido', gem: 'gema', default: 'material',
  };
  parts.push(matNames[spec.material] || spec.material);
  if (spec.pattern && spec.pattern !== 'none') parts.push(spec.pattern);
  return parts.join(' · ');
}

function syncSlidersToSpec(spec) {
  $('metalness').value = spec.metalness;
  $('roughness').value = spec.roughness;
  $('normalScale').value = 1;
  $('tiling').value = spec.tiling;
  updateSliderLabels();
}

function updateSliderLabels() {
  $('metalness-val').textContent = (+$('metalness').value).toFixed(2);
  $('roughness-val').textContent = (+$('roughness').value).toFixed(2);
  $('normalScale-val').textContent = (+$('normalScale').value).toFixed(2);
  $('tiling-val').textContent = (+$('tiling').value).toFixed(1);
}

function applySliders() {
  updateSliderLabels();
  const metal = +$('metalness').value;
  const rough = +$('roughness').value;
  const nscale = +$('normalScale').value;
  const rep = Math.max(0.2, +$('tiling').value * 0.6);
  for (const [, m] of appliedMaterials) {
    // metalicidad/rugosidad solo aplican a materiales PBR (no al toon)
    if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
      if (!m.isMeshPhysicalMaterial || !m.transmission) m.metalness = metal;
      m.roughness = m.roughnessMap ? Math.max(0.05, rough) : rough;
    }
    if (m.normalScale) m.normalScale.set(nscale, nscale);
    for (const map of [m.map, m.normalMap, m.roughnessMap, m.emissiveMap]) {
      if (map) { map.repeat.set(rep, rep); map.needsUpdate = true; }
    }
    m.needsUpdate = true;
  }
}

function resetMaterials() {
  if (!root) return;
  for (const [mesh, mat] of originalMaterials) mesh.material = mat;
  appliedMaterials.clear();
  $('btn-download').disabled = true;
  setStatus('↺ Materiales originales restaurados.');
}

// ---------------------------------------------------------------------------
// Vista previa de los mapas generados
// ---------------------------------------------------------------------------
function updatePreview(preview, spec) {
  drawThumb($('thumb-albedo'), preview.albedo);
  drawThumb($('thumb-normal'), preview.normal);
  $('preview-box').style.display = 'flex';
  $('preview-empty').style.display = 'none';
  $('spec-json').textContent = JSON.stringify({
    material: spec.material, patrón: spec.pattern, color: spec.color,
    secundario: spec.secondary, metalness: +spec.metalness.toFixed(2),
    roughness: +spec.roughness.toFixed(2), emisivo: spec.emissive || '—',
    desgaste: spec.weathered, tiling: spec.tiling,
  }, null, 1);
}
function drawThumb(target, srcCanvas) {
  const ctx = target.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, target.width, target.height);
}

// ---------------------------------------------------------------------------
// Exportar GLB
// ---------------------------------------------------------------------------
function downloadGLB() {
  if (!root) return;
  setStatus('📦 Exportando .glb…');

  // El sombreado toon no existe en glTF (y su gradientMap DataTexture rompe el
  // exportador). Cambiamos temporalmente los materiales toon por una
  // aproximación PBR portable y los restauramos al terminar.
  const swapped = [];
  root.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshToonMaterial) {
      const t = o.material;
      const std = new THREE.MeshStandardMaterial({
        map: t.map || null,
        normalMap: t.normalMap || null,
        color: 0xffffff,
        roughness: 0.75,
        metalness: 0.0,
        emissive: t.emissive ? t.emissive.clone() : new THREE.Color(0),
        emissiveMap: t.emissiveMap || null,
        emissiveIntensity: t.emissiveIntensity || 1,
      });
      if (t.normalScale) std.normalScale.copy(t.normalScale);
      swapped.push([o, t]);
      o.material = std;
    }
  });
  const restore = () => { for (const [o, t] of swapped) o.material = t; };

  const exporter = new GLTFExporter();
  exporter.parse(root, (result) => {
    restore();
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-retexturizado.glb';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatus('✅ Descargado modelo-retexturizado.glb (con texturas incrustadas).');
  }, (err) => {
    restore();
    console.error(err);
    setStatus('❌ Error al exportar el .glb.', true);
  }, { binary: true, onlyVisible: true });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.style.color = isError ? '#ff9b8a' : '#cbb';
}

function handleFile(file) {
  if (!file) return;
  if (!/\.(glb|gltf)$/i.test(file.name)) {
    setStatus('Formato no soportado. Subí un archivo .glb o .gltf.', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => loadFromArrayBuffer(reader.result, file.name);
  reader.onerror = () => setStatus('No se pudo leer el archivo.', true);
  reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------------------
// Wiring de eventos
// ---------------------------------------------------------------------------
$('btn-apply').addEventListener('click', applyPrompt);
$('btn-reset').addEventListener('click', resetMaterials);
$('btn-download').addEventListener('click', downloadGLB);
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPrompt(); });

$('file-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('btn-upload').addEventListener('click', () => $('file-input').click());

for (const slider of ['metalness', 'roughness', 'normalScale', 'tiling']) {
  $(slider).addEventListener('input', applySliders);
}

$('autorotate').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
$('toggle-grid').addEventListener('change', (e) => { grid.visible = e.target.checked; });

// al cambiar el estilo, si ya hay un prompt aplicado, se recalcula
$('style').addEventListener('change', () => { if (lastPrompt) { $('prompt').value = lastPrompt; applyPrompt(); } });

// chips de ejemplo
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $('prompt').value = chip.dataset.prompt || chip.textContent;
    applyPrompt();
  });
});

// arrastrar y soltar
const dropZone = document.body;
['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault(); $('drop-hint').classList.add('show');
}));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'drop' && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  if (ev === 'dragleave' && e.relatedTarget) return;
  $('drop-hint').classList.remove('show');
}));

// ---------------------------------------------------------------------------
// Loop de render
// ---------------------------------------------------------------------------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
function animate() {
  requestAnimationFrame(animate);
  resize();
  controls.update();
  renderer.render(scene, camera);
}
animate();
updateSliderLabels();

// modelo de ejemplo inicial (del propio repo) para no arrancar con la vista vacía
loadFromUrl('./models/Barbaro.glb', 'Bárbaro (ejemplo)');

// expone un par de utilidades para depurar desde la consola
window.__retex = { interpretPrompt, materialFromPrompt };
