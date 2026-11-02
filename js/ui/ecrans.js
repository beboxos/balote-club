// Navigation entre écrans et mise à jour des éléments DOM (HUD, salon, fin).
import { avatarSrc } from '../core/profil.js';

const $ = (id) => document.getElementById(id);

const ECRANS = ['menu', 'rejoindre', 'salon', 'jeu', 'fin'];
let courant = 'menu';

export function afficher(nom) {
  for (const n of ECRANS) {
    const el = $('ecran-' + n);
    if (n === nom) {
      el.hidden = false;
      // Laisse le navigateur appliquer l'état initial avant la transition.
      requestAnimationFrame(() => el.classList.add('est-actif'));
    } else if (!el.hidden) {
      el.classList.remove('est-actif');
      el.hidden = true;
    }
  }
  courant = nom;
  const focus = { rejoindre: 'saisie-code', jeu: 'terrain' }[nom];
  if (focus) requestAnimationFrame(() => $(focus).focus({ preventScroll: true }));
}

export function ecranCourant() { return courant; }

export { avatarSrc };

export function joueurs(noms, avatars) {
  for (const i of [0, 1]) {
    for (const p of ['hud', 'fin', 'salon']) {
      const nom = $(`${p}-nom-${i}`);
      const av = $(`${p}-avatar-${i}`);
      if (nom && noms[i]) nom.textContent = noms[i];
      if (av && avatars[i]) av.src = avatarSrc(avatars[i]);
    }
  }
}

export function hud({ scores, restantes, total, mene, tour, cote, enVol, texte }) {
  for (const i of [0, 1]) {
    $(`hud-score-${i}`).textContent = scores[i];
    $(`hud-boules-${i}`).textContent = '●'.repeat(restantes[i]) + '○'.repeat(total - restantes[i]);
    $(`hud-boules-${i}`).setAttribute('aria-label', `${restantes[i]} boule${restantes[i] > 1 ? 's' : ''} restante${restantes[i] > 1 ? 's' : ''}`);
    $(`hud-score-${i}`).closest('.chip').classList.toggle('est-au-tour', !enVol && tour === i);
  }
  $('hud-manche').textContent = `Mène ${mene}`;
  if (texte !== undefined) bandeau(texte, tour === cote && !enVol);
}

let dernierScore = '';
export function annoncerScore(noms, scores) {
  const t = `${noms[0]} ${scores[0]}, ${noms[1]} ${scores[1]}`;
  if (t !== dernierScore) {
    $('score-live').textContent = t;
    dernierScore = t;
  }
}

export function bandeau(texte, moi = false) {
  const b = $('bandeau');
  if (b.textContent !== texte) b.textContent = texte;
  b.classList.toggle('est-moi', moi);
}

export function fin({ victoire, scores, surtitre, detail, titre }) {
  $('titre-fin').textContent = titre ?? (victoire ? 'Victoire' : 'Défaite');
  $('fin-surtitre').textContent = surtitre || 'Fin de partie';
  $('fin-score-0').textContent = scores[0];
  $('fin-score-1').textContent = scores[1];
  $('fin-detail').textContent = detail || '';
}

export function salon({ code, statut, adversaire }) {
  if (code !== undefined) $('code-salon').textContent = code;
  if (statut !== undefined) $('statut-salon').textContent = statut;
  if (adversaire !== undefined) $('salon-avatar-1').classList.toggle('est-vide', !adversaire);
}
