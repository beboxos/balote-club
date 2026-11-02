// Physique déterministe lockstep.
// Règles : pas fixe, uniquement + - * / sqrt abs min max round, ordre d'itération
// par indice croissant. Aucune trigonométrie native : table pré-calculée par série.

export const TERRAIN = { l: 360, h: 640, marge: 40 };
export const RAYON = 9;
export const JACK_R = 4.5;
export const PAS = 1 / 120;
export const FRICTION = 520;   // décélération de roulement, unités/s²
export const V_MIN = 6;
export const V_MAX = 780;      // portée ≈ puissance × V_MAX² / (2·FRICTION) ≈ puissance × 585
export const MAX_PAS = 1680;
export const LANCER = { x: 180, y: 566 };

const RESTITUTION = 0.92;
const MASSE_BOULE = 1;
const MASSE_JACK = 0.25;
const PI = 3.141592653589793;

// Table sinus 720 entrées (pas de 0,5°) calculée par série de Taylor sur [0, π/2]
// puis par symétrie : même résultat au bit près sur tout moteur IEEE 754.
function sinSerie(x) {
  let terme = x;
  let somme = x;
  const x2 = x * x;
  for (let k = 1; k <= 10; k++) {
    terme = (-terme * x2) / ((2 * k) * (2 * k + 1));
    somme += terme;
  }
  return somme;
}

const TABLE_SIN = new Float32Array(720);
(function remplirTable() {
  const base = new Float64Array(181);
  for (let k = 0; k <= 180; k++) base[k] = sinSerie((k * PI) / 360);
  for (let k = 0; k < 720; k++) {
    if (k <= 180) TABLE_SIN[k] = base[k];
    else if (k <= 360) TABLE_SIN[k] = base[360 - k];
    else if (k <= 540) TABLE_SIN[k] = -base[k - 360];
    else TABLE_SIN[k] = -base[720 - k];
  }
})();

// Angle en centièmes de degré (entier 0..35999), interpolation linéaire entre entrées.
function sinCd(cd) {
  const reste = cd % 50;
  const i0 = (cd - reste) / 50;
  const i1 = i0 === 719 ? 0 : i0 + 1;
  return TABLE_SIN[i0] + (TABLE_SIN[i1] - TABLE_SIN[i0]) * (reste / 50);
}

export function normaliserAngle(cd) {
  let a = Math.round(cd) % 36000;
  if (a < 0) a += 36000;
  return a;
}

export function normaliserPuissance(p) {
  return Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000;
}

export function sinCos(cd) {
  const a = normaliserAngle(cd);
  return { s: sinCd(a), c: sinCd((a + 9000) % 36000) };
}

export function creerEtat(jack) {
  return {
    objets: [{
      x: jack.x, y: jack.y, vx: 0, vy: 0,
      r: JACK_R, m: MASSE_JACK, vivant: true, equipe: -1, jack: true,
    }],
    pas: 0,
    chocs: [],
  };
}

export function ajouterBoule(etat, equipe) {
  etat.objets.push({
    x: LANCER.x, y: LANCER.y, vx: 0, vy: 0,
    r: RAYON, m: MASSE_BOULE, vivant: true, equipe, jack: false,
  });
  return etat.objets.length - 1;
}

export function lancer(etat, boule, angle, puissance) {
  const o = etat.objets[boule];
  const { s, c } = sinCos(angle);
  // Vitesse en racine de la puissance : la portée (∝ v²) devient linéaire au geste.
  const v = V_MAX * Math.sqrt(normaliserPuissance(puissance));
  o.vx = c * v;
  o.vy = s * v;
  etat.pas = 0;
}

function horsTerrain(o) {
  const m = TERRAIN.marge;
  return o.x < m || o.x > TERRAIN.l - m || o.y < m || o.y > TERRAIN.h - m;
}

function integrer(etat) {
  const dec = FRICTION * PAS;
  const objets = etat.objets;
  for (let i = 0; i < objets.length; i++) {
    const o = objets[i];
    if (!o.vivant || (o.vx === 0 && o.vy === 0)) continue;
    const v = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
    if (v <= dec) {
      o.vx = 0;
      o.vy = 0;
      continue;
    }
    const k = (v - dec) / v;
    o.vx *= k;
    o.vy *= k;
    o.x += o.vx * PAS;
    o.y += o.vy * PAS;
    if (horsTerrain(o)) {
      o.vivant = false;
      o.vx = 0;
      o.vy = 0;
    }
  }
}

function collisions(etat) {
  const objets = etat.objets;
  const contacts = [];
  // Passe 1 : séparation positionnelle.
  for (let i = 0; i < objets.length; i++) {
    const a = objets[i];
    if (!a.vivant) continue;
    for (let j = i + 1; j < objets.length; j++) {
      const b = objets[j];
      if (!b.vivant) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2);
      let nx, ny;
      if (d === 0) { nx = 0; ny = -1; d = 0; } else { nx = dx / d; ny = dy / d; }
      const recouvrement = rr - d;
      const inv = 1 / (a.m + b.m);
      a.x -= nx * recouvrement * b.m * inv;
      a.y -= ny * recouvrement * b.m * inv;
      b.x += nx * recouvrement * a.m * inv;
      b.y += ny * recouvrement * a.m * inv;
      contacts.push(i, j, nx, ny);
    }
  }
  // Passe 2 : impulsion.
  for (let k = 0; k < contacts.length; k += 4) {
    const a = objets[contacts[k]];
    const b = objets[contacts[k + 1]];
    const nx = contacts[k + 2];
    const ny = contacts[k + 3];
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0) continue;
    const jImp = (-(1 + RESTITUTION) * vn) / (1 / a.m + 1 / b.m);
    a.vx -= (jImp / a.m) * nx;
    a.vy -= (jImp / a.m) * ny;
    b.vx += (jImp / b.m) * nx;
    b.vy += (jImp / b.m) * ny;
    etat.chocs.push({
      x: a.x + nx * a.r, y: a.y + ny * a.r,
      force: -vn, jack: a.jack || b.jack,
    });
  }
}

// Avance d'un pas fixe. Retourne true quand tout est immobile (ou MAX_PAS atteint).
export function step(etat) {
  etat.pas++;
  integrer(etat);
  collisions(etat);
  const seuil = V_MIN * 0.5;
  let immobile = true;
  const objets = etat.objets;
  for (let i = 0; i < objets.length; i++) {
    const o = objets[i];
    if (!o.vivant) continue;
    if (Math.abs(o.vx) < seuil && Math.abs(o.vy) < seuil) {
      o.vx = 0;
      o.vy = 0;
    } else {
      immobile = false;
    }
  }
  if (!immobile && etat.pas >= MAX_PAS) {
    for (let i = 0; i < objets.length; i++) { objets[i].vx = 0; objets[i].vy = 0; }
    immobile = true;
  }
  return immobile;
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Empreinte FNV-1a 32 bits des bits exacts de l'état : sert à comparer deux appareils.
export function empreinte(etat) {
  const vue = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  for (const o of etat.objets) {
    for (const v of [o.x, o.y, o.vivant ? 1 : 0]) {
      vue.setFloat64(0, v);
      for (let i = 0; i < 8; i++) h = Math.imul(h ^ vue.getUint8(i), 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
