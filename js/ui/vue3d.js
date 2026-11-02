// Vue en perspective du terrain : une caméra derrière le lanceur, légèrement en hauteur.
// Purement visuel : la physique reste en 2D (x, y) du terrain, rien ici ne la touche.
import { TERRAIN, LANCER } from '../core/physique.js';
import { mulberry32 } from '../core/rng.js';

// Vue en hauteur, presque de dessus (type isométrique) : on voit le terrain en entier et la
// hauteur des boules en l'air.
const HAUTEUR = 600;                 // hauteur de la caméra au-dessus du sol
const RECUL = 100;                   // distance derrière le cercle de lancer
const TANGAGE = (50 * Math.PI) / 180;
const Y_LANCER_ECRAN = 0.8;          // position verticale du cercle de lancer à l'écran
const Y_FOND_ECRAN = 0.2;            // position du fond de piste
const Y_FOND = 50;                   // ordonnée terrain du fond de piste

// Les boules et le cochonnet sont dessinés un peu plus gros que leur rayon physique,
// sinon le fond de piste les réduit à quelques pixels.
export const GROSSISSEMENT = 1.2;

export class Camera {
  constructor(l, h) {
    this.l = l;
    this.h = h;
    this.s = Math.sin(TANGAGE);
    this.c = Math.cos(TANGAGE);
    this.camY = LANCER.y + RECUL;
    const qLancer = this.q(LANCER.y);
    const qFond = this.q(Y_FOND);
    this.f = Math.min((h * (Y_LANCER_ECRAN - Y_FOND_ECRAN)) / (qFond - qLancer), l * 1.5);
    this.cx = l / 2;
    this.cy = h * Y_LANCER_ECRAN + this.f * qLancer;
    this.horizon = this.cy - this.f * Math.tan(TANGAGE);
    // Écrasement vertical au cercle de lancer : pixels par unité en hauteur d'écran ÷ en largeur.
    const a = this.projeter(LANCER.x, LANCER.y, 0);
    const b = this.projeter(LANCER.x, LANCER.y - 10, 0);
    this.ratio = (a.y - b.y) / (10 * a.k);
  }

  // Tangente de l'angle vu depuis l'axe optique pour un point (y, hauteur).
  q(y, hauteur = 0) {
    const u = this.camY - y;
    const dh = hauteur - HAUTEUR;
    return (u * this.s + dh * this.c) / (u * this.c - dh * this.s);
  }

  // Terrain (x, y) à hauteur du sol → écran. k = pixels par unité à cette profondeur.
  projeter(x, y, hauteur = 0) {
    const u = this.camY - y;
    const dh = hauteur - HAUTEUR;
    const profondeur = u * this.c - dh * this.s;
    const k = this.f / profondeur;
    return { x: this.cx + (x - LANCER.x) * k, y: this.cy - (u * this.s + dh * this.c) * k, k };
  }

  // Ligne d'écran → ordonnée du terrain (sol), pour peindre la piste ligne par ligne.
  sol(ecranY) {
    const q = (this.cy - ecranY) / this.f;
    const u = (HAUTEUR * (this.c + q * this.s)) / (this.s - q * this.c);
    return this.camY - u;
  }

  // Ordonnée écran → échelle (px par unité) pour une ligne du sol.
  echelleLigne(ecranY) {
    const y = this.sol(ecranY);
    return this.f / ((this.camY - y) * this.c + HAUTEUR * this.s);
  }
}

// ---------------------------------------------------------------- Décor statique

function hasard(graine) { return mulberry32(graine); }

function ciel(g, cam, l) {
  const h = cam.horizon + 2;
  if (h <= 2) return;
  const fond = g.createLinearGradient(0, 0, 0, h);
  fond.addColorStop(0, '#25344a');
  fond.addColorStop(0.55, '#6d7088');
  fond.addColorStop(1, '#f0b88c');
  g.fillStyle = fond;
  g.fillRect(0, 0, l, h);
  // Soleil bas, côté haut-gauche : cohérent avec les ombres portées vers la droite.
  const soleil = g.createRadialGradient(l * 0.18, h * 0.88, 0, l * 0.18, h * 0.88, l * 0.7);
  soleil.addColorStop(0, 'rgba(255,214,150,.55)');
  soleil.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = soleil;
  g.fillRect(0, 0, l, h);
}

function arbre(g, cam, x, y, hauteur, rng, teinte) {
  const pied = cam.projeter(x, y, 0);
  const k = pied.k;
  const tronc = hauteur * 0.55;
  const haut = cam.projeter(x, y, tronc);
  g.fillStyle = '#3b2a20';
  const lt = 11 * k;
  g.fillRect(pied.x - lt / 2, haut.y, lt, pied.y - haut.y);
  // Houppier : plusieurs masses, ombre en bas à droite, lumière en haut à gauche.
  const centre = cam.projeter(x, y, tronc + hauteur * 0.32);
  const rayon = hauteur * 0.5 * k;
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * rayon * 0.7;
    const r = rayon * (0.45 + rng() * 0.3);
    const cx = centre.x + Math.cos(a) * d;
    const cy = centre.y + Math.sin(a) * d * 0.6;
    const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 0, cx, cy, r);
    gr.addColorStop(0, teinte[0]);
    gr.addColorStop(1, teinte[1]);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
}

function fond(g, cam, l) {
  const rng = hasard(0xb10c);
  const h = cam.h;
  // Herbe sur tout l'écran (l'horizon est hors cadre), avec brins clairs et sombres.
  const herbe = g.createLinearGradient(0, 0, 0, h);
  herbe.addColorStop(0, '#5f7f43');
  herbe.addColorStop(1, '#496a35');
  g.fillStyle = herbe;
  g.fillRect(0, 0, l, h);
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = rng() < 0.5 ? 'rgba(150,190,100,.30)' : 'rgba(30,55,25,.30)';
    g.lineWidth = 1;
    const x = rng() * l;
    const y = rng() * h;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 3);
    g.stroke();
  }

  // Haie derrière le fond de piste et le long des côtés
  for (const [x0, y0, x1, y1] of [[-400, -26, 760, -26], [-34, -26, -34, 700], [394, -26, 394, 700]]) {
    const a = cam.projeter(x0, y0, 0);
    const b = cam.projeter(x1, y1, 0);
    const a2 = cam.projeter(x0, y0, 26);
    const b2 = cam.projeter(x1, y1, 26);
    const haie = g.createLinearGradient(0, Math.min(a2.y, b2.y), 0, Math.max(a.y, b.y));
    haie.addColorStop(0, '#59803f');
    haie.addColorStop(1, '#2c4727');
    g.fillStyle = haie;
    g.beginPath();
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b2.x, b2.y); g.lineTo(a2.x, a2.y);
    g.closePath();
    g.fill();
  }

  // Arbres autour de la piste : ombre au sol (soleil haut-gauche), tronc, houppier.
  const arbres = [[-80, 130], [-90, 400], [440, 250], [450, 520], [150, -110], [330, -100]];
  for (const [x, y] of arbres) {
    const o = cam.projeter(x + 40, y + 45, 0);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(o.x, o.y, 62 * o.k, 46 * o.k, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y] of arbres) arbre(g, cam, x, y, 150 + rng() * 30, rng, ['#7f9a56', '#3a5a30']);
}

// Piste : la texture de terrain (vue du dessus) est étirée ligne par ligne.
function piste(g, cam, texture, echelleTex, l, h) {
  const yFondPiste = cam.projeter(0, 0).y;
  const debut = Math.max(0, Math.ceil(cam.horizon), Math.floor(yFondPiste));
  for (let ey = debut; ey < h; ey++) {
    const y = cam.sol(ey + 0.5);
    if (y < 0 || y >= TERRAIN.h) continue;
    const k = cam.echelleLigne(ey + 0.5);
    const x0 = cam.cx + (0 - LANCER.x) * k;
    const x1 = cam.cx + (TERRAIN.l - LANCER.x) * k;
    g.drawImage(texture, 0, Math.floor(y * echelleTex), TERRAIN.l * echelleTex, 1, x0, ey, x1 - x0, 1.6);
  }
}

// Bordures basses de la piste (planches), sur les deux côtés et au fond.
function bordures(g, cam) {
  const m = TERRAIN.marge - 6;
  const cotes = [m, TERRAIN.l - m];
  for (const x of cotes) {
    const bas = cam.projeter(x, TERRAIN.h - m, 0);
    const bas2 = cam.projeter(x, m, 0);
    const haut = cam.projeter(x, TERRAIN.h - m, 7);
    const haut2 = cam.projeter(x, m, 7);
    g.fillStyle = '#d6c5a8';
    g.beginPath();
    g.moveTo(bas.x, bas.y); g.lineTo(bas2.x, bas2.y);
    g.lineTo(haut2.x, haut2.y); g.lineTo(haut.x, haut.y);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,245,225,.55)';
    g.lineWidth = Math.max(1, haut.k * 1.1);
    g.beginPath();
    g.moveTo(haut.x, haut.y); g.lineTo(haut2.x, haut2.y);
    g.stroke();
  }
  const g1 = cam.projeter(cotes[0], m, 0);
  const g2 = cam.projeter(cotes[1], m, 0);
  const g3 = cam.projeter(cotes[0], m, 7);
  const g4 = cam.projeter(cotes[1], m, 7);
  g.fillStyle = '#bfae92';
  g.beginPath();
  g.moveTo(g1.x, g1.y); g.lineTo(g2.x, g2.y); g.lineTo(g4.x, g4.y); g.lineTo(g3.x, g3.y);
  g.closePath();
  g.fill();
}

// Image fixe du décor : ciel, arbres, sol, piste, brume, vignette. Recalculée au redimensionnement.
export function peindreDecor(g, cam, texture, echelleTex) {
  const { l, h } = cam;
  ciel(g, cam, l);
  fond(g, cam, l);
  piste(g, cam, texture, echelleTex, l, h);
  bordures(g, cam);
  // Vignette
  const v = g.createRadialGradient(l / 2, h * 0.55, h * 0.3, l / 2, h * 0.55, h * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, l, h);
}

// ---------------------------------------------------------------- Objets en perspective

// Ombre au sol : cercle du terrain projeté, donc ellipse aplatie. Soleil haut-gauche.
export function ombreSol(ctx, cam, x, y, rayon, alpha = 0.4, hauteur = 0) {
  // Plus la boule est haut, plus l'ombre s'écarte (soleil haut-gauche) et s'estompe.
  alpha *= 1 / (1 + hauteur / 220);
  const p = cam.projeter(x + rayon * 0.55 + hauteur * 0.45, y + rayon * 0.35 + hauteur * 0.6, 0);
  const avant = cam.projeter(x, y + rayon, 0);
  const arriere = cam.projeter(x, y - rayon, 0);
  const rx = rayon * p.k * 1.05;
  const ry = Math.max(1, Math.abs(avant.y - arriere.y) / 2) * 1.05;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(0.7, `rgba(0,0,0,${alpha * 0.6})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

// Direction du tir : trait pointillé court au sol. Aucun point d'arrivée n'est montré,
// c'est au joueur de doser la force.
export function guide(ctx, cam, x0, y0, dx, dy) {
  const a = cam.projeter(x0 + dx * 22, y0 + dy * 22, 0);
  const b = cam.projeter(x0 + dx * 95, y0 + dy * 95, 0);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,170,115,.95)';
  ctx.lineWidth = Math.max(2, a.k * 1.8);
  ctx.lineCap = 'round';
  ctx.setLineDash([a.k * 5, a.k * 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

// Jauge de force : anneau autour du cercle de lancer qui se remplit.
export function jauge(ctx, cam, x, y, p) {
  const R = 30;
  const c = cam.projeter(x, y, 0);
  const ry = Math.abs(cam.projeter(x, y + R, 0).y - cam.projeter(x, y - R, 0).y) / 2;
  const rx = R * c.k;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, c.k * 4);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,150,95,.98)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  ctx.stroke();
  ctx.restore();
}
