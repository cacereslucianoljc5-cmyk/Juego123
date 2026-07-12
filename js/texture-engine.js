// texture-engine.js
// Motor de retexturizado procedural: interpreta un prompt en lenguaje natural
// (español/inglés) y sintetiza mapas de textura (albedo, normal, rugosidad y
// emisivo) que se aplican a un material MeshStandardMaterial de Three.js.
//
// No usa ninguna API externa: toda la "IA" es un intérprete de palabras clave
// + síntesis procedural determinista (misma frase => misma textura).

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Utilidades de color
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
function shade(rgb, amount) {
  // amount > 0 aclara, < 0 oscurece
  const t = amount;
  if (t >= 0) return mixRgb(rgb, { r: 255, g: 255, b: 255 }, t);
  return mixRgb(rgb, { r: 0, g: 0, b: 0 }, -t);
}

// Diccionario de colores (es + en). El orden importa: frases más largas primero.
const COLORS = [
  ['escarlata', '#c0392b'], ['carmesí', '#b0142b'], ['carmesi', '#b0142b'],
  ['rojo', '#c0392b'], ['red', '#c0392b'],
  ['naranja', '#e67e22'], ['orange', '#e67e22'], ['ámbar', '#e6a422'], ['ambar', '#e6a422'],
  ['amarillo', '#f1c40f'], ['yellow', '#f1c40f'], ['oro', '#d4af37'], ['dorado', '#d4af37'], ['gold', '#d4af37'], ['golden', '#d4af37'],
  ['esmeralda', '#2ecc71'], ['lima', '#a3e635'], ['lime', '#a3e635'],
  ['verde', '#2e8b57'], ['green', '#2e8b57'], ['oliva', '#808000'], ['olive', '#808000'], ['menta', '#8ff0c0'],
  ['turquesa', '#1abc9c'], ['teal', '#1abc9c'], ['celeste', '#5dade2'], ['cyan', '#22d3ee'], ['cian', '#22d3ee'],
  ['zafiro', '#1e3a8a'], ['azul', '#2b6cb0'], ['blue', '#2b6cb0'], ['índigo', '#4b0082'], ['indigo', '#4b0082'], ['añil', '#4b0082'],
  ['lavanda', '#b39ddb'], ['violeta', '#8e44ad'], ['púrpura', '#8e44ad'], ['purpura', '#8e44ad'], ['morado', '#8e44ad'], ['purple', '#8e44ad'],
  ['magenta', '#d81b8c'], ['fucsia', '#e0218a'],
  ['rosa', '#ff6fae'], ['pink', '#ff6fae'], ['coral', '#ff7f50'],
  ['marrón', '#6b4423'], ['marron', '#6b4423'], ['café', '#5b3a1a'], ['cafe', '#5b3a1a'], ['brown', '#6b4423'], ['chocolate', '#4a2c17'],
  ['beige', '#d9c8a5'], ['crema', '#efe6cf'], ['arena', '#c2b280'], ['sand', '#c2b280'], ['tan', '#c9a66b'],
  ['bronce', '#b08d57'], ['bronze', '#b08d57'], ['cobre', '#b87333'], ['copper', '#b87333'],
  ['plateado', '#c8ccd0'], ['plata', '#c8ccd0'], ['silver', '#c8ccd0'], ['cromo', '#d5d9dd'], ['chrome', '#d5d9dd'], ['acero', '#8a939b'], ['steel', '#8a939b'],
  ['negro', '#1a1a1a'], ['black', '#1a1a1a'], ['obsidiana', '#141018'],
  ['blanco', '#f2f2f2'], ['white', '#f2f2f2'], ['marfil', '#f5f0e1'],
  ['gris', '#808080'], ['gray', '#808080'], ['grey', '#808080'], ['grafito', '#4a4a4a'],
  ['vino', '#722f37'], ['burdeos', '#722f37'], ['rubí', '#9b111e'], ['rubi', '#9b111e'],
];

function findColor(text, fallback) {
  for (const [name, hex] of COLORS) {
    if (text.includes(name)) return hex;
  }
  return fallback;
}
function findAllColors(text) {
  const found = [];
  for (const [name, hex] of COLORS) {
    const idx = text.indexOf(name);
    if (idx >= 0 && !found.some((f) => f.hex === hex)) found.push({ idx, hex });
  }
  found.sort((a, b) => a.idx - b.idx);
  return found.map((f) => f.hex);
}

// ---------------------------------------------------------------------------
// PRNG determinista + ruido de valor / fbm
// ---------------------------------------------------------------------------
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeValueNoise(rng) {
  const size = 256;
  const mask = size - 1;
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const at = (ix, iy) => lattice[((iy & mask) * size) + (ix & mask)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const v00 = at(x0, y0), v10 = at(x0 + 1, y0);
    const v01 = at(x0, y0 + 1), v11 = at(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  };
}
function fbm(noise, x, y, octaves = 5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Intérprete de prompt  ->  especificación de material
// ---------------------------------------------------------------------------
const MATERIALS = {
  metal:   { metalness: 0.9, roughness: 0.35, color: '#8a939b' },
  gold:    { metalness: 1.0, roughness: 0.25, color: '#d4af37' },
  silver:  { metalness: 1.0, roughness: 0.22, color: '#cfd3d7' },
  copper:  { metalness: 1.0, roughness: 0.35, color: '#b87333' },
  wood:    { metalness: 0.0, roughness: 0.82, color: '#8a5a2b' },
  stone:   { metalness: 0.0, roughness: 0.92, color: '#8d8d8d' },
  marble:  { metalness: 0.0, roughness: 0.35, color: '#eae6de' },
  fabric:  { metalness: 0.0, roughness: 0.95, color: '#7a6f8a' },
  leather: { metalness: 0.05, roughness: 0.72, color: '#6b4423' },
  plastic: { metalness: 0.0, roughness: 0.45, color: '#3aa0d0' },
  glass:   { metalness: 0.0, roughness: 0.05, color: '#bfe3ff', transmission: 0.9 },
  ice:     { metalness: 0.0, roughness: 0.12, color: '#bfe6ff', transmission: 0.65 },
  lava:    { metalness: 0.0, roughness: 0.7, color: '#2a1208' },
  rust:    { metalness: 0.55, roughness: 0.9, color: '#8a939b' },
  gem:     { metalness: 0.0, roughness: 0.08, color: '#c0392b', transmission: 0.5 },
  default: { metalness: 0.0, roughness: 0.55, color: '#9aa0a6' },
};

// palabra clave -> nombre de material
const MATERIAL_WORDS = [
  [['oro', 'dorado', 'gold', 'golden', 'áureo', 'aureo'], 'gold'],
  [['plata', 'plateado', 'silver', 'cromo', 'chrome', 'acero', 'steel', 'aluminio'], 'silver'],
  [['cobre', 'copper', 'bronce', 'bronze', 'latón', 'laton'], 'copper'],
  [['óxido', 'oxido', 'oxidado', 'oxidada', 'rust', 'rusty', 'herrumbre', 'corroído', 'corroido'], 'rust'],
  [['metal', 'metálico', 'metalico', 'metálica', 'hierro', 'iron', 'titanio'], 'metal'],
  [['madera', 'wood', 'wooden', 'roble', 'oak', 'pino', 'nogal', 'ébano', 'ebano', 'tablón', 'tablon', 'bambú', 'bambu'], 'wood'],
  [['mármol', 'marmol', 'marble'], 'marble'],
  [['piedra', 'roca', 'stone', 'rock', 'granito', 'granite', 'concreto', 'cemento', 'hormigón', 'hormigon'], 'stone'],
  [['tela', 'tejido', 'fabric', 'cloth', 'algodón', 'algodon', 'lana', 'wool', 'lino', 'denim', 'mezclilla'], 'fabric'],
  [['cuero', 'leather', 'piel'], 'leather'],
  [['plástico', 'plastico', 'plastic', 'goma', 'rubber', 'caucho'], 'plastic'],
  [['cristal', 'vidrio', 'glass', 'transparente', 'translúcido', 'translucido'], 'glass'],
  [['hielo', 'ice', 'escarcha', 'gélido', 'gelido', 'congelado'], 'ice'],
  [['lava', 'magma', 'incandescente', 'ardiente', 'fundido', 'volcán', 'volcan'], 'lava'],
  [['gema', 'gem', 'joya', 'diamante', 'rubí', 'rubi', 'esmeralda', 'zafiro', 'cristalino'], 'gem'],
];

const PATTERN_WORDS = [
  [['rayas', 'rayado', 'rayada', 'stripes', 'striped', 'líneas', 'lineas', 'franjas'], 'stripes'],
  [['lunares', 'topos', 'puntos', 'dots', 'polka', 'motas'], 'dots'],
  [['cuadros', 'cuadrícula', 'cuadricula', 'ajedrez', 'checker', 'damero', 'tablero'], 'checker'],
  [['ladrillo', 'ladrillos', 'brick', 'bricks', 'muro', 'pared'], 'bricks'],
  [['escamas', 'scales', 'escamoso', 'dragón', 'dragon', 'reptil', 'serpiente', 'pez'], 'scales'],
  [['hexágono', 'hexagono', 'hexágonos', 'hexagonos', 'hex', 'panal', 'sci-fi', 'scifi', 'futurista', 'tecnológico', 'tecnologico', 'cyber', 'ciber', 'techno'], 'hex'],
  [['camuflaje', 'camo', 'militar', 'army'], 'camo'],
  [['degradado', 'gradiente', 'gradient', 'ombré', 'ombre'], 'gradient'],
];

function interpretPrompt(prompt) {
  const text = ' ' + (prompt || '').toLowerCase().trim() + ' ';

  // material
  let material = 'default';
  for (const [words, name] of MATERIAL_WORDS) {
    if (words.some((w) => text.includes(w))) { material = name; break; }
  }
  const base = MATERIALS[material] || MATERIALS.default;
  const spec = { material, ...base };

  // colores del prompt
  const colors = findAllColors(text);
  const materialForcesColor = ['gold', 'silver', 'copper'].includes(material);
  if (colors.length && !materialForcesColor) {
    spec.color = colors[0];
  } else if (colors.length && materialForcesColor) {
    // permite p.ej. "oro rosa": tiñe el metal con el color pedido
    spec.color = rgbToHex(...Object.values(mixRgb(hexToRgb(base.color), hexToRgb(colors[0]), 0.4)));
  }
  spec.secondary = colors[1] || null;

  // patrón
  let pattern = 'none';
  for (const [words, name] of PATTERN_WORDS) {
    if (words.some((w) => text.includes(w))) { pattern = name; break; }
  }
  // patrones implícitos según material
  if (pattern === 'none') {
    if (material === 'wood') pattern = 'woodgrain';
    else if (material === 'marble') pattern = 'marble';
    else if (material === 'lava') pattern = 'lava';
    else if (material === 'rust') pattern = 'grunge';
    else if (material === 'leather') pattern = 'leather';
    else if (material === 'fabric') pattern = 'weave';
  }
  spec.pattern = pattern;

  // acabado
  if (/\b(mate|matte|áspero|aspero|rugoso|opaco)\b/.test(text)) spec.roughness = Math.min(1, spec.roughness + 0.35);
  if (/\b(brillante|pulido|pulida|glossy|shiny|lustroso|reluciente|espejo|pulir)\b/.test(text)) spec.roughness = Math.max(0.03, spec.roughness - 0.35);
  if (/\b(metálico|metalico|metálica)\b/.test(text) && material === 'default') { spec.metalness = 0.85; spec.roughness = 0.35; }

  // desgaste
  spec.weathered = /\b(viejo|vieja|gastado|gastada|desgastado|desgastada|antiguo|antigua|envejecido|weathered|worn|aged|sucio|sucia|dañado|danado|roto|rota)\b/.test(text);

  // emisivo / brillo
  spec.emissive = null;
  spec.emissiveIntensity = 0;
  if (material === 'lava') {
    spec.emissive = colors[0] || '#ff5a1f';
    spec.emissiveIntensity = 1.6;
  }
  if (/\b(neón|neon|fluorescente|glow|resplandor|luminoso|luminosa|brilla|radiante|led|holograma|holográfico|holografico)\b/.test(text)) {
    spec.emissive = colors[0] || '#22d3ee';
    spec.emissiveIntensity = 1.3;
    if (spec.pattern === 'none') spec.pattern = 'hex';
    spec.neon = true;
  }

  // escala de repetición del patrón
  spec.tiling = 3;
  if (/\b(fino|fina|pequeño|pequeña|pequeno|denso|densa|micro|diminuto)\b/.test(text)) spec.tiling = 6;
  if (/\b(grande|gruesa|grueso|amplio|ancho|macro|enorme)\b/.test(text)) spec.tiling = 1.5;

  spec.prompt = prompt;
  spec.seed = hashString((prompt || 'default') + '|' + material + '|' + pattern);
  return spec;
}

// ---------------------------------------------------------------------------
// Síntesis de texturas
// ---------------------------------------------------------------------------
const TEX_SIZE = 512;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Devuelve, para una coordenada uv (0..tiling), el color base del material y
// una altura (0..1) para el mapa de normales.
function materialField(spec, noise, u, v, rng0) {
  const baseCol = hexToRgb(spec.color);
  const f = fbm(noise, u * 4, v * 4, 5);
  let col = shade(baseCol, (f - 0.5) * 0.22);
  let height = 0.5 + (f - 0.5) * 0.4;

  switch (spec.material) {
    case 'wood': {
      const rings = Math.sin((u * 8 + fbm(noise, u * 2, v * 6, 4) * 3.5) * Math.PI * 2);
      const t = 0.5 + 0.5 * rings;
      col = mixRgb(shade(baseCol, -0.22), shade(baseCol, 0.12), t);
      const grain = fbm(noise, u * 60, v * 6, 3);
      col = shade(col, (grain - 0.5) * 0.12);
      height = 0.5 + (t - 0.5) * 0.5;
      break;
    }
    case 'marble': {
      const turb = fbm(noise, u * 3, v * 3, 6);
      const veins = Math.abs(Math.sin((u * 2 + turb * 4) * Math.PI * 2));
      const vein = Math.pow(1 - veins, 6);
      const veinCol = spec.secondary ? hexToRgb(spec.secondary) : { r: 60, g: 60, b: 70 };
      col = mixRgb(baseCol, veinCol, vein * 0.8);
      height = 0.55 - vein * 0.1;
      break;
    }
    case 'stone': {
      const n = fbm(noise, u * 8, v * 8, 6);
      col = shade(baseCol, (n - 0.5) * 0.5);
      height = 0.4 + n * 0.5;
      break;
    }
    case 'rust': {
      const metal = hexToRgb(spec.secondary || '#8a939b');
      const rustCol = { r: 150, g: 70, b: 30 };
      const r = Math.pow(fbm(noise, u * 6, v * 6, 6), 1.4);
      col = mixRgb(metal, rustCol, Math.min(1, r * 1.6));
      col = shade(col, (fbm(noise, u * 30, v * 30, 3) - 0.5) * 0.25);
      height = 0.5 + (r - 0.5) * 0.5;
      break;
    }
    case 'lava': {
      const rock = { r: 32, g: 20, b: 16 };
      const cracks = fbm(noise, u * 5, v * 5, 6);
      const glowMask = Math.pow(Math.max(0, 1 - Math.abs(cracks - 0.5) * 4), 2);
      col = shade(rock, (cracks - 0.5) * 0.4);
      height = 0.45 + (cracks - 0.5) * 0.6;
      return { col, height, glow: glowMask };
    }
    case 'leather': {
      const cell = fbm(noise, u * 40, v * 40, 4);
      col = shade(baseCol, (cell - 0.5) * 0.3);
      height = 0.5 + (cell - 0.5) * 0.7;
      break;
    }
    case 'fabric': {
      const weave = (Math.sin(u * spec.tiling * 120) * Math.sin(v * spec.tiling * 120));
      col = shade(baseCol, weave * 0.12 + (f - 0.5) * 0.1);
      height = 0.5 + weave * 0.4;
      break;
    }
    default: break;
  }
  return { col, height, glow: 0 };
}

// Overlay de patrón geométrico. Devuelve mezcla con color secundario y altura.
function patternField(spec, noise, uu, vv) {
  const tiling = spec.tiling;
  const u = (uu * tiling) % 1;
  const v = (vv * tiling) % 1;
  const sec = spec.secondary ? hexToRgb(spec.secondary) : shade(hexToRgb(spec.color), spec.material === 'default' ? -0.4 : 0.35);
  let mix = 0, height = 0, glow = 0;

  switch (spec.pattern) {
    case 'stripes':
      mix = ((u * 6) % 1) < 0.5 ? 1 : 0;
      height = mix ? 0.15 : 0;
      break;
    case 'dots': {
      const gx = (u * 5) % 1 - 0.5, gy = (v * 5) % 1 - 0.5;
      const d = Math.sqrt(gx * gx + gy * gy);
      mix = d < 0.28 ? 1 : 0;
      height = mix ? 0.25 : 0;
      break;
    }
    case 'checker': {
      const cx = Math.floor(u * 6), cy = Math.floor(v * 6);
      mix = (cx + cy) % 2 === 0 ? 1 : 0;
      break;
    }
    case 'bricks': {
      const rows = 8;
      const row = Math.floor(v * rows);
      const off = (row % 2) * 0.5;
      const bx = ((u * 4 + off) % 1);
      const by = (v * rows) % 1;
      const mortar = bx < 0.06 || bx > 0.94 || by < 0.09 || by > 0.91;
      mix = mortar ? 1 : 0;
      height = mortar ? -0.35 : 0.1 + fbm(noise, uu * 20, vv * 20, 3) * 0.1;
      break;
    }
    case 'scales': {
      const rows = 9;
      const row = Math.floor(v * rows);
      const off = (row % 2) * 0.5;
      const sx = ((u * 6 + off) % 1) - 0.5;
      const sy = (v * rows) % 1;
      const d = Math.sqrt(sx * sx * 1.1 + (sy - 0.15) * (sy - 0.15) * 0.7);
      const inside = d < 0.45 && sy < 0.9;
      mix = inside ? (0.35 + (0.45 - d)) : 0;
      height = inside ? 0.5 - d : -0.2;
      break;
    }
    case 'hex': {
      // rejilla hexagonal (líneas)
      const s = 6;
      let x = u * s, y = v * s;
      const line = Math.min(
        Math.abs(((x + y * 0.5) % 1) - 0.5),
        Math.abs(((x - y * 0.5) % 1) - 0.5),
        Math.abs((y % 1) - 0.5)
      );
      const edge = line > 0.42 ? 1 : 0;
      mix = edge;
      height = edge ? 0.2 : 0;
      glow = spec.neon ? edge : 0;
      break;
    }
    case 'camo': {
      const blob = fbm(noise, uu * 5, vv * 5, 4);
      if (blob > 0.62) { mix = 1; }
      else if (blob < 0.4) { mix = 0.5; }
      break;
    }
    case 'gradient':
      mix = vv;
      break;
    case 'grunge': {
      const g = fbm(noise, uu * 8, vv * 8, 5);
      mix = g > 0.6 ? (g - 0.6) * 2 : 0;
      height = -mix * 0.3;
      break;
    }
    default:
      break;
  }
  return { mix, sec, height, glow };
}

function synthesize(spec) {
  const size = TEX_SIZE;
  const rng = mulberry32(spec.seed);
  const noise = makeValueNoise(rng);

  const albedo = makeCanvas(size);
  const actx = albedo.getContext('2d');
  const aimg = actx.createImageData(size, size);
  const ad = aimg.data;

  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  let hasGlow = false;
  const glowArr = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;

      const mf = materialField(spec, noise, u, v, rng);
      let col = mf.col;
      let h = mf.height;
      let glow = mf.glow || 0;

      const pf = patternField(spec, noise, u, v);
      if (pf.mix > 0) {
        col = mixRgb(col, pf.sec, Math.min(1, pf.mix));
      }
      h = Math.max(0, Math.min(1, h + pf.height));
      if (pf.glow > 0) glow = Math.max(glow, pf.glow);

      // rugosidad procedural: grietas y desgaste => más áspero
      let rgh = spec.roughness + (0.5 - h) * 0.25;
      if (spec.weathered) {
        const w = fbm(noise, u * 7 + 11, v * 7 + 7, 5);
        if (w > 0.55) {
          const wa = (w - 0.55) * 1.6;
          col = shade(col, -0.28 * wa);
          rgh = Math.min(1, rgh + 0.3 * wa);
          h = Math.max(0, h - 0.15 * wa);
        }
      }

      if (glow > 0) hasGlow = true;
      glowArr[i] = glow;
      height[i] = h;
      rough[i] = Math.max(0.02, Math.min(1, rgh));

      const p = i * 4;
      ad[p] = col.r; ad[p + 1] = col.g; ad[p + 2] = col.b; ad[p + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);

  // ---- mapa de normales desde alturas (Sobel) ----
  const normal = makeCanvas(size);
  const nctx = normal.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const nd = nimg.data;
  const strength = 2.2;
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const p = (y * size + x) * 4;
      nd[p] = ((dx / len) * 0.5 + 0.5) * 255;
      nd[p + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nd[p + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nd[p + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  // ---- mapa de rugosidad (escala de grises) ----
  const roughCanvas = makeCanvas(size);
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  const rd = rimg.data;
  for (let i = 0; i < rough.length; i++) {
    const g = rough[i] * 255;
    const p = i * 4;
    rd[p] = rd[p + 1] = rd[p + 2] = g; rd[p + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);

  // ---- mapa emisivo (lava / neón) ----
  let emissiveCanvas = null;
  if (hasGlow && spec.emissive) {
    emissiveCanvas = makeCanvas(size);
    const ectx = emissiveCanvas.getContext('2d');
    const eimg = ectx.createImageData(size, size);
    const ed = eimg.data;
    const ec = hexToRgb(spec.emissive);
    for (let i = 0; i < glowArr.length; i++) {
      const g = glowArr[i];
      const p = i * 4;
      ed[p] = ec.r * g; ed[p + 1] = ec.g * g; ed[p + 2] = ec.b * g; ed[p + 3] = 255;
    }
    ectx.putImageData(eimg, 0, 0);
  }

  return { albedo, normal, roughCanvas, emissiveCanvas, hasGlow };
}

function canvasToTexture(canvas, colorSpace, tiling) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tiling, tiling);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Crea un material Three.js a partir de un prompt.
 * @param {string} prompt
 * @param {number} maxAnisotropy - renderer.capabilities.getMaxAnisotropy()
 * @returns {{ material: THREE.Material, spec: object, preview: {albedo,normal} }}
 */
export function materialFromPrompt(prompt, maxAnisotropy = 8) {
  const spec = interpretPrompt(prompt);
  const maps = synthesize(spec);
  const rep = Math.max(1, spec.tiling * 0.6);

  const isPhysical = spec.transmission > 0;
  const mat = isPhysical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();

  const albedoTex = canvasToTexture(maps.albedo, THREE.SRGBColorSpace, rep);
  albedoTex.anisotropy = maxAnisotropy;
  mat.map = albedoTex;
  mat.normalMap = canvasToTexture(maps.normal, THREE.NoColorSpace, rep);
  mat.normalScale = new THREE.Vector2(1, 1);
  mat.roughnessMap = canvasToTexture(maps.roughCanvas, THREE.NoColorSpace, rep);
  mat.metalness = spec.metalness;
  mat.roughness = 1.0; // el mapa de rugosidad lleva el valor real
  mat.color = new THREE.Color(0xffffff);

  if (maps.emissiveCanvas) {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = canvasToTexture(maps.emissiveCanvas, THREE.SRGBColorSpace, rep);
    mat.emissiveIntensity = spec.emissiveIntensity;
  } else if (spec.emissive && spec.emissiveIntensity > 0) {
    mat.emissive = new THREE.Color(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity * 0.4;
  }

  if (isPhysical) {
    mat.transmission = spec.transmission;
    mat.thickness = 0.5;
    mat.ior = spec.material === 'ice' ? 1.31 : 1.5;
    mat.roughness = spec.roughness;
    mat.metalness = 0;
  }

  mat.side = THREE.FrontSide;
  mat.needsUpdate = true;

  return { material: mat, spec, preview: { albedo: maps.albedo, normal: maps.normal } };
}

export { interpretPrompt };
