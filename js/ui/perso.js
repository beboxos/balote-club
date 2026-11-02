// Joueurs en volumes simples (style bloc), vus de dos. Dessin procédural, aucune image.
// Toutes les positions sont en unités du terrain, projetées par la caméra.
import { LANCER } from '../core/physique.js';
import { boite, ombreSol } from './vue3d.js';

// Échelle des joueurs par rapport aux boules (1 = taille réelle du jeu).
const S = 1.3;
const EPAULE_Z = 60;
const LONG_BRAS = 27;

const STYLES = [
  { maillot: '#c4552a', maillotCl: '#e0794a', short: '#2c3040', casquette: '#9c3a1b', peau: '#e4b48c', cheveux: '#3a2a20' },
  { maillot: '#3f6082', maillotCl: '#5f86ad', short: '#3a3228', casquette: '#2b4561', peau: '#c98d66', cheveux: '#17120f' },
];

function membre(ctx, cam, a, b, epaisseur, couleur, couleurBout) {
  const pa = cam.projeter(a.x, a.y, a.z);
  const pb = cam.projeter(b.x, b.y, b.z);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.28)';
  ctx.lineWidth = epaisseur * pa.k * 1.12;
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  ctx.strokeStyle = couleur;
  ctx.lineWidth = epaisseur * pa.k * 0.82;
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  ctx.fillStyle = couleurBout;
  ctx.beginPath(); ctx.arc(pb.x, pb.y, epaisseur * pb.k * 0.5, 0, Math.PI * 2); ctx.fill();
}

// pose : { bras (rad, 0 = le long du corps, π/2 = horizontal devant), penche (unités vers l'avant),
//          pas (rad, balancement des jambes) }
// Retourne la position de la main (pour la boule tenue ou lancée) en coordonnées terrain.
export function dessinerPerso(ctx, cam, { x, y, equipe, pose }) {
  const st = STYLES[equipe];
  const { bras, penche, pas } = pose;
  const tx = x;
  const ty = y - penche * S * 0.5;
  // Boîte positionnée par rapport aux pieds, tailles et décalages mis à l'échelle.
  const b = (dx, dy, z, w, d, h, couleur) => boite(ctx, cam, x + dx * S, ty + dy * S, z * S, w * S, d * S, h * S, couleur);

  ombreSol(ctx, cam, x, y, 15 * S, 0.45);

  // Jambes et chaussures
  const bal = Math.sin(pas) * 2.5;
  const jambe = (dx, d) => {
    boite(ctx, cam, x + dx * S, y + d * S, 0, 8 * S, 8 * S, 36 * S, st.short);
    boite(ctx, cam, x + dx * S, y + (d + 0.5) * S, 0, 8.4 * S, 9.6 * S, 4 * S, '#ece6da');
  };
  jambe(-5, bal);
  jambe(5, -bal);

  // Bras libre (à gauche de l'écran), puis tronc, tête
  const epauleG = { x: tx - 14 * S, y: ty, z: EPAULE_Z * S };
  membre(ctx, cam, epauleG, { x: tx - 15 * S, y: ty - 3 * S, z: (EPAULE_Z - LONG_BRAS * 0.96) * S }, 7 * S, st.maillot, st.peau);
  b(0, 0, 34, 22, 11, 30, st.maillot);
  b(0, 0.2, 52, 22.4, 11.4, 4, st.maillotCl);
  b(0, -penche * 0.2, 64, 13, 13, 13, st.peau);
  b(0, -penche * 0.2 + 1.5, 69, 13.6, 10.4, 8.6, st.cheveux);
  b(0, -penche * 0.2, 75.4, 14.6, 14.6, 3.6, st.casquette);

  // Bras qui lance (à droite de l'écran)
  const epaule = { x: tx + 14 * S, y: ty, z: EPAULE_Z * S };
  const main = {
    x: epaule.x + 0.5,
    y: epaule.y - LONG_BRAS * S * Math.sin(bras),
    z: epaule.z - LONG_BRAS * S * Math.cos(bras),
  };
  membre(ctx, cam, epaule, main, 7 * S, st.maillot, st.peau);
  return main;
}

export function positionRepos(equipe) {
  return { x: LANCER.x + (equipe === 0 ? -84 : 84), y: LANCER.y + 26 };
}

export function poste() { return { x: LANCER.x, y: LANCER.y + 8 }; }
