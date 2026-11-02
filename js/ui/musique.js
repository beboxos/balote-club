// Musique d'ambiance : six pistes chill jouées par un petit séquenceur Web Audio, sans fichier audio.
// Chaque piste est une grille d'accords (4 mesures qui bouclent) ; pad, basse, comping, mélodie
// pentatonique et batterie légère en sont déduits. La mélodie est tirée d'une graine par passage :
// elle change à chaque tour sans jamais dépendre de Math.random.
//
// Planification « en avance » : un minuteur programme les notes un peu avant l'heure de l'horloge
// audio, le tempo reste donc exact même quand le thread principal est occupé.
import { mulberry32, deriver } from '../core/rng.js';

const AVANCE_S = 0.15;
const TICK_MS = 30;
const MESURES = 4;
const PAS_PAR_MESURE = 16;
const PASSAGES_PAR_PISTE = 10;   // en mode auto, une piste dure 10 passages de 4 mesures (≈ 2 min)

const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'D3' → numéro MIDI ; 'Bb2', 'F#3' acceptés.
function midi(nom) {
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(nom);
  return NOTES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
const liste = (s) => s.split(' ').map(midi);

// type : forme d'onde du comping ; comp : style ; batt : style de batterie.
export const PISTES = [
  {
    id: 'terrasse', vol: 1.09, nom: 'Terrasse', bpm: 78, swing: 0.2, comp: 'accords', batt: 'lofi',
    accords: ['D3 F3 A3 C4 E4', 'G2 F3 B3 E4', 'C3 E3 G3 B3 D4', 'A2 E3 G3 C4 E4'].map(liste),
    basses: liste('D2 G1 C2 A1'), gamme: liste('D4 F4 G4 A4 C5 D5'),
    ep: { type: 'triangle', gain: 0.1, filtre: 1800, vie: 0.55 }, pad: 0.035, melodie: 0.38, echo: 0.26,
  },
  {
    id: 'apres-midi', vol: 1.09, nom: 'Fin d’après-midi', bpm: 92, swing: 0.1, comp: 'pluck', batt: 'bossa',
    accords: ['F3 A3 C4 E4', 'E3 G3 D4', 'D3 F3 A3 C4', 'G3 B3 F4'].map(liste),
    basses: liste('F2 A1 D2 G1'), gamme: liste('F4 G4 A4 C5 D5 E5'),
    ep: { type: 'triangle', gain: 0.12, filtre: 2600, vie: 0.28 }, pad: 0.02, melodie: 0.3, echo: 0.2,
  },
  {
    id: 'cigales', vol: 0.79, nom: 'Cigales', bpm: 60, swing: 0, comp: 'arpege', batt: null,
    accords: ['A2 E3 G#3 C#4 E4', 'F#2 C#3 E3 A3 C#4', 'D3 A3 C#4 F#4', 'E3 B3 D4 G#4'].map(liste),
    basses: liste('A1 F#1 D2 E2'), gamme: liste('C#4 E4 F#4 G#4 B4 C#5'),
    ep: { type: 'sine', gain: 0.11, filtre: 2200, vie: 1.0 }, pad: 0.05, melodie: 0.25, echo: 0.4,
  },
  {
    id: 'ombre', vol: 1.13, nom: 'Sous les platanes', bpm: 84, swing: 0.16, comp: 'arpege', batt: 'lofi',
    accords: ['C3 E3 G3 B3', 'F3 A3 C4 E4', 'E3 G3 B3 D4', 'A2 E3 A3 C4'].map(liste),
    basses: liste('C2 F2 E2 A1'), gamme: liste('C4 D4 E4 G4 A4 C5'),
    ep: { type: 'triangle', gain: 0.09, filtre: 1600, vie: 0.7 }, pad: 0.03, melodie: 0.42, echo: 0.3,
  },
  {
    id: 'pastis', vol: 1.1, nom: 'Pastis', bpm: 100, swing: 0.08, comp: 'pluck', batt: 'bossa',
    accords: ['D3 F3 A3 C4', 'G2 F3 B3 D4', 'C3 E3 G3 B3', 'F3 A3 C4 E4'].map(liste),
    basses: liste('D2 G1 C2 F2'), gamme: liste('D4 E4 F4 A4 C5 D5'),
    ep: { type: 'square', gain: 0.045, filtre: 1500, vie: 0.22 }, pad: 0.02, melodie: 0.34, echo: 0.18,
  },
  {
    id: 'crepuscule', vol: 0.96, nom: 'Crépuscule', bpm: 70, swing: 0.12, comp: 'accords', batt: 'lofi',
    accords: ['G2 D3 F3 Bb3 D4', 'Eb3 G3 Bb3 D4', 'Bb2 F3 A3 D4', 'F3 A3 C4 E4'].map(liste),
    basses: liste('G1 Eb2 Bb1 F2'), gamme: liste('G4 Bb4 C5 D5 F5 G5'),
    ep: { type: 'sine', gain: 0.12, filtre: 1500, vie: 0.8 }, pad: 0.045, melodie: 0.33, echo: 0.34,
  },
];

export const PISTES_PAR_ID = Object.fromEntries(PISTES.map((p) => [p.id, p]));

function graineTexte(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export class Musique {
  constructor(audio) {
    this.audio = audio;
    this.volume = 0.4;           // 0..1, réglage du joueur
    this.choix = 'auto';         // 'auto' ou id de piste
    this.minuteur = null;
    this.piste = null;
    this.pas = 0;
    this.passage = 0;
    this.prochain = 0;
    this.melodie = [];
    this.surChangement = null;   // (piste) => void, pour afficher le titre en cours
  }

  get ctx() { return this.audio.ctx; }

  preparerSortie() {
    const c = this.ctx;
    if (this.maitre) return;
    this.maitre = c.createGain();
    this.maitre.gain.value = 0;
    this.maitre.connect(c.destination);
    const entree = c.createGain();
    const delai = c.createDelay(1);
    const retour = c.createGain();
    const humide = c.createGain();
    retour.gain.value = 0.35;
    entree.connect(delai);
    delai.connect(retour);
    retour.connect(delai);
    delai.connect(humide);
    humide.connect(this.maitre);
    this.echo = { entree, delai, retour, humide };
  }

  // Volume effectif : réglage du joueur, coupé quand le son est coupé.
  appliquerVolume() {
    if (!this.maitre) return;
    // vol : égalise le niveau perçu entre pistes (RMS mesuré dans Chrome, ≈ 0,035 à 100 %).
    const v = this.audio.actif ? this.volume * 0.8 * (this.piste?.vol ?? 1) : 0;
    this.maitre.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
  }

  demarrer() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this.preparerSortie();
    this.appliquerVolume();
    if (this.minuteur) return;
    this.changerPiste(this.choix);
    this.prochain = c.currentTime + 0.12;
    this.minuteur = setInterval(() => this.tick(), TICK_MS);
  }

  arreter() {
    clearInterval(this.minuteur);
    this.minuteur = null;
    this.maitre?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  // Choix du joueur : une piste précise ou 'auto' (enchaîne les six).
  choisir(id) {
    this.choix = id === 'auto' || PISTES_PAR_ID[id] ? id : 'auto';
    if (this.choix !== 'auto' && this.piste?.id !== this.choix) this.changerPiste(this.choix);
  }

  changerPiste(id) {
    let piste = PISTES_PAR_ID[id];
    if (!piste) {
      const i = this.piste ? PISTES.indexOf(this.piste) : Math.floor(Math.random() * PISTES.length) - 1;
      piste = PISTES[(i + 1 + PISTES.length) % PISTES.length];
    }
    this.piste = piste;
    // Écho en croche pointée du tempo de la piste.
    if (this.echo) this.echo.delai.delayTime.setValueAtTime(Math.min(0.95, (60 / piste.bpm) * 0.75), this.ctx.currentTime);
    this.appliquerVolume();
    this.pas = 0;
    this.passage = 0;
    this.melodie = [];
    this.surChangement?.(piste);
  }

  tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    // Après une longue suspension de l'onglet, on repart à l'heure courante plutôt que de rattraper.
    if (this.prochain < c.currentTime - 0.5) this.prochain = c.currentTime + 0.05;
    while (this.prochain < c.currentTime + AVANCE_S) {
      this.jouerPas(this.pas, this.prochain);
      this.pas++;
      const total = MESURES * PAS_PAR_MESURE;
      if (this.pas >= total) {
        this.pas = 0;
        this.passage++;
        if (this.choix === 'auto' && this.passage >= PASSAGES_PAR_PISTE) this.changerPiste();
      }
      const p = this.piste;
      this.prochain += 60 / p.bpm / 4;
    }
  }

  // Mélodie de la mesure : marche aléatoire sur la gamme pentatonique, graine = piste + passage + mesure.
  composerMelodie(mesure) {
    const p = this.piste;
    const rng = mulberry32(deriver(graineTexte(p.id), this.passage * 8 + mesure));
    const notes = [];
    let idx = 2 + Math.floor(rng() * 3);
    let pas = rng() < 0.5 ? 2 : 4;
    while (pas < 14) {
      if (rng() < p.melodie * 1.6) {
        idx = Math.max(0, Math.min(p.gamme.length - 1, idx + Math.floor(rng() * 5) - 2));
        const longueur = 2 + Math.floor(rng() * 3) * 2;
        notes.push([pas, p.gamme[idx], longueur]);
        pas += longueur;
      } else {
        pas += 2;
      }
      if (rng() < 0.18) pas += 2;
    }
    return notes;
  }

  jouerPas(pas, t) {
    const p = this.piste;
    const c = this.ctx;
    const dureePas = 60 / p.bpm / 4;
    const mesure = Math.floor(pas / PAS_PAR_MESURE);
    const s = pas % PAS_PAR_MESURE;
    const accord = p.accords[mesure];
    const swing = s % 2 === 1 ? p.swing * dureePas : 0;
    const quand = t + swing;

    if (s === 0) {
      // Pad (accord tenu), basse sur le premier temps, nouvelle mélodie pour la mesure.
      if (p.pad) for (const n of accord) this.voix(c, quand, n, dureePas * 15, { type: 'sine', gain: p.pad, attaque: 0.5, filtre: 1100, desaccord: 7, envoi: 0.3 });
      this.melodie = this.composerMelodie(mesure);
    }
    // Basse
    if (s === 0 || (p.batt === 'bossa' ? s === 6 || s === 8 || s === 14 : s === 10)) {
      this.voix(c, quand, p.basses[mesure], dureePas * (s === 0 ? 5 : 3), { type: 'sine', gain: 0.22, filtre: 400 });
    }
    // Comping
    const lisse = (notes, vel = 1) => notes.forEach((n) => this.voix(c, quand, n, dureePas * 6 * p.ep.vie, { ...p.ep, gain: p.ep.gain * vel, envoi: 0.35 }));
    if (p.comp === 'accords' && (s === 0 || s === 6 || s === 10)) lisse(accord.slice(1), s === 0 ? 1 : 0.7);
    if (p.comp === 'arpege' && s % 2 === 0) {
      const ordre = [0, 1, 2, 3, 2, 1, 3, 2];
      lisse([accord[ordre[(s / 2) % 8] % accord.length]], 0.9);
    }
    if (p.comp === 'pluck' && (s === 0 || s === 3 || s === 6 || s === 10 || s === 12)) lisse(accord.slice(1, 4), s === 0 ? 1 : 0.75);
    // Mélodie
    for (const [ps, n, l] of this.melodie) {
      if (ps === s) this.voix(c, quand, n, dureePas * l * 1.1, { type: 'triangle', gain: 0.07, filtre: 2800, attaque: 0.012, envoi: 0.55, vibrato: l >= 4 });
    }
    // Batterie
    this.batterie(c, quand, s, p);
  }

  batterie(c, t, s, p) {
    if (!p.batt) return;
    if (p.batt === 'lofi') {
      if (s === 0 || s === 7 || s === 10) this.kick(c, t, s === 0 ? 1 : 0.7);
      if (s === 8) this.caisse(c, t, 0.9);
      if (s % 2 === 0) this.hat(c, t, s % 4 === 0 ? 0.6 : 0.35);
    } else {
      if (s === 0 || s === 8) this.kick(c, t, 0.6);
      if (s === 0 || s === 3 || s === 6 || s === 10 || s === 12) this.caisse(c, t, 0.45, 2600);
      if (s % 4 === 2) this.hat(c, t, 0.3);
    }
  }

  tamponBruit() {
    if (!this.bruit) {
      const c = this.ctx;
      this.bruit = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.bruit.getChannelData(0);
      let reg = 0x1234567;
      for (let i = 0; i < d.length; i++) {   // bruit déterministe (xorshift)
        reg ^= reg << 13; reg ^= reg >>> 17; reg ^= reg << 5;
        d[i] = ((reg >>> 0) / 4294967295) * 2 - 1;
      }
    }
    return this.bruit;
  }

  kick(c, t, v) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.maitre);
    o.start(t);
    o.stop(t + 0.2);
  }

  caisse(c, t, v, fc = 1500) {
    const n = c.createBufferSource();
    n.buffer = this.tamponBruit();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = fc;
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f).connect(g).connect(this.maitre);
    n.start(t);
    n.stop(t + 0.14);
  }

  hat(c, t, v) {
    const n = c.createBufferSource();
    n.buffer = this.tamponBruit();
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(g).connect(this.maitre);
    n.start(t);
    n.stop(t + 0.07);
  }

  // Une note : oscillateur (ou deux désaccordés) + enveloppe douce + filtre ; envoi = part vers l'écho.
  voix(c, t, note, duree, v) {
    const g = c.createGain();
    const crete = v.gain;
    const att = v.attaque ?? 0.008;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(crete, t + att);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0005, crete * 0.35), t + duree * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0003, t + duree);
    let sortie = g;
    if (v.filtre) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(v.filtre, t);
      f.connect(g);
      sortie = f;
    }
    const oscs = [0];
    if (v.desaccord) oscs.push(v.desaccord, -v.desaccord);
    for (const dec of oscs) {
      const o = c.createOscillator();
      o.type = v.type;
      o.frequency.setValueAtTime(hz(note), t);
      if (dec) o.detune.setValueAtTime(dec, t);
      if (v.vibrato) {
        const lfo = c.createOscillator();
        const prof = c.createGain();
        lfo.frequency.setValueAtTime(5, t);
        prof.gain.setValueAtTime(0, t);
        prof.gain.linearRampToValueAtTime(10, t + Math.min(0.3, duree * 0.5));
        lfo.connect(prof).connect(o.detune);
        lfo.start(t);
        lfo.stop(t + duree + 0.05);
      }
      o.connect(sortie);
      o.start(t);
      o.stop(t + duree + 0.05);
    }
    g.connect(this.maitre);
    if (v.envoi && this.echo) {
      const e = c.createGain();
      e.gain.value = v.envoi * (this.piste.echo / 0.3);
      g.connect(e).connect(this.echo.entree);
    }
  }
}
