import { step, ajouterBoule, lancer, LANCER, portee } from './physique.js';
import { meilleures } from './partie.js';
import { gauss } from './rng.js';

// Facile / Club / Maître : erreur angulaire (rad), sous-tir, nombre de coups évalués.
export const NIVEAUX = [
  { nom: 'Facile', erreur: 0.22, sousTir: 0.12, essais: 1 },
  { nom: 'Club', erreur: 0.11, sousTir: 0, essais: 10 },
  { nom: 'Maître', erreur: 0.04, sousTir: 0, essais: 24 },
];

const RAD_EN_CD = 18000 / Math.PI;

function versCible(x, y) {
  const dx = x - LANCER.x;
  const dy = y - LANCER.y;
  const cd = Math.round(Math.atan2(dy, dx) * RAD_EN_CD);
  return { cd: (cd + 36000) % 36000, dist: Math.sqrt(dx * dx + dy * dy) };
}

function cloner(etat) {
  return { objets: etat.objets.map((o) => ({ ...o })), sol: etat.sol, cailloux: etat.cailloux, pas: 0, chocs: [] };
}

// Valeur d'une position pour l'équipe : marge d'avance sur l'adversaire.
function evaluer(etat, equipe) {
  if (!etat.objets[0].vivant) return -500;
  const best = meilleures(etat);
  const nous = Math.min(best[equipe], 400);
  const eux = Math.min(best[1 - equipe], 400);
  return eux - nous;
}

function simuler(etat, equipe, cd, p) {
  const copie = cloner(etat);
  const i = ajouterBoule(copie, equipe);
  lancer(copie, i, cd, p);
  while (!step(copie));
  return evaluer(copie, equipe);
}

// Choisit un coup (angle en centièmes de degré, puissance 0..1).
export function choisirCoup(moteur, niveau, rng) {
  const cfg = NIVEAUX[niveau] || NIVEAUX[1];
  const equipe = moteur.tour;
  const etat = moteur.etat;
  const jack = etat.objets[0];
  const PORTEE = portee(etat.sol);

  // Début de mène : lancer le cochonnet droit devant, à distance variable.
  if (moteur.phase === 'cochonnet') {
    return {
      angle: Math.round(27000 + (rng() - 0.5) * 500),
      puissance: 0.25 + rng() * 0.6,
    };
  }

  // Candidat de base : pointer au cochonnet.
  const cible = versCible(jack.x, jack.y);
  const candidats = [{ cd: cible.cd, p: Math.min(1, cible.dist / PORTEE) }];

  if (cfg.essais > 1) {
    // Variantes de pointage autour du cochonnet.
    for (let k = 0; k < cfg.essais; k++) {
      const ox = (rng() - 0.5) * 24;
      const oy = (rng() - 0.5) * 30;
      const c = versCible(jack.x + ox, jack.y + oy);
      candidats.push({ cd: c.cd, p: Math.min(1, c.dist / PORTEE) });
    }
    // Tir sur la meilleure boule adverse si elle tient le point.
    const best = meilleures(etat);
    if (best[1 - equipe] < best[equipe]) {
      let gene = null;
      for (let i = 1; i < etat.objets.length; i++) {
        const o = etat.objets[i];
        if (!o.vivant || o.equipe === equipe) continue;
        const dx = o.x - jack.x;
        const dy = o.y - jack.y;
        if (Math.sqrt(dx * dx + dy * dy) === best[1 - equipe]) gene = o;
      }
      if (gene) {
        const c = versCible(gene.x, gene.y);
        for (const surplus of [1.15, 1.35, 1.6]) {
          candidats.push({ cd: c.cd, p: Math.min(1, (c.dist / PORTEE) * surplus) });
        }
      }
    }
  }

  let choix = candidats[0];
  if (candidats.length > 1) {
    let meilleur = -Infinity;
    for (const c of candidats) {
      const v = simuler(etat, equipe, c.cd, c.p);
      if (v > meilleur) { meilleur = v; choix = c; }
    }
  }

  // Erreur humaine : gaussienne seedée, amplitude ≈ 2σ.
  const errAngle = gauss(rng) * (cfg.erreur / 2) * RAD_EN_CD;
  const errPuiss = 1 + gauss(rng) * cfg.erreur * 0.18;
  const p = choix.p * (1 - cfg.sousTir) * errPuiss;
  return {
    angle: Math.round((choix.cd + errAngle + 36000) % 36000),
    puissance: Math.min(1, Math.max(0.05, p)),
  };
}

// Délai de réflexion 600–1100 ms, puis coup.
export function jouerBot(partie, niveau, rng) {
  const delai = 600 + rng() * 500;
  return new Promise((ok) => {
    setTimeout(() => {
      if (partie.fini || partie.enVol) return ok(false);
      const { angle, puissance } = choisirCoup(partie.moteur, niveau, rng);
      ok(partie.jouer(angle, puissance));
    }, delai);
  });
}
