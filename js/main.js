import { AVATARS, STOCKAGE } from './config.js';
import { Partie, BOULES } from './core/partie.js';
import { jouerBot, NIVEAUX } from './core/bot.js';
import { mulberry32 } from './core/rng.js';
import { Rendu } from './ui/rendu.js';
import { audio } from './ui/audio.js';
import * as ui from './ui/ecrans.js';
import { charger, poserAmbiance } from './assets/chargeur.js';
import {
  enLigneDisponible, connexion, creerSalon, rejoindre, chargerPartie, chargerCoups, Reseau,
} from './net/reseau.js';
import { Reconnexion } from './net/reconnexion.js';

const $ = (id) => document.getElementById(id);

function lire(cle, defaut) { try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; } }
function ecrire(cle, v) { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } }

const prefs = {
  pseudo: lire(STOCKAGE.pseudo, ''),
  avatar: AVATARS.includes(lire(STOCKAGE.avatar, '01')) ? lire(STOCKAGE.avatar, '01') : '01',
  niveau: Math.min(2, Math.max(0, Number(lire(STOCKAGE.niveau, '1')) || 0)),
};

// Session courante : solo ou duel.
let session = null;

const rendu = new Rendu($('terrain'), {
  onTir: (angle, puissance) => session?.partie.jouer(angle, puissance),
  onChoc: (ch) => audio.jouer(ch.jack ? 'impact-jack' : 'impact-boule', {
    volume: Math.min(1, ch.force / 500 + 0.15),
    vitesse: 0.92 + Math.random() * 0.16,
  }),
  onVisee: (p) => audio.jouer('jauge', { volume: 0.35, vitesse: 0.8 + p * 0.6 }),
  onChute: () => audio.jouer('chute', { volume: 0.7 }),
});

function nomJoueur() { return prefs.pseudo.trim() || 'Vous'; }

// ---------- Partie : liaison règles ↔ interface ----------

function texteTour(s) {
  const p = s.partie;
  if (p.fini) return '';
  if (p.tour === p.cote) return 'À vous de jouer';
  return s.solo ? `${s.noms[p.tour]} vise…` : `${s.noms[p.tour]} joue…`;
}

function majHud(s, texte) {
  const p = s.partie;
  const m = p.moteur;
  ui.hud({
    scores: m.scores, restantes: [BOULES - m.jouees[0], BOULES - m.jouees[1]],
    mene: m.mene, tour: m.tour, cote: p.cote, enVol: p.enVol,
    texte: texte ?? texteTour(s),
  });
  ui.annoncerScore(s.noms, m.scores);
}

function creerPartie(s, graine, cote, reseau) {
  const partie = new Partie({
    graine, cote, reseau,
    onCoup: () => {
      audio.jouer('lancer', { volume: 0.8 });
      majHud(s, '');
    },
    onTour: (equipe) => {
      majHud(s);
      if (s.solo && equipe !== cote) jouerBot(partie, s.niveau, s.rng);
    },
    onAnnulee: () => majHud(s, 'Cochonnet sorti : mène rejouée'),
    onManche: (ev) => {
      const texte = ev.gagnant < 0
        ? 'Mène nulle'
        : `${s.noms[ev.gagnant]} marque ${ev.points} point${ev.points > 1 ? 's' : ''}`;
      majHud(s, texte);
    },
    onFin: (scores) => terminer(s, scores),
  });
  s.partie = partie;
  rendu.attacher(partie);
  return partie;
}

function lancerJeu(s) {
  session = s;
  ui.joueurs(s.noms, s.avatars);
  ui.afficher('jeu');
  rendu.demarrer();
  majHud(s);
}

function terminer(s, scores, { abandon = false } = {}) {
  if (s.termine) return;
  s.termine = true;
  const victoire = scores[s.partie.cote] > scores[1 - s.partie.cote] || abandon;
  audio.jouer(victoire ? 'victoire' : 'defaite');
  s.reseau?.cloturer(abandon ? 'abandon' : 'fin');
  ui.fin({
    victoire,
    scores,
    surtitre: s.solo ? `Contre le club · ${NIVEAUX[s.niveau].nom}` : 'Duel à distance',
    detail: abandon ? `${s.noms[1 - s.partie.cote]} a quitté la partie.` : `En ${s.partie.moteur.mene} mène${s.partie.moteur.mene > 1 ? 's' : ''}.`,
  });
  setTimeout(() => {
    if (session !== s) return;
    rendu.arreter();
    ui.afficher('fin');
  }, abandon ? 300 : 900);
}

function fermerSession() {
  const s = session;
  session = null;
  rendu.arreter();
  rendu.attacher(null);
  if (!s) return;
  s.termine = true;
  s.reconnexion?.detacher();
  clearInterval(s.sondage);
  s.reseau?.quitter();
  majUrl(null);
}

// ---------- Solo ----------

function demarrerSolo() {
  fermerSession();
  const graine = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
  const avatarBot = prefs.avatar === '02' ? '03' : '02';
  const s = {
    solo: true,
    niveau: prefs.niveau,
    rng: mulberry32(graine ^ 0x5eed),
    noms: [nomJoueur(), 'Le club'],
    avatars: [prefs.avatar, avatarBot],
  };
  creerPartie(s, graine, 0, null);
  lancerJeu(s);
}

// ---------- Duel ----------

function majUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('p', code); else url.searchParams.delete('p');
  history.replaceState(null, '', url);
}

function profil(cote) { return { pseudo: nomJoueur(), avatar: prefs.avatar, cote }; }

function appliquerProfil(s, p) {
  if (!p || (p.cote !== 0 && p.cote !== 1) || p.cote === s.cote) return;
  s.noms[p.cote] = String(p.pseudo || 'Adversaire').slice(0, 14);
  s.avatars[p.cote] = AVATARS.includes(p.avatar) ? p.avatar : '01';
  ui.joueurs(s.noms, s.avatars);
}

async function ouvrirDuel(ligne, uid) {
  const cote = ligne.hote === uid ? 0 : 1;
  const s = {
    solo: false,
    ligne,
    cote,
    noms: cote === 0 ? [nomJoueur(), 'Adversaire'] : ['Adversaire', nomJoueur()],
    avatars: cote === 0 ? [prefs.avatar, '01'] : ['01', prefs.avatar],
  };
  s.reseau = new Reseau(ligne, uid, {
    onCoup: (c) => s.partie?.recevoirCoup(c),
    onAbandon: () => { if (s.partie && !s.termine) terminer(s, s.partie.moteur.scores, { abandon: true }); },
    onProfil: (p) => appliquerProfil(s, p),
    onArrivee: (p) => {
      appliquerProfil(s, p);
      s.reseau.envoyerProfil(profil(cote));
      if (!s.partie) commencerDuel(s);
    },
    onEtat: (statut) => {
      if (statut === 'SUBSCRIBED') {
        s.reseau.envoyerProfil(profil(cote));
      } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(statut)) {
        s.reconnexion?.signalerPanne();
      }
    },
  });
  session = s;
  await s.reseau.ouvrir();
  majUrl(ligne.code);
  return s;
}

async function commencerDuel(s) {
  if (s.partie || session !== s) return;
  clearInterval(s.sondage);
  const partie = creerPartie(s, Number(s.ligne.seed), s.cote, s.reseau);
  s.reconnexion = new Reconnexion(s.reseau, partie, {
    onStatut: (st) => {
      if (st === 'hors-ligne') ui.bandeau('Connexion perdue, reprise…');
      else if (st === 'ok' && !partie.enVol && !partie.fini) majHud(s);
    },
  });
  s.reconnexion.brancher();
  lancerJeu(s);
  // Reprise : le journal serveur fait foi (rechargement de l'onglet en pleine partie).
  try {
    const coups = await chargerCoups(s.ligne.id, 0);
    if (coups.length) partie.resynchroniser(coups);
    majHud(s);
  } catch {
    s.reconnexion.signalerPanne();
  }
}

async function creerDuel() {
  fermerSession();
  ui.salon({ code: '-----', statut: 'Ouverture du salon…', adversaire: false });
  $('salon-nom-1').textContent = 'En attente';
  ui.afficher('salon');
  try {
    const uid = await connexion();
    const ligne = await creerSalon();
    const s = await ouvrirDuel(ligne, uid);
    ui.joueurs(s.noms, s.avatars);
    $('salon-nom-1').textContent = 'En attente';
    ui.salon({ code: ligne.code, statut: 'Partagez le code. En attente d\'un adversaire…' });
    // Filet de sécurité si le broadcast d'arrivée est manqué.
    s.sondage = setInterval(async () => {
      try {
        const l = await chargerPartie(ligne.code);
        if (l?.invite && session === s) { s.ligne = l; commencerDuel(s); }
      } catch { /* on réessaie au prochain tour */ }
    }, 3000);
  } catch (e) {
    ui.salon({ statut: messageErreur(e) });
  }
}

async function rejoindreDuel(code) {
  const err = $('erreur-code');
  err.textContent = '';
  try {
    const uid = await connexion();
    const ligne = await rejoindre(code);
    fermerSession();
    const s = await ouvrirDuel(ligne, uid);
    s.reseau.annoncerArrivee(profil(s.cote));
    commencerDuel(s);
  } catch (e) {
    err.textContent = messageErreur(e);
    ui.afficher('rejoindre');
  }
}

// Reprise d'une partie depuis l'URL (?p=CODE) après rechargement ou lien partagé.
async function reprendreDepuisUrl(code) {
  try {
    const uid = await connexion();
    let ligne = await chargerPartie(code);
    if (ligne && (ligne.hote === uid || ligne.invite === uid)) {
      if (ligne.statut === 'fin' || ligne.statut === 'abandon') { majUrl(null); return; }
      const s = await ouvrirDuel(ligne, uid);
      if (ligne.invite) { commencerDuel(s); return; }
      ui.joueurs(s.noms, s.avatars);
      ui.salon({ code: ligne.code, statut: 'En attente d\'un adversaire…', adversaire: false });
      ui.afficher('salon');
      s.sondage = setInterval(async () => {
        const l = await chargerPartie(code).catch(() => null);
        if (l?.invite && session === s) { s.ligne = l; commencerDuel(s); }
      }, 3000);
      return;
    }
    $('saisie-code').value = code;
    ui.afficher('rejoindre');
    await rejoindreDuel(code);
  } catch (e) {
    majUrl(null);
    $('saisie-code').value = code;
    $('erreur-code').textContent = messageErreur(e);
    ui.afficher('rejoindre');
  }
}

function messageErreur(e) {
  const m = String(e?.message || e || '');
  if (/plein/i.test(m)) return 'Ce salon est déjà complet.';
  if (/termin/i.test(m)) return 'Cette partie est terminée.';
  if (/inexistant|introuvable/i.test(m)) return 'Aucun salon avec ce code.';
  if (/propre|auto/i.test(m)) return 'Vous êtes déjà l\'hôte de ce salon.';
  if (/anonymous|anonyme/i.test(m)) return 'Connexion anonyme désactivée côté serveur.';
  return 'Réseau indisponible. Réessayez.';
}

// ---------- Interface ----------

function brancherInterface() {
  const pseudo = $('pseudo');
  pseudo.value = prefs.pseudo;
  pseudo.addEventListener('change', () => {
    prefs.pseudo = pseudo.value.trim().slice(0, 14);
    ecrire(STOCKAGE.pseudo, prefs.pseudo);
  });

  $('avatar-moi').src = ui.avatarSrc(prefs.avatar);
  const grille = $('grille-avatars');
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Portrait ${Number(a)}`);
    b.setAttribute('aria-pressed', String(a === prefs.avatar));
    b.innerHTML = `<img src="${ui.avatarSrc(a)}" width="96" height="96" alt="">`;
    b.addEventListener('click', () => {
      prefs.avatar = a;
      ecrire(STOCKAGE.avatar, a);
      $('avatar-moi').src = ui.avatarSrc(a);
      for (const x of grille.children) x.setAttribute('aria-pressed', String(x === b));
      audio.jouer('ui-valide', { volume: 0.5 });
      $('dialogue-avatar').close();
    });
    grille.appendChild(b);
  }
  $('btn-avatar').addEventListener('click', () => $('dialogue-avatar').showModal());
  $('btn-fermer-avatar').addEventListener('click', () => $('dialogue-avatar').close());

  const son = $('btn-son');
  const majSon = () => {
    son.setAttribute('aria-pressed', String(audio.actif));
    son.setAttribute('aria-label', audio.actif ? 'Son activé' : 'Son coupé');
  };
  majSon();
  son.addEventListener('click', () => { audio.basculer(); majSon(); });

  const seg = document.querySelectorAll('.segment [data-niveau]');
  const majNiveau = () => seg.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.niveau) === prefs.niveau)));
  majNiveau();
  seg.forEach((b) => b.addEventListener('click', () => {
    prefs.niveau = Number(b.dataset.niveau);
    ecrire(STOCKAGE.niveau, String(prefs.niveau));
    majNiveau();
  }));
  // Flèches dans le groupe radio
  document.querySelector('.segment').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    prefs.niveau = (prefs.niveau + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
    ecrire(STOCKAGE.niveau, String(prefs.niveau));
    majNiveau();
    seg[prefs.niveau].focus();
  });

  $('btn-solo').addEventListener('click', demarrerSolo);

  const enLigne = enLigneDisponible();
  for (const id of ['btn-creer', 'btn-rejoindre']) {
    $(id).disabled = !enLigne;
    if (!enLigne) $(id).title = 'Duel indisponible : Supabase non configuré';
  }
  $('btn-creer').addEventListener('click', creerDuel);
  $('btn-rejoindre').addEventListener('click', () => {
    $('erreur-code').textContent = '';
    ui.afficher('rejoindre');
  });
  $('form-code').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('saisie-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      $('erreur-code').textContent = 'Le code fait 5 caractères.';
      return;
    }
    rejoindreDuel(code);
  });
  $('saisie-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('btn-copier').addEventListener('click', async () => {
    const code = $('code-salon').textContent;
    const url = new URL(location.href);
    url.searchParams.set('p', code);
    try {
      if (navigator.share) await navigator.share({ title: 'Balote Club', text: `Duel de pétanque, code ${code}`, url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        ui.salon({ statut: 'Lien copié.' });
      }
    } catch { /* partage annulé */ }
  });
  $('btn-annuler-salon').addEventListener('click', () => {
    session?.reseau?.cloturer('abandon');
    fermerSession();
    ui.afficher('menu');
  });

  document.querySelectorAll('[data-retour]').forEach((b) => b.addEventListener('click', () => {
    fermerSession();
    ui.afficher('menu');
  }));

  $('btn-rejouer').addEventListener('click', () => {
    const solo = !session || session.solo;
    if (solo) demarrerSolo(); else creerDuel();
  });

  $('btn-quitter').addEventListener('click', () => {
    $('quitter-detail').textContent = session?.solo
      ? 'La partie en cours sera perdue.'
      : 'Quitter compte comme un abandon.';
    $('dialogue-quitter').showModal();
  });
  $('btn-quitter-non').addEventListener('click', () => $('dialogue-quitter').close());
  $('btn-quitter-oui').addEventListener('click', async () => {
    $('dialogue-quitter').close();
    const s = session;
    if (s && !s.solo && !s.termine) await s.reseau.abandonner();
    fermerSession();
    ui.afficher('menu');
  });

  // Audio : contexte démarré au premier geste.
  const premierGeste = () => {
    audio.deverrouiller();
    window.removeEventListener('pointerdown', premierGeste, true);
    window.removeEventListener('keydown', premierGeste, true);
  };
  window.addEventListener('pointerdown', premierGeste, true);
  window.addEventListener('keydown', premierGeste, true);
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn')) audio.jouer('ui-valide', { volume: 0.45 });
  });
}

// ---------- Démarrage ----------

async function demarrer() {
  const jauge = $('jauge-remplie');
  const txt = $('chargement-txt');
  const reessayer = $('btn-reessayer');
  reessayer.hidden = true;
  txt.textContent = 'Chargement…';
  try {
    await charger((p) => { jauge.style.width = Math.round(p * 100) + '%'; });
  } catch {
    txt.textContent = 'Le chargement a échoué.';
    reessayer.hidden = false;
    reessayer.focus();
    return;
  }
  $('chargement').classList.add('est-fini');
  poserAmbiance();
  const code = new URL(location.href).searchParams.get('p');
  if (code && /^[A-Za-z0-9]{5}$/.test(code) && enLigneDisponible()) reprendreDepuisUrl(code.toUpperCase());
}

// Accroche d'inspection pour les tests manuels (lecture seule de la session courante).
Object.defineProperty(window, 'BALOTE', { value: Object.freeze({ get session() { return session; } }) });

$('btn-reessayer').addEventListener('click', demarrer);
brancherInterface();
demarrer();
