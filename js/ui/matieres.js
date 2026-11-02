// Rendu procédural du gameplay : aucune image téléchargée.
// Soleil haut-gauche : ombre portée (+3, +4), spéculaire haut-gauche, rim light bas-droite.
import { mulberry32 } from '../core/rng.js';
import { LANCER } from '../core/physique.js';

const OMBRE_DX = 3;
const OMBRE_DY = 4;

export const TEINTES = {
  0: ['#f0a17c', '#c4552a', '#7d2f14'],
  1: ['#9db4cc', '#3f6082', '#1f3348'],
};
const LISERE = { 0: 'rgba(224,122,79,.5)', 1: 'rgba(143,176,212,.5)' };

function canvasHorsEcran(l, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(l));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------- Texture d'argile : bruit de valeur 256², deux octaves, tuilable ----------

function bruitValeur(taille, cellules, rng) {
  const grille = new Float32Array(cellules * cellules);
  for (let i = 0; i < grille.length; i++) grille[i] = rng();
  const out = new Float32Array(taille * taille);
  const lisse = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < taille; y++) {
    const gy = (y / taille) * cellules;
    const y0 = Math.floor(gy);
    const fy = lisse(gy - y0);
    const y1 = (y0 + 1) % cellules;
    for (let x = 0; x < taille; x++) {
      const gx = (x / taille) * cellules;
      const x0 = Math.floor(gx);
      const fx = lisse(gx - x0);
      const x1 = (x0 + 1) % cellules;
      const a = grille[y0 * cellules + x0];
      const b = grille[y0 * cellules + x1];
      const c = grille[y1 * cellules + x0];
      const d = grille[y1 * cellules + x1];
      out[y * taille + x] = a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
    }
  }
  return out;
}

let motifArgile = null;

export function textureArgile(ctx) {
  if (motifArgile) return motifArgile;
  const T = 256;
  const rng = mulberry32(0xa161e);
  const o1 = bruitValeur(T, 16, rng);
  const o2 = bruitValeur(T, 64, rng);
  const c = canvasHorsEcran(T, T);
  const g = c.getContext('2d');
  const img = g.createImageData(T, T);
  // Palette #3a2a20 → #241a15
  const A = [0x3a, 0x2a, 0x20];
  const B = [0x24, 0x1a, 0x15];
  for (let i = 0; i < T * T; i++) {
    const grain = rng() * 0.18;
    const v = o1[i] * 0.62 + o2[i] * 0.38 + grain - 0.09;
    const t = Math.min(1, Math.max(0, (v - 0.5) * 2.2 + 0.5));
    img.data[i * 4] = A[0] + (B[0] - A[0]) * t;
    img.data[i * 4 + 1] = A[1] + (B[1] - A[1]) * t;
    img.data[i * 4 + 2] = A[2] + (B[2] - A[2]) * t;
    img.data[i * 4 + 3] = 230; // opacité .9
  }
  g.putImageData(img, 0, 0);
  // Gravillons clairs épars
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(200,170,145,${0.08 + rng() * 0.14})`;
    g.beginPath();
    g.arc(rng() * T, rng() * T, 0.4 + rng() * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  motifArgile = ctx.createPattern(c, 'repeat');
  return motifArgile;
}

// Terrain complet pré-composé dans un canvas (recalculé au redimensionnement seulement).
export function dessinerTerrain(ctx, l, h, marge) {
  const fond = ctx.createLinearGradient(0, 0, 0, h);
  fond.addColorStop(0, '#2c201a');
  fond.addColorStop(1, '#1a1310');
  ctx.fillStyle = fond;
  ctx.fillRect(0, 0, l, h);

  // Bande hors-jeu
  ctx.fillStyle = 'rgba(10,7,6,.55)';
  ctx.fillRect(0, 0, l, h);

  // Piste
  ctx.save();
  ctx.beginPath();
  ctx.rect(marge, marge, l - 2 * marge, h - 2 * marge);
  ctx.clip();
  ctx.fillStyle = fond;
  ctx.fillRect(marge, marge, l - 2 * marge, h - 2 * marge);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = textureArgile(ctx);
  ctx.fillRect(marge, marge, l - 2 * marge, h - 2 * marge);
  ctx.globalAlpha = 1;
  // Lumière rasante de fin de journée, depuis le haut-gauche
  const soleil = ctx.createLinearGradient(marge, marge, l - marge, h * 0.7);
  soleil.addColorStop(0, 'rgba(255,170,110,.14)');
  soleil.addColorStop(0.55, 'rgba(255,170,110,.03)');
  soleil.addColorStop(1, 'rgba(0,0,0,.12)');
  ctx.fillStyle = soleil;
  ctx.fillRect(marge, marge, l - 2 * marge, h - 2 * marge);
  ctx.restore();

  // Bordure intérieure 2 px
  ctx.strokeStyle = 'rgba(244,236,226,.13)';
  ctx.lineWidth = 2;
  ctx.strokeRect(marge + 1, marge + 1, l - 2 * marge - 2, h - 2 * marge - 2);

  // Cercle de lancer
  ctx.strokeStyle = 'rgba(244,236,226,.22)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(LANCER.x, LANCER.y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Vignette radiale
  const v = ctx.createRadialGradient(l / 2, h * 0.45, h * 0.2, l / 2, h * 0.45, h * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, l, h);
}

// Flou portable (Safari < 18 ignore ctx.filter) : on dessine la forme hors cadre
// et on ne garde que son ombre, décalée pile sur la position voulue.
function remplirFlou(g, flouPx, echelle, couleur, forme) {
  const loin = 2000;
  g.save();
  g.shadowColor = couleur;
  g.shadowBlur = flouPx * 2 * echelle;
  g.shadowOffsetX = loin * echelle;
  g.translate(-loin, 0);
  g.fillStyle = '#000';
  forme(g);
  g.fill();
  g.restore();
}

// ---------- Boules : sprites mis en cache par (équipe, index, échelle) ----------

const cacheBoules = new Map();
const cacheOmbres = new Map();

function spriteOmbre(r, echelle) {
  const cle = r + ':' + echelle;
  if (cacheOmbres.has(cle)) return cacheOmbres.get(cle);
  const pad = 6;
  const taille = (r * 2 + pad * 2) * echelle;
  const c = canvasHorsEcran(taille, taille);
  const g = c.getContext('2d');
  g.scale(echelle, echelle);
  const m = r + pad;
  remplirFlou(g, 3, echelle, 'rgba(0,0,0,.38)', (k) => {
    k.beginPath();
    k.ellipse(m, m, r, r * 0.92, 0, 0, Math.PI * 2);
  });
  const s = { c, m };
  cacheOmbres.set(cle, s);
  return s;
}

function spriteContact(r, echelle) {
  const cle = 'contact:' + r + ':' + echelle;
  if (cacheOmbres.has(cle)) return cacheOmbres.get(cle);
  const pad = 4;
  const taille = (r * 2 + pad * 2) * echelle;
  const c = canvasHorsEcran(taille, taille);
  const g = c.getContext('2d');
  g.scale(echelle, echelle);
  const m = r + pad;
  remplirFlou(g, 2, echelle, 'rgba(0,0,0,.30)', (k) => {
    k.beginPath();
    k.arc(m, m, r * 0.92, 0, Math.PI * 2);
  });
  const s = { c, m };
  cacheOmbres.set(cle, s);
  return s;
}

function spriteBoule(equipe, index, r, echelle) {
  const cle = equipe + ':' + index + ':' + r + ':' + echelle;
  if (cacheBoules.has(cle)) return cacheBoules.get(cle);
  const pad = 4;
  const taille = (r * 2 + pad * 2) * echelle;
  const c = canvasHorsEcran(taille, taille);
  const g = c.getContext('2d');
  g.scale(echelle, echelle);
  const x = r + pad;
  const y = r + pad;
  const [clair, moyen, sombre] = TEINTES[equipe];

  // Corps
  const corps = g.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x - r * 0.35, y - r * 0.4, r * 1.6);
  corps.addColorStop(0, clair);
  corps.addColorStop(0.45, moyen);
  corps.addColorStop(1, sombre);
  g.fillStyle = corps;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();

  // Usure : 2 à 3 taches, positions seedées par l'index (visuel seulement)
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.clip();
  const rng = mulberry32(index * 7919 + equipe * 104729 + 1);
  const n = 2 + Math.floor(rng() * 2);
  g.fillStyle = 'rgba(20,10,6,.28)';
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.7;
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.12, 0, Math.PI * 2);
    g.fill();
  }
  // Stries de guillochage, très discrètes
  g.strokeStyle = 'rgba(0,0,0,.12)';
  g.lineWidth = 0.6;
  for (let k = -1; k <= 1; k++) {
    g.beginPath();
    g.ellipse(x, y, r, r * 0.25, 0.5, Math.PI * (0.05 + k * 0.02), Math.PI * (0.95 + k * 0.02));
    g.stroke();
  }
  g.restore();

  // Rim light bas-droite
  g.strokeStyle = 'rgba(255,255,255,.28)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, r - 0.9, -0.1 * Math.PI, 0.6 * Math.PI);
  g.stroke();

  // Spéculaire
  remplirFlou(g, 1.5, echelle, 'rgba(255,255,255,.55)', (k) => {
    k.beginPath();
    k.ellipse(x - r * 0.35, y - r * 0.42, r * 0.34, r * 0.22, -0.5, 0, Math.PI * 2);
  });

  // Liseré d'appartenance
  g.strokeStyle = LISERE[equipe];
  g.lineWidth = 1;
  g.beginPath();
  g.arc(x, y, r + 0.5, 0, Math.PI * 2);
  g.stroke();

  const s = { c, m: r + pad };
  cacheBoules.set(cle, s);
  return s;
}

export function viderCaches() {
  cacheBoules.clear();
  cacheOmbres.clear();
}

export function dessinerOmbre(ctx, x, y, r, echelle) {
  const s = spriteOmbre(r, echelle);
  const t = s.c.width / echelle;
  ctx.drawImage(s.c, x + OMBRE_DX - s.m, y + OMBRE_DY - s.m, t, t);
}

export function dessinerBoule(ctx, x, y, r, equipe, index, echelle, alpha = 1) {
  const ct = spriteContact(r, echelle);
  const tc = ct.c.width / echelle;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(ct.c, x - ct.m, y - ct.m, tc, tc);
  const s = spriteBoule(equipe, index, r, echelle);
  const t = s.c.width / echelle;
  ctx.drawImage(s.c, x - s.m, y - s.m, t, t);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

// ---------- Cochonnet : halo pulsé sur 1,6 s (visuel) ----------

export function dessinerCochonnet(ctx, x, y, r, tempsMs, calme = false) {
  const phase = calme ? 0.5 : 0.5 + 0.5 * Math.sin((tempsMs / 1600) * Math.PI * 2);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x + OMBRE_DX * 0.6, y + OMBRE_DY * 0.6, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = `rgba(245,215,110,${0.55 + 0.25 * phase})`;
  ctx.shadowBlur = 14;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
  g.addColorStop(0, '#fff6c9');
  g.addColorStop(1, '#f7e07a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------- Viseur ----------

export function dessinerViseur(ctx, x, y, dx, dy, puissance) {
  const long = 40 + puissance * 190;
  const ex = x + dx * long;
  const ey = y + dy * long;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,122,69,.85)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.setLineDash([7, 9]);
  ctx.beginPath();
  ctx.moveTo(x + dx * 12, y + dy * 12);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // Réticule 6 px
  ctx.beginPath();
  ctx.arc(ex, ey, 6, 0, Math.PI * 2);
  ctx.moveTo(ex - 9, ey);
  ctx.lineTo(ex - 3, ey);
  ctx.moveTo(ex + 3, ey);
  ctx.lineTo(ex + 9, ey);
  ctx.moveTo(ex, ey - 9);
  ctx.lineTo(ex, ey - 3);
  ctx.moveTo(ex, ey + 3);
  ctx.lineTo(ex, ey + 9);
  ctx.stroke();
  ctx.restore();
}

// ---------- Particules et décalques ----------

export class Effets {
  constructor() {
    this.particules = [];
    this.decalques = [];
    this.rng = mulberry32(0xd057);
  }

  impact(x, y, force, metal) {
    const rng = this.rng;
    const n = 6 + Math.floor(rng() * 5);
    const k = Math.min(1, force / 400);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const v = (20 + rng() * 60) * (0.4 + k);
      this.particules.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10,
        vie: 0, duree: 220 + rng() * 200, taille: 1.2 + rng() * 1.6, metal: false,
      });
    }
    if (metal) {
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const v = 80 + rng() * 90;
        this.particules.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          vie: 0, duree: 160 + rng() * 120, taille: 1.1, metal: true,
        });
      }
    }
    this.decalques.push({ x, y, r: 3 + k * 4, age: 0 });
  }

  // Trace d'arrêt d'une boule au sol.
  marque(x, y, r) {
    this.decalques.push({ x, y, r, age: 0 });
  }

  maj(dtMs) {
    const dt = dtMs / 1000;
    for (const p of this.particules) {
      p.vie += dtMs;
      p.vy += 40 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    this.particules = this.particules.filter((p) => p.vie < p.duree);
    for (const d of this.decalques) d.age += dtMs;
    this.decalques = this.decalques.filter((d) => d.age < 3000);
  }

  dessinerDecalques(ctx) {
    for (const d of this.decalques) {
      ctx.fillStyle = `rgba(12,8,6,${0.18 * (1 - d.age / 3000)})`;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r * 1.3, d.r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dessinerParticules(ctx) {
    for (const p of this.particules) {
      const t = 1 - p.vie / p.duree;
      ctx.fillStyle = p.metal ? `rgba(255,217,168,${t})` : `rgba(200,170,145,${0.5 * t})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.taille * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  vider() {
    this.particules.length = 0;
    this.decalques.length = 0;
  }
}
