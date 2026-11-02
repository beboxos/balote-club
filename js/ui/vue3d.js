// Vue du terrain en perspective, en hauteur et pivotée (type isométrique).
// Purement visuel : la physique reste en 2D (x, y) du terrain, rien ici ne la touche.
import { TERRAIN, LANCER, RAYON } from '../core/physique.js';
import { mulberry32 } from '../core/rng.js';

const HAUTEUR = 600;                 // hauteur de la caméra au-dessus du sol
// Vue iso de base (terrain normal) : tangage 50°, rotation 35° autour de la verticale. Plus le
// terrain est long, plus la vue se redresse (tangage ↑) et s'aligne sur l'axe du terrain (rotation ↓),
// pour que le terrain entier garde la même taille à l'écran. Réglé à 18° / 59° pour 920 unités.
const rad = (d) => (d * Math.PI) / 180;
function angles(h) {
  const t = Math.min(1, Math.max(0, (h - 640) / 280));
  return { tangage: rad(50 + 9 * t), lacet: rad(35 - 17 * t) };
}
const DISTANCE = 336;                // recul de la caméra par rapport au pivot

// Les boules et le cochonnet sont dessinés un peu plus gros que leur rayon physique,
// sinon le fond de piste les réduit à quelques pixels.
export const GROSSISSEMENT = 1.2;

export class Camera {
  constructor(l, h) {
    this.l = l;
    this.h = h;
    const { tangage, lacet } = angles(TERRAIN.h);
    this.s = Math.sin(tangage);
    this.c = Math.cos(tangage);
    this.cl = Math.cos(lacet);
    this.sl = Math.sin(lacet);
    // Position de la caméra dans le terrain, pour savoir quelles faces sont visibles.
    // Pivot au milieu du terrain (330 pour la longueur normale), donc fonction de la longueur choisie.
    this.pivot = { x: TERRAIN.l / 2, y: TERRAIN.h / 2 + 10 };
    this.pos = { x: this.pivot.x + DISTANCE * this.sl, y: this.pivot.y + DISTANCE * this.cl, z: HAUTEUR };
    this.f = 1;
    this.cx = 0;
    this.cy = 0;
    this.cadrer();
  }

  // Cadre la piste et la zone des joueurs dans la fenêtre, entre le bandeau du haut et celui du bas.
  cadrer() {
    const m = TERRAIN.marge - 6;
    const points = [
      [m, m, 0], [TERRAIN.l - m, m, 0], [TERRAIN.l - m, TERRAIN.h - m, 0], [m, TERRAIN.h - m, 0],
      [LANCER.x - 70, LANCER.y + 14, 85], [LANCER.x + 70, LANCER.y + 14, 85],
    ];
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const [x, y, z] of points) {
      const n = this.normalise(x, y, z);
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
      y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    this.f = Math.min((this.l * 0.94) / (x1 - x0), (this.h * 0.81) / (y1 - y0));
    this.cx = this.l / 2 - (this.f * (x0 + x1)) / 2;
    this.cy = this.h * 0.5 + (this.f * (y0 + y1)) / 2;
  }

  // Coordonnées d'écran pour f = 1, centrées sur l'axe optique.
  normalise(x, y, hauteur) {
    const dx = x - this.pivot.x;
    const dy = y - this.pivot.y;
    const rx = dx * this.cl - dy * this.sl;
    const ry = dx * this.sl + dy * this.cl;
    const u = DISTANCE - ry;
    const dh = hauteur - HAUTEUR;
    const profondeur = u * this.c - dh * this.s;
    return { x: rx / profondeur, y: (u * this.s + dh * this.c) / profondeur, p: profondeur };
  }

  // Terrain (x, y, hauteur) → écran. k = pixels par unité à cette profondeur.
  projeter(x, y, hauteur = 0) {
    const n = this.normalise(x, y, hauteur);
    return { x: this.cx + this.f * n.x, y: this.cy - this.f * n.y, k: this.f / n.p };
  }

  // Vecteurs d'écran d'une unité de terrain en x et en y, au cercle de lancer : sert à convertir
  // un glissement du doigt en direction de tir.
  base() {
    const o = this.projeter(LANCER.x, LANCER.y, 0);
    const a = this.projeter(LANCER.x + 1, LANCER.y, 0);
    const b = this.projeter(LANCER.x, LANCER.y + 1, 0);
    return { ex: { x: a.x - o.x, y: a.y - o.y }, ey: { x: b.x - o.x, y: b.y - o.y } };
  }
}

// ---------------------------------------------------------------- Volumes

function nuancer(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function polygone(g, pts, couleur) {
  g.fillStyle = couleur;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fill();
}

// Éclairage fixe depuis le haut-gauche du terrain, indépendant de la rotation de la vue.
const LUMIERE = { haut: 1.18, xNeg: 1.0, xPos: 0.74, yNeg: 0.9, yPos: 0.8 };

// Parallélépipède axé sur le terrain : on ne dessine que les faces tournées vers la caméra.
export function boite(g, cam, cx, cy, z, w, d, h, couleur) {
  const x0 = cx - w / 2; const x1 = cx + w / 2;
  const y0 = cy - d / 2; const y1 = cy + d / 2;
  const z1 = z + h;
  const P = (x, y, zz) => cam.projeter(x, y, zz);
  const cam3 = cam.pos;
  const faces = [
    { n: [-1, 0, 0], p: [x0, cy, z + h / 2], q: [[x0, y0, z], [x0, y1, z], [x0, y1, z1], [x0, y0, z1]], f: LUMIERE.xNeg },
    { n: [1, 0, 0], p: [x1, cy, z + h / 2], q: [[x1, y0, z], [x1, y1, z], [x1, y1, z1], [x1, y0, z1]], f: LUMIERE.xPos },
    { n: [0, -1, 0], p: [cx, y0, z + h / 2], q: [[x0, y0, z], [x1, y0, z], [x1, y0, z1], [x0, y0, z1]], f: LUMIERE.yNeg },
    { n: [0, 1, 0], p: [cx, y1, z + h / 2], q: [[x0, y1, z], [x1, y1, z], [x1, y1, z1], [x0, y1, z1]], f: LUMIERE.yPos },
    { n: [0, 0, 1], p: [cx, cy, z1], q: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], f: LUMIERE.haut },
  ];
  for (const f of faces) {
    const vu = (cam3.x - f.p[0]) * f.n[0] + (cam3.y - f.p[1]) * f.n[1] + (cam3.z - f.p[2]) * f.n[2];
    if (vu <= 0) continue;
    polygone(g, f.q.map(([x, y, zz]) => P(x, y, zz)), nuancer(couleur, f.f));
  }
}

// ---------------------------------------------------------------- Décor statique

function hasard(graine) { return mulberry32(graine); }

function arbre(g, cam, x, y, hauteur, rng, teinte, large = 0.5) {
  const pied = cam.projeter(x, y, 0);
  const k = pied.k;
  const tronc = hauteur * 0.55;
  const haut = cam.projeter(x, y, tronc);
  g.fillStyle = '#3b2a20';
  const lt = 11 * k;
  g.fillRect(pied.x - lt / 2, haut.y, lt, pied.y - haut.y);
  // Houppier : plusieurs masses, lumière en haut à gauche.
  const centre = cam.projeter(x, y, tronc + hauteur * 0.32);
  const rayon = hauteur * large * k;
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * rayon * 0.7;
    const r = rayon * (0.45 + rng() * 0.3);
    const px = centre.x + Math.cos(a) * d;
    const py = centre.y + Math.sin(a) * d * 0.7;
    const gr = g.createRadialGradient(px - r * 0.3, py - r * 0.35, 0, px, py, r);
    gr.addColorStop(0, teinte[0]);
    gr.addColorStop(1, teinte[1]);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }
}

function herbe(g, cam) {
  const { l, h } = cam;
  const rng = hasard(0xb10c);
  const fond = g.createLinearGradient(0, 0, 0, h);
  fond.addColorStop(0, '#5f7f43');
  fond.addColorStop(1, '#496a35');
  g.fillStyle = fond;
  g.fillRect(0, 0, l, h);
  for (let i = 0; i < 1100; i++) {
    g.strokeStyle = rng() < 0.5 ? 'rgba(150,190,100,.30)' : 'rgba(30,55,25,.30)';
    g.lineWidth = 1;
    const x = rng() * l;
    const y = rng() * h;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 3);
    g.stroke();
  }
}

// Haies basses autour du terrain, au-delà des planches.
function haies(g, cam) {
  const hauteurHaie = 26;
  const segments = [
    [-60, -50, TERRAIN.l + 60, -38],
    [-60, -50, -48, TERRAIN.h + 50],
    [TERRAIN.l + 48, -50, TERRAIN.l + 60, TERRAIN.h + 50],
  ];
  for (const [x0, y0, x1, y1] of segments) {
    boite(g, cam, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, hauteurHaie, '#3f6236');
  }
}

// Piste : la texture de terrain (vue du dessus) est plaquée sur une grille de triangles projetés.
function triangle(g, tex, s0, s1, s2, t0, t1, t2) {
  const det = (t1.x - t0.x) * (t2.y - t0.y) - (t2.x - t0.x) * (t1.y - t0.y);
  if (Math.abs(det) < 1e-9) return;
  const a = ((s1.x - s0.x) * (t2.y - t0.y) - (s2.x - s0.x) * (t1.y - t0.y)) / det;
  const c = ((s2.x - s0.x) * (t1.x - t0.x) - (s1.x - s0.x) * (t2.x - t0.x)) / det;
  const b = ((s1.y - s0.y) * (t2.y - t0.y) - (s2.y - s0.y) * (t1.y - t0.y)) / det;
  const d = ((s2.y - s0.y) * (t1.x - t0.x) - (s1.y - s0.y) * (t2.x - t0.x)) / det;
  const e = s0.x - a * t0.x - c * t0.y;
  const f = s0.y - b * t0.x - d * t0.y;
  // Légère dilatation autour du centre : évite les fines lignes entre triangles voisins.
  const mx = (s0.x + s1.x + s2.x) / 3;
  const my = (s0.y + s1.y + s2.y) / 3;
  const gonfle = (p) => {
    const dx = p.x - mx; const dy = p.y - my;
    const n = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p.x + (dx / n) * 0.9, y: p.y + (dy / n) * 0.9 };
  };
  const p0 = gonfle(s0); const p1 = gonfle(s1); const p2 = gonfle(s2);
  g.save();
  g.beginPath();
  g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.lineTo(p2.x, p2.y);
  g.closePath();
  g.clip();
  g.setTransform(a, b, c, d, e, f);
  const u0 = Math.min(t0.x, t1.x, t2.x) - 2;
  const v0 = Math.min(t0.y, t1.y, t2.y) - 2;
  const u1 = Math.max(t0.x, t1.x, t2.x) + 2;
  const v1 = Math.max(t0.y, t1.y, t2.y) + 2;
  g.drawImage(tex, u0, v0, u1 - u0, v1 - v0, u0, v0, u1 - u0, v1 - v0);
  g.restore();
}

function piste(g, cam, texture, echelleTex) {
  const NX = 18;
  const NY = 32;
  const sommets = [];
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = (i / NX) * TERRAIN.l;
      const y = (j / NY) * TERRAIN.h;
      sommets.push({ s: cam.projeter(x, y, 0), t: { x: x * echelleTex, y: y * echelleTex } });
    }
  }
  const at = (i, j) => sommets[j * (NX + 1) + i];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = at(i, j); const b = at(i + 1, j); const c = at(i + 1, j + 1); const d = at(i, j + 1);
      triangle(g, texture, a.s, b.s, c.s, a.t, b.t, c.t);
      triangle(g, texture, a.s, c.s, d.s, a.t, c.t, d.t);
    }
  }
}

// Planches de bordure de la piste.
function bordures(g, cam) {
  const m = TERRAIN.marge - 6;
  const e = 6;
  const L = TERRAIN.l;
  const H = TERRAIN.h;
  const planches = [
    [m - e, m - e, L - m + e, m],             // fond
    [m - e, H - m, L - m + e, H - m + e],     // côté lanceur
    [m - e, m, m, H - m],
    [L - m, m, L - m + e, H - m],
  ];
  for (const [x0, y0, x1, y1] of planches) {
    boite(g, cam, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, 8, '#cdbb9c');
  }
}

function arbres(g, cam) {
  const rng = hasard(0x7ee5);
  const places = [[-110, 120], [-120, 420], [470, 230], [480, 520], [140, -130], [330, -140]];
  for (const [x, y] of places) {
    const o = cam.projeter(x + 40, y + 45, 0);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(o.x, o.y, 62 * o.k, 46 * o.k, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y] of places) arbre(g, cam, x, y, 150 + rng() * 30, rng, ['#7f9a56', '#3a5a30']);
}

// Image fixe du décor. Recalculée au redimensionnement.
export function peindreDecor(g, cam, texture, echelleTex) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  herbe(g, cam);
  haies(g, cam);
  piste(g, cam, texture, echelleTex);
  bordures(g, cam);
  arbres(g, cam);
  const { l, h } = cam;
  const v = g.createRadialGradient(l / 2, h * 0.5, h * 0.3, l / 2, h * 0.5, h * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, l, h);
}

// ---------------------------------------------------------------- Objets en perspective

// Dessine dans le repère d'un cercle posé au sol : le rayon 1 devient l'ellipse projetée.
function surSol(ctx, cam, x, y, rayon, dessiner) {
  const o = cam.projeter(x, y, 0);
  const a = cam.projeter(x + rayon, y, 0);
  const b = cam.projeter(x, y + rayon, 0);
  ctx.save();
  ctx.transform(a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y, o.x, o.y);
  dessiner(ctx, rayon * o.k);
  ctx.restore();
}

// Ombre au sol, soleil haut-gauche. Plus la boule est haut, plus l'ombre s'écarte et s'estompe.
export function ombreSol(ctx, cam, x, y, rayon, alpha = 0.4, hauteur = 0) {
  alpha *= 1 / (1 + hauteur / 220);
  surSol(ctx, cam, x + rayon * 0.55 + hauteur * 0.45, y + rayon * 0.35 + hauteur * 0.6, 1, () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rayon * 1.05);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.7, `rgba(0,0,0,${alpha * 0.6})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rayon * 1.05, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Anneau posé au sol (fin de mène, point de chute, jauge).
export function anneauSol(ctx, cam, x, y, rayon, couleur, epaisseurPx, debut = 0, fin = Math.PI * 2) {
  surSol(ctx, cam, x, y, 1, () => {
    const o = cam.projeter(x, y, 0);
    ctx.strokeStyle = couleur;
    ctx.lineWidth = epaisseurPx / o.k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, rayon, debut, fin);
    ctx.stroke();
  });
}

export function cochonnet(ctx, px, py, rayon, tempsMs, calme) {
  const phase = calme ? 0.5 : 0.5 + 0.5 * Math.sin((tempsMs / 1600) * Math.PI * 2);
  ctx.save();
  ctx.shadowColor = `rgba(245,215,110,${0.5 + 0.25 * phase})`;
  ctx.shadowBlur = rayon * 3;
  const g = ctx.createRadialGradient(px - rayon * 0.3, py - rayon * 0.35, 0, px, py, rayon);
  g.addColorStop(0, '#fff6c9');
  g.addColorStop(1, '#f2d462');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, rayon, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Courbe du lancer jusqu'au point de chute (les rebonds et le roulement ne sont pas montrés).
// points : [{ x, y, h }] le long de la trajectoire, du lâcher à l'impact.
export function trajectoire(ctx, cam, points, tempsMs) {
  const sol = points.map((p) => cam.projeter(p.x, p.y, 0));
  const air = points.map((p) => cam.projeter(p.x, p.y, p.h));
  const fin = points[points.length - 1];
  const k = cam.projeter(fin.x, fin.y, 0).k;
  ctx.save();
  ctx.lineCap = 'round';
  // Trace au sol sous la courbe : aide à lire la distance
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = Math.max(1.5, k * 1.6);
  ctx.setLineDash([k * 3, k * 6]);
  ctx.beginPath();
  ctx.moveTo(sol[0].x, sol[0].y);
  for (let i = 1; i < sol.length; i++) ctx.lineTo(sol[i].x, sol[i].y);
  ctx.stroke();
  // Courbe en l'air
  ctx.strokeStyle = 'rgba(255,170,115,.98)';
  ctx.lineWidth = Math.max(2.2, k * 2.6);
  ctx.setLineDash([k * 6, k * 7]);
  ctx.lineDashOffset = -(tempsMs / 45) % (k * 13);
  ctx.beginPath();
  ctx.moveTo(air[0].x, air[0].y);
  for (let i = 1; i < air.length; i++) ctx.lineTo(air[i].x, air[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.restore();
  // Point de chute
  anneauSol(ctx, cam, fin.x, fin.y, RAYON * 1.9, 'rgba(255,150,95,.98)', Math.max(2.4, k * 2.4));
  anneauSol(ctx, cam, fin.x, fin.y, RAYON * 0.55, 'rgba(255,150,95,.85)', Math.max(2, k * 2));
}

// Jauge de force : anneau autour du cercle de lancer qui se remplit.
export function jauge(ctx, cam, x, y, p) {
  const k = cam.projeter(x, y, 0).k;
  anneauSol(ctx, cam, x, y, 30, 'rgba(0,0,0,.35)', Math.max(3, k * 4));
  anneauSol(ctx, cam, x, y, 30, 'rgba(255,150,95,.98)', Math.max(3, k * 4), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
}
