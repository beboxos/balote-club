import {
  creerEtat, ajouterBoule, lancer, step, distance,
  normaliserAngle, normaliserPuissance, puissanceCochonnet, PAS, LANCER, TERRAIN, SOLS, SOL_DEFAUT,
  CAILLOUX_DEFAUT, LONGUEUR_DEFAUT, nombreCailloux, fixerLongueur,
  DISPERSION_ANGLE, DISPERSION_PORTEE, facteurDispersion,
} from './physique.js';
import { deriver, mulberry32 } from './rng.js';

export const BUT = 5;
// Points pour gagner : 5 (partie courte) ou 13 (partie normale). Les duels restent à 5.
export const BUTS_CHOIX = [5, 13];
// Boules par équipe : 3 par défaut (tête-à-tête), réglable en solo. Les duels restent à 3.
export const BOULES_DEFAUT = 3;
export const BOULES_CHOIX = [3, 6];

// Dispersion du lancer (voir physique.js) : les deux appareils la tirent de la même graine et du
// même numéro de lancer ; elle grandit avec la puissance réellement appliquée.
function bruit(graine, n, p) {
  const rng = mulberry32(deriver(graine, 900000 + n));
  const tirer = () => Math.max(-2.5, Math.min(2.5, (rng() + rng() + rng() + rng() - 2) * 1.7320508));
  const f = facteurDispersion(p);
  return { angle: tirer() * DISPERSION_ANGLE * f, puissance: tirer() * DISPERSION_PORTEE * f };
}

// Le premier joueur de la mène lance le cochonnet. Après ce nombre de lancers nuls (sorti du
// terrain), le cochonnet est posé d'office pour ne pas bloquer la partie.
const ESSAIS_COCHONNET = 2;

// Position d'office du cochonnet, tirée de la graine serveur (entiers seulement).
export function positionJack(graine, mene, essai) {
  const h = deriver(graine, mene * 32 + essai);
  return { x: 100 + (h % 161), y: 80 + ((h >>> 9) % 121) };
}

// Petits cailloux semés sur la piste : positions et déviations tirées de la graine serveur.
export function semerCailloux(graine, mene, essai, nombre) {
  const rng = mulberry32(deriver(graine, 700000 + mene * 32 + essai));
  const liste = [];
  for (let k = 0; k < nombre; k++) {
    liste.push({
      x: 65 + Math.floor(rng() * 230),
      y: 95 + Math.floor(rng() * (TERRAIN.h - 260)),
      r: 3 + Math.floor(rng() * 3),
      d: (14 + Math.floor(rng() * 19)) / 100,
    });
  }
  return liste;
}

// Meilleure distance au cochonnet par équipe (Infinity si aucune boule vivante).
export function meilleures(etat) {
  const jack = etat.objets[0];
  const best = [Infinity, Infinity];
  for (let i = 1; i < etat.objets.length; i++) {
    const o = etat.objets[i];
    if (!o.vivant) continue;
    const d = distance(o, jack);
    if (d < best[o.equipe]) best[o.equipe] = d;
  }
  return best;
}

// Points de la mène : chaque boule de l'équipe la mieux placée plus proche que la
// meilleure boule adverse vaut 1. Égalité parfaite : personne ne marque.
export function compterMene(etat) {
  const best = meilleures(etat);
  if (best[0] === best[1]) return { gagnant: -1, points: 0 };
  const g = best[0] < best[1] ? 0 : 1;
  const jack = etat.objets[0];
  let points = 0;
  for (let i = 1; i < etat.objets.length; i++) {
    const o = etat.objets[i];
    if (o.vivant && o.equipe === g && distance(o, jack) < best[1 - g]) points++;
  }
  return { gagnant: g, points };
}

// Moteur de règles pur : aucune notion de temps ni de réseau.
export class Moteur {
  // terrain : réglages qui ne changent pas les règles mais le jeu { cailloux (%), longueur }.
  constructor(graine, boules = BOULES_DEFAUT, sol = SOL_DEFAUT, but = BUT, terrain = {}) {
    this.graine = graine;
    this.but = but;
    this.cailloux = terrain.cailloux ?? CAILLOUX_DEFAUT;
    this.longueur = fixerLongueur(terrain.longueur ?? LONGUEUR_DEFAUT).id;
    this.boules = boules;
    this.sol = SOLS[sol] || SOLS[SOL_DEFAUT];
    this.lancers = 0;
    this.scores = [0, 0];
    this.mene = 1;
    this.essai = 0;
    this.ouvreur = 0;
    this.fini = false;
    this.nouvelleMene();
  }

  nouvelleMene() {
    const cailloux = semerCailloux(this.graine, this.mene, this.essai, nombreCailloux(this.cailloux));
    if (this.essai >= ESSAIS_COCHONNET) {
      this.etat = creerEtat(positionJack(this.graine, this.mene, this.essai), this.sol, cailloux);
      this.phase = 'boules';
    } else {
      this.etat = creerEtat(LANCER, this.sol, cailloux);
      this.etat.objets[0].enMain = true;
      this.phase = 'cochonnet';
    }
    this.jouees = [0, 0];
    this.tour = this.ouvreur;
    this.dernier = -1;
  }

  restantes(e) { return this.boules - this.jouees[e]; }

  // Ajoute et lance la boule de l'équipe au tour (ou le cochonnet en début de mène).
  // Le déplacement se fait par step().
  preparer(angle, puissance) {
    const e = this.tour;
    if (this.phase === 'cochonnet') {
      this.dernier = e;
      const pe = puissanceCochonnet(puissance, this.sol);
      const b = bruit(this.graine, this.lancers++, pe);
      lancer(this.etat, 0, angle + b.angle, pe * (1 + b.puissance));
      return 0;
    }
    const i = ajouterBoule(this.etat, e);
    this.jouees[e]++;
    this.dernier = e;
    const b = bruit(this.graine, this.lancers++, puissance);
    lancer(this.etat, i, angle + b.angle, puissance * (1 + b.puissance));
    return i;
  }

  // Applique les règles une fois tout immobile. Retourne l'événement produit.
  resoudre() {
    const jack = this.etat.objets[0];
    if (!jack.vivant) {
      this.essai++;
      this.nouvelleMene();
      return { type: 'annulee' };
    }
    if (this.phase === 'cochonnet') {
      // Cochonnet en place : la même équipe lance la première boule.
      this.phase = 'boules';
      return { type: 'tour', equipe: this.tour, cochonnet: true };
    }
    if (this.jouees[0] === this.boules && this.jouees[1] === this.boules) {
      const { gagnant, points } = compterMene(this.etat);
      const mene = this.mene;
      if (gagnant >= 0) {
        this.scores[gagnant] += points;
        this.ouvreur = gagnant;
      }
      if (gagnant >= 0 && this.scores[gagnant] >= this.but) {
        this.fini = true;
        return { type: 'fin', gagnant, points, mene, scores: this.scores.slice() };
      }
      this.mene++;
      this.essai = 0;
      this.nouvelleMene();
      return { type: 'mene', gagnant, points, mene, scores: this.scores.slice() };
    }
    this.tour = this.equipeSuivante();
    return { type: 'tour', equipe: this.tour };
  }

  equipeSuivante() {
    const d = this.dernier;
    if (this.restantes(0) === 0) return 1;
    if (this.restantes(1) === 0) return 0;
    const best = meilleures(this.etat);
    if (best[0] === best[1]) return d;
    return best[0] > best[1] ? 0 : 1;
  }

  // Joue un coup entier sans animation.
  jouerInstantane(angle, puissance) {
    this.preparer(angle, puissance);
    while (!step(this.etat));
    this.etat.chocs.length = 0;
    return this.resoudre();
  }
}

// Reconstruit l'état complet depuis le journal de coups (anti-triche et resynchro).
export function rejouer(graine, coups, boules = BOULES_DEFAUT, sol = SOL_DEFAUT, but = BUT, terrain = {}) {
  const m = new Moteur(graine, boules, sol, but, terrain);
  for (const c of coups) {
    if (m.fini) break;
    m.jouerInstantane(c.angle, c.puissance);
  }
  return m;
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const attendreFrame = () => new Promise((ok) => requestAnimationFrame(ok));

export class Partie {
  // equipeAuteur(uid) → 0 / 1 / -1 : en duel, un coup distant n'est accepté que si son
  // auteur (garanti par RLS dans le journal) est bien l'équipe dont c'est le tour.
  constructor({ graine, cote = 0, reseau = null, equipeAuteur = null, boules = BOULES_DEFAUT, sol = SOL_DEFAUT, but = BUT, cailloux = CAILLOUX_DEFAUT, longueur = LONGUEUR_DEFAUT, local = false, avantLancer, onTour, onCoup, onFin, onManche, onAnnulee }) {
    this.graine = graine;
    this.boules = boules;
    this.sol = sol;
    this.but = but;
    this.terrain = { cailloux, longueur };
    this.equipeAuteur = equipeAuteur;
    this.cote = cote;
    this.reseau = reseau;
    this.local = local;      // deux joueurs sur le même appareil : chacun joue quand c'est son tour
    this.bloque = false;     // vrai pendant l'écran « passez le téléphone »
    this.cb = { avantLancer, onTour, onCoup, onFin, onManche, onAnnulee };
    this.moteur = new Moteur(graine, boules, sol, but, this.terrain);
    this.journal = [];
    this.enVol = false;
    this.file = Promise.resolve();
    this.acceleration = 1;
    this.vue = null;
    this.attente = 0;
  }

  get etat() { return this.vue || this.moteur.etat; }
  get tour() { return this.moteur.tour; }
  get fini() { return this.moteur.fini; }
  get estMonTour() {
    return !this.enVol && !this.moteur.fini && !this.bloque && (this.local || this.moteur.tour === this.cote);
  }

  // Vrai si l'équipe est jouée par la personne qui tient l'appareil.
  estJoueurLocal(equipe) { return this.local || equipe === this.cote; }

  // Coup local (joueur ou bot). Refusé pendant un vol ou après la fin.
  jouer(angle, puissance) {
    if (this.enVol || this.moteur.fini) return false;
    if (this.reseau && this.moteur.tour !== this.cote) return false;
    const coup = {
      seq: this.journal.length,
      angle: normaliserAngle(angle),
      puissance: normaliserPuissance(puissance),
    };
    const local = this.moteur.tour === this.cote;
    this.executer(coup);
    if (local && this.reseau) this.reseau.envoyerCoup(coup);
    return true;
  }

  // Coup reçu du journal : seq strictement attendu, auteur de l'équipe au tour, sinon ignoré.
  recevoirCoup(coup) {
    if (coup.seq !== this.journal.length + this.attente) return false;
    this.executer({
      seq: coup.seq,
      auteur: coup.auteur,
      angle: normaliserAngle(coup.angle),
      puissance: normaliserPuissance(coup.puissance),
    }, true);
    return true;
  }

  executer(coup, distant = false) {
    this.attente++;
    this.file = this.file.then(async () => {
      this.attente--;
      if (coup.seq !== this.journal.length || this.moteur.fini) return;
      if (distant && this.moteur.tour === this.cote) return;
      if (distant && this.equipeAuteur && this.equipeAuteur(coup.auteur) !== this.moteur.tour) return;
      this.journal.push(coup);
      this.enVol = true;
      // Geste du lanceur avant le départ de la boule : purement visuel, la physique n'attend rien d'autre.
      await this.cb.avantLancer?.({ equipe: this.moteur.tour, coup });
      const boule = this.moteur.preparer(coup.angle, coup.puissance);
      this.cb.onCoup?.({ boule, equipe: this.moteur.dernier, coup });
      await this.boucler();
      await this.apresCoup();
      this.enVol = false;
      if (!this.moteur.fini) this.cb.onTour?.(this.moteur.tour);
    });
  }

  // Le rendu n'alimente jamais la physique : on rattrape le temps écoulé en pas fixes.
  async boucler() {
    const etat = this.moteur.etat;
    let precedent = performance.now();
    let reserve = 0;
    for (;;) {
      await attendreFrame();
      const maintenant = performance.now();
      reserve = Math.min(reserve + (maintenant - precedent) / 1000 * this.acceleration, PAS * 12);
      precedent = maintenant;
      while (reserve >= PAS) {
        reserve -= PAS;
        if (step(etat)) return;
      }
    }
  }

  async apresCoup() {
    const etatFinal = this.moteur.etat;
    const ev = this.moteur.resoudre();
    if (ev.type === 'tour') return;
    // On garde la dernière position affichée le temps de lire le résultat.
    this.vue = etatFinal;
    if (ev.type === 'annulee') {
      this.cb.onAnnulee?.();
      await pause(1600);
    } else {
      // Le score affiché vient du journal rejoué, pas de l'état mémoire.
      const verif = rejouer(this.graine, this.journal, this.boules, this.sol, this.but, this.terrain);
      ev.scores = verif.scores.slice();
      this.moteur.scores = verif.scores.slice();
      this.cb.onManche?.(ev);
      await pause(2200);
      if (ev.type === 'fin' || verif.fini) {
        this.moteur.fini = true;
        this.cb.onFin?.(ev.scores);
      }
    }
    this.vue = null;
  }

  // Resynchronisation : reconstruit l'état depuis le journal complet du serveur.
  resynchroniser(coups) {
    if (this.enVol) return false;
    const tries = coups.slice().sort((a, b) => a.seq - b.seq);
    const valides = [];
    const m = new Moteur(this.graine, this.boules, this.sol, this.but, this.terrain);
    for (const c of tries) {
      if (c.seq !== valides.length || m.fini) break;
      if (this.equipeAuteur && this.equipeAuteur(c.auteur) !== m.tour) break;
      const coup = { seq: c.seq, angle: normaliserAngle(c.angle), puissance: normaliserPuissance(c.puissance) };
      valides.push(coup);
      m.jouerInstantane(coup.angle, coup.puissance);
    }
    if (valides.length <= this.journal.length) return false;
    this.journal = valides;
    this.moteur = m;
    if (this.moteur.fini) this.cb.onFin?.(this.moteur.scores.slice());
    else this.cb.onTour?.(this.moteur.tour);
    return true;
  }
}
