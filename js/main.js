import { AVATARS, STOCKAGE } from './config.js';
import { Partie, BOULES_DEFAUT, BOULES_CHOIX, BUT, BUTS_CHOIX } from './core/partie.js';
import { SOLS, SOL_DEFAUT, LONGUEURS, LONGUEUR_DEFAUT, CAILLOUX_DEFAUT } from './core/physique.js';
import { jouerBot, NIVEAUX } from './core/bot.js';
import { mulberry32 } from './core/rng.js';
import { Rendu } from './ui/rendu.js';
import { audio } from './ui/audio.js';
import { Musique, PISTES } from './ui/musique.js';
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
  boules: BOULES_CHOIX.includes(Number(lire(STOCKAGE.boules, ''))) ? Number(lire(STOCKAGE.boules, '')) : BOULES_DEFAUT,
  but: BUTS_CHOIX.includes(Number(lire(STOCKAGE.but, ''))) ? Number(lire(STOCKAGE.but, '')) : BUT,
  sol: SOLS[lire(STOCKAGE.sol, '')] ? lire(STOCKAGE.sol, '') : SOL_DEFAUT,
};
prefs.cailloux = Math.min(100, Math.max(0, Math.round(Number(lire(STOCKAGE.cailloux, CAILLOUX_DEFAUT)) / 10) * 10));
if (Number.isNaN(prefs.cailloux)) prefs.cailloux = CAILLOUX_DEFAUT;
prefs.longueur = LONGUEURS[lire(STOCKAGE.longueur, '')] ? lire(STOCKAGE.longueur, '') : LONGUEUR_DEFAUT;
prefs.musique = Math.min(100, Math.max(0, Math.round(Number(lire(STOCKAGE.musique, 40)) / 10) * 10));
if (Number.isNaN(prefs.musique)) prefs.musique = 40;
prefs.piste = PISTES.some((p) => p.id === lire(STOCKAGE.piste, '')) ? lire(STOCKAGE.piste, '') : 'auto';
const musique = new Musique(audio);
musique.volume = prefs.musique / 100;
musique.choisir(prefs.piste);
const IDS_SOLS = Object.keys(SOLS);
const IDS_LONGUEURS = Object.keys(LONGUEURS);

// Session courante : solo ou duel.
let session = null;

const rendu = new Rendu($('terrain'), {
  onTir: (angle, puissance) => session?.partie.jouer(angle, puissance),
  onChoc: (ch) => {
    const sol = session?.partie.moteur.sol.id;
    if (ch.atterri) audio.atterrir(ch.force, sol, ch.jack);
    else if (ch.caillou) audio.jouer('impact-jack', { volume: 0.3, vitesse: 1.7 + Math.random() * 0.3 });
    else {
      audio.jouer(ch.jack ? 'impact-jack' : 'impact-boule', {
        volume: Math.min(1, ch.force / 300 + 0.3),
        vitesse: 0.92 + Math.random() * 0.16,
      });
    }
  },
  onRoule: (v) => audio.rouler(v, session?.partie.moteur.sol.id),
  onVisee: (p) => audio.jouer('jauge', { volume: 0.35, vitesse: 0.8 + p * 0.6 }),
  onChute: () => audio.jouer('chute', { volume: 0.7 }),
});

function nomJoueur() { return prefs.pseudo.trim() || 'Vous'; }

// ---------- Partie : liaison règles ↔ interface ----------

function texteTour(s) {
  const p = s.partie;
  if (p.fini) return '';
  const jack = p.moteur.phase === 'cochonnet';
  if (s.local) return jack ? `${s.noms[p.tour]}, lancez le cochonnet` : `${s.noms[p.tour]}, à vous de jouer`;
  if (p.tour === p.cote) return jack ? 'Lancez le cochonnet' : 'À vous de jouer';
  if (jack) return `${s.noms[p.tour]} lance le cochonnet…`;
  return s.solo ? `${s.noms[p.tour]} vise…` : `${s.noms[p.tour]} joue…`;
}

function majHud(s, texte) {
  const p = s.partie;
  const m = p.moteur;
  ui.hud({
    scores: m.scores, restantes: [m.restantes(0), m.restantes(1)], total: m.boules,
    mene: m.mene, tour: m.tour, cote: s.local ? m.tour : p.cote, enVol: p.enVol,
    texte: texte ?? texteTour(s),
  });
  ui.annoncerScore(s.noms, m.scores);
}

function creerPartie(s, graine, cote, reseau) {
  const ligne = s.ligne;
  const equipeAuteur = ligne
    ? (uid) => (uid === ligne.hote ? 0 : uid === ligne.invite ? 1 : -1)
    : null;
  const partie = new Partie({
    graine, cote, reseau, equipeAuteur, boules: s.boules, sol: s.sol, but: s.but, cailloux: s.cailloux, longueur: s.longueur, local: !!s.local,
    avantLancer: ({ equipe, coup }) => rendu.lancerGeste(equipe, coup.puissance),
    onCoup: () => {
      audio.jouer('lancer', { volume: 0.8 });
      majHud(s, '');
    },
    onTour: (equipe) => {
      majHud(s);
      if (s.local) passerLeTelephone(s, equipe);
      else if (s.solo && equipe !== cote) jouerBot(partie, s.niveau, s.rng);
    },
    onAnnulee: () => majHud(s, 'Cochonnet sorti : on le relance'),
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
  const victoire = s.local || scores[s.partie.cote] > scores[1 - s.partie.cote] || abandon;
  audio.jouer(victoire ? 'victoire' : 'defaite');
  s.reseau?.cloturer(abandon ? 'abandon' : 'fin');
  ui.fin({
    victoire,
    scores,
    titre: s.local ? `${s.noms[scores[0] > scores[1] ? 0 : 1]} gagne` : undefined,
    surtitre: s.local ? 'Deux joueurs, un téléphone' : s.solo ? `Contre le club · ${NIVEAUX[s.niveau].nom}` : 'Duel à distance',
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
    boules: prefs.boules,
    sol: prefs.sol,
    but: prefs.but,
    cailloux: prefs.cailloux,
    longueur: prefs.longueur,
    rng: mulberry32(graine ^ 0x5eed),
    noms: [nomJoueur(), 'Le club'],
    avatars: [prefs.avatar, avatarBot],
  };
  creerPartie(s, graine, 0, null);
  lancerJeu(s);
}

// ---------- Deux joueurs sur un téléphone ----------

function demarrerLocal() {
  fermerSession();
  const graine = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
  const s = {
    solo: true,
    local: true,
    boules: prefs.boules,
    sol: prefs.sol,
    but: prefs.but,
    cailloux: prefs.cailloux,
    longueur: prefs.longueur,
    vu: 0,   // équipe qui tient le téléphone
    noms: [prefs.pseudo.trim() || 'Joueur 1', 'Joueur 2'],
    avatars: [prefs.avatar, prefs.avatar === '02' ? '03' : '02'],
  };
  creerPartie(s, graine, 0, null);
  lancerJeu(s);
}

// Quand le tour passe à l'autre joueur : écran « passez le téléphone », le jeu attend.
function passerLeTelephone(s, equipe) {
  const p = s.partie;
  if (equipe === s.vu || p.fini) return;
  const dlg = $('dialogue-passage');
  $('titre-passage').textContent = `Au tour de ${s.noms[equipe]}`;
  p.bloque = true;
  s.vu = equipe;
  majHud(s);
  dlg.addEventListener('close', () => {
    p.bloque = false;
    majHud(s);
  }, { once: true });
  dlg.showModal();
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
    onSignal: () => s.reconnexion?.resynchroniser(),
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
  if (s.partie || s.demarrage || session !== s) return;
  clearInterval(s.sondage);
  // L'identité de l'invité sert à vérifier l'auteur de chaque coup : on la relit au serveur.
  if (!s.ligne.invite) {
    s.demarrage = true;
    const l = await chargerPartie(s.ligne.code).catch(() => null);
    s.demarrage = false;
    if (!l?.invite || session !== s || s.partie) return;
    s.ligne = l;
  }
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
  son.addEventListener('click', () => { audio.basculer(); majSon(); musique.appliquerVolume(); });

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

  const segB = document.querySelectorAll('.segment [data-boules]');
  const majBoules = () => segB.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.boules) === prefs.boules)));
  majBoules();
  segB.forEach((b) => b.addEventListener('click', () => {
    prefs.boules = Number(b.dataset.boules);
    ecrire(STOCKAGE.boules, String(prefs.boules));
    majBoules();
  }));
  document.querySelector('.segment--boules').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = BOULES_CHOIX.indexOf(prefs.boules);
    prefs.boules = BOULES_CHOIX[(i + (e.key === 'ArrowRight' ? 1 : BOULES_CHOIX.length - 1)) % BOULES_CHOIX.length];
    ecrire(STOCKAGE.boules, String(prefs.boules));
    majBoules();
    segB[BOULES_CHOIX.indexOf(prefs.boules)].focus();
  });

  const segBut = document.querySelectorAll('.segment [data-but]');
  const majBut = () => segBut.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.but) === prefs.but)));
  majBut();
  segBut.forEach((b) => b.addEventListener('click', () => {
    prefs.but = Number(b.dataset.but);
    ecrire(STOCKAGE.but, String(prefs.but));
    majBut();
  }));
  document.querySelector('.segment--but').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    prefs.but = BUTS_CHOIX[(BUTS_CHOIX.indexOf(prefs.but) + 1) % BUTS_CHOIX.length];
    ecrire(STOCKAGE.but, String(prefs.but));
    majBut();
    segBut[BUTS_CHOIX.indexOf(prefs.but)].focus();
  });

  const segS = document.querySelectorAll('.segment [data-sol]');
  const majSol = () => segS.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sol === prefs.sol)));
  majSol();
  segS.forEach((b) => b.addEventListener('click', () => {
    prefs.sol = b.dataset.sol;
    ecrire(STOCKAGE.sol, prefs.sol);
    majSol();
  }));
  document.querySelector('.segment--sol').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = IDS_SOLS.indexOf(prefs.sol);
    prefs.sol = IDS_SOLS[(i + (e.key === 'ArrowRight' ? 1 : IDS_SOLS.length - 1)) % IDS_SOLS.length];
    ecrire(STOCKAGE.sol, prefs.sol);
    majSol();
    segS[IDS_SOLS.indexOf(prefs.sol)].focus();
  });

  const segL = document.querySelectorAll('.segment [data-longueur]');
  const majLongueur = () => segL.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.longueur === prefs.longueur)));
  majLongueur();
  segL.forEach((b) => b.addEventListener('click', () => {
    prefs.longueur = b.dataset.longueur;
    ecrire(STOCKAGE.longueur, prefs.longueur);
    majLongueur();
  }));
  document.querySelector('.segment--longueur').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = IDS_LONGUEURS.indexOf(prefs.longueur);
    prefs.longueur = IDS_LONGUEURS[(i + (e.key === 'ArrowRight' ? 1 : IDS_LONGUEURS.length - 1)) % IDS_LONGUEURS.length];
    ecrire(STOCKAGE.longueur, prefs.longueur);
    majLongueur();
    segL[IDS_LONGUEURS.indexOf(prefs.longueur)].focus();
  });

  const curseur = $('reglage-cailloux');
  curseur.value = String(prefs.cailloux);
  const majCailloux = () => { $('sortie-cailloux').textContent = `${prefs.cailloux} %`; };
  majCailloux();
  curseur.addEventListener('input', () => {
    prefs.cailloux = Number(curseur.value);
    ecrire(STOCKAGE.cailloux, String(prefs.cailloux));
    majCailloux();
  });

  const curseurMusique = $('reglage-musique');
  curseurMusique.value = String(prefs.musique);
  const majMusique = () => { $('sortie-musique').textContent = `${prefs.musique} %`; };
  majMusique();
  curseurMusique.addEventListener('input', () => {
    prefs.musique = Number(curseurMusique.value);
    ecrire(STOCKAGE.musique, String(prefs.musique));
    musique.volume = prefs.musique / 100;
    majMusique();
    musique.appliquerVolume();
    if (prefs.musique > 0) musique.demarrer();
  });
  const listePiste = $('reglage-piste');
  for (const [id, nom] of [['auto', 'Enchaînement automatique'], ...PISTES.map((p) => [p.id, p.nom])]) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = nom;
    listePiste.appendChild(o);
  }
  listePiste.value = prefs.piste;
  listePiste.addEventListener('change', () => {
    prefs.piste = listePiste.value;
    ecrire(STOCKAGE.piste, prefs.piste);
    musique.choisir(prefs.piste);
  });
  musique.surChangement = (p) => { $('piste-en-cours').textContent = `En cours : ${p.nom}`; };

  $('btn-reglages').addEventListener('click', () => $('dialogue-reglages').showModal());
  $('btn-fermer-reglages').addEventListener('click', () => $('dialogue-reglages').close());

  $('btn-solo').addEventListener('click', demarrerSolo);
  $('btn-local').addEventListener('click', demarrerLocal);
  $('btn-passage-pret').addEventListener('click', () => $('dialogue-passage').close());

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
    if (session?.local) demarrerLocal();
    else if (solo) demarrerSolo(); else creerDuel();
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
    // L'horloge audio démarre de façon asynchrone : on lance la musique dès qu'elle tourne.
    const attente = setInterval(() => {
      if (audio.ctx?.state === 'running') { clearInterval(attente); if (prefs.musique > 0) musique.demarrer(); }
    }, 100);
    setTimeout(() => clearInterval(attente), 5000);
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
  rendu.rafraichirDecor();
  $('chargement').classList.add('est-fini');
  poserAmbiance();
  const code = new URL(location.href).searchParams.get('p');
  if (code && /^[A-Za-z0-9]{5}$/.test(code) && enLigneDisponible()) reprendreDepuisUrl(code.toUpperCase());
}

// Accroche d'inspection pour les tests manuels (lecture seule de la session courante).
Object.defineProperty(window, 'BALOTE', { value: Object.freeze({ get session() { return session; }, get rendu() { return rendu; }, get musique() { return musique; } }) });

$('btn-reessayer').addEventListener('click', demarrer);
brancherInterface();
demarrer();
