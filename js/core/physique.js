// Physique déterministe lockstep.
// Règles : pas fixe, uniquement + - * / sqrt abs min max round, ordre d'itération
// par indice croissant. Aucune trigonométrie native : table pré-calculée par série.

export const TERRAIN = { l: 360, h: 640, marge: 40 };
export const RAYON = 9;
export const JACK_R = 4.5;
export const PAS = 1 / 120;
export const V_MIN = 6;
export const V_MAX = 780;      // vitesse de départ d'un tir rasant (aide du bot, plus utilisé par le lancer)
// Lancer en cloche : la boule vole en ligne droite (sans frottement), retombe, perd une part de
// sa vitesse à l'impact (selon le sol) puis roule. La portée totale est linéaire en la puissance.
export const V_LANCER = 640;   // vitesse horizontale en vol à puissance 1
export const T_VOL = 0.8;      // durée du vol à puissance 1, en secondes (∝ √puissance)
// Distance parcourue en l'air (jusqu'au point de chute) : linéaire en la puissance.
export const PORTEE_AIR = V_LANCER * T_VOL;

// Surfaces de jeu. frottement : décélération de roulement (unités/s²) ; impact : part de la vitesse
// conservée à l'atterrissage ; cailloux : nombre de petits cailloux semés à chaque mène.
export const SOLS = {
  lisse: { id: 'lisse', nom: 'Lisse', frottement: 260, impact: 0.5, cailloux: 0 },
  terre: { id: 'terre', nom: 'Terre', frottement: 260, impact: 0.5, cailloux: 5 },
  gravier: { id: 'gravier', nom: 'Gravier', frottement: 380, impact: 0.45, cailloux: 12 },
};
export const SOL_DEFAUT = 'terre';

// Portée totale (vol + roulement) à puissance 1 sur un sol donné.
export function portee(sol) {
  return V_LANCER * T_VOL + (V_LANCER * V_LANCER * sol.impact * sol.impact) / (2 * sol.frottement);
}

// Le cochonnet se lance dans une fourchette de distance : ni trop près, ni trop loin.
export const JACK_DIST_MIN = 330;
export const JACK_DIST_MAX = 450;

// Puissance réellement appliquée au cochonnet : le geste 0..1 est étalé sur la fourchette autorisée.
export function puissanceCochonnet(p, sol) {
  const d = JACK_DIST_MIN + normaliserPuissance(p) * (JACK_DIST_MAX - JACK_DIST_MIN);
  return d / portee(sol);
}
export const MAX_PAS = 1680;
export const LANCER = { x: 180, y: 566 };

const RESTITUTION = 0.92;
const MASSE_BOULE = 1;
const MASSE_JACK = 0.25;
const MARGE_CAILLOU = 0.45;   // part du rayon de l'objet pour qu'un caillou le touche
const PERTE_CAILLOU = 0.95;   // vitesse conservée après un caillou
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

// cailloux : [{ x, y, r, d }], d = déviation maximale en radians.
export function creerEtat(jack, sol = SOLS[SOL_DEFAUT], cailloux = []) {
  return {
    objets: [{
      x: jack.x, y: jack.y, vx: 0, vy: 0,
      r: JACK_R, m: MASSE_JACK, vivant: true, equipe: -1, jack: true,
      air: 0, air0: 0, arc: 0, cai: 0, enMain: false,
    }],
    sol,
    cailloux,
    pas: 0,
    chocs: [],
  };
}

export function ajouterBoule(etat, equipe) {
  etat.objets.push({
    x: LANCER.x, y: LANCER.y, vx: 0, vy: 0,
    r: RAYON, m: MASSE_BOULE, vivant: true, equipe, jack: false,
    air: 0, air0: 0, arc: 0,   // pas de vol restants, pas de vol au départ, hauteur du sommet
    cai: 0, enMain: false,     // cailloux déjà touchés (masque de bits), tenu en main avant le lancer
  });
  return etat.objets.length - 1;
}

export function lancer(etat, boule, angle, puissance) {
  const o = etat.objets[boule];
  const { s, c } = sinCos(angle);
  // Vitesse et durée de vol en racine de la puissance : la portée devient linéaire au geste.
  const racine = Math.sqrt(normaliserPuissance(puissance));
  const v = V_LANCER * racine;
  o.vx = c * v;
  o.vy = s * v;
  o.air0 = Math.max(1, Math.round((T_VOL * racine) / PAS));
  o.air = o.air0;
  o.arc = 20 + 120 * racine;
  o.cai = 0;
  o.enMain = false;
  etat.pas = 0;
}

function horsTerrain(o) {
  const m = TERRAIN.marge;
  return o.x < m || o.x > TERRAIN.l - m || o.y < m || o.y > TERRAIN.h - m;
}

// Un caillou sous un objet qui roule le dévie, du côté opposé au caillou, et le freine un peu.
// Chaque caillou ne touche un objet qu'une fois par déplacement.
function cailloux(etat, o) {
  const cs = etat.cailloux;
  for (let k = 0; k < cs.length; k++) {
    const bit = 1 << k;
    if (o.cai & bit) continue;
    const c = cs[k];
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const lim = c.r + o.r * MARGE_CAILLOU;
    if (dx * dx + dy * dy >= lim * lim) continue;
    o.cai |= bit;
    const d = o.vx * dy - o.vy * dx > 0 ? -c.d : c.d;
    const vx = o.vx - d * o.vy;
    const vy = o.vy + d * o.vx;
    o.vx = vx * PERTE_CAILLOU;
    o.vy = vy * PERTE_CAILLOU;
    etat.chocs.push({ x: c.x, y: c.y, force: 30, jack: true });
  }
}

function integrer(etat) {
  const dec = etat.sol.frottement * PAS;
  const impact = etat.sol.impact;
  const objets = etat.objets;
  for (let i = 0; i < objets.length; i++) {
    const o = objets[i];
    if (!o.vivant) continue;
    if (o.vx === 0 && o.vy === 0) { o.cai = 0; continue; }
    if (o.air > 0) {
      // En vol : trajectoire droite sans frottement, ni choc ; à l'impact la vitesse chute.
      o.x += o.vx * PAS;
      o.y += o.vy * PAS;
      o.air--;
      if (o.air === 0) {
        o.vx *= impact;
        o.vy *= impact;
        if (horsTerrain(o)) {
          o.vivant = false;
          o.vx = 0;
          o.vy = 0;
        }
      }
      continue;
    }
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
    if (etat.cailloux.length) cailloux(etat, o);
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
    if (!a.vivant || a.air > 0) continue;
    for (let j = i + 1; j < objets.length; j++) {
      const b = objets[j];
      if (!b.vivant || b.air > 0) continue;
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
