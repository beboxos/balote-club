import { STOCKAGE } from '../config.js';

const SONS = ['impact-boule', 'impact-jack', 'lancer', 'chute', 'ui-valide', 'victoire', 'defaite', 'jauge'];

function lire(cle) { try { return localStorage.getItem(cle); } catch { return null; } }
function ecrire(cle, v) { try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ } }

// WebAudio : contexte créé au premier geste, sons décodés une fois, lecture silencieuse
// si l'audio est bloqué ou indisponible (le jeu reste jouable).
class Audio {
  constructor() {
    this.ctx = null;
    this.tampons = new Map();
    this.actif = lire(STOCKAGE.son) !== '0';
    this.chargement = null;
    this.ext = 'mp3';
    try {
      const a = document.createElement('audio');
      if (a.canPlayType('audio/ogg; codecs="vorbis"')) this.ext = 'ogg';
    } catch { /* garde mp3 */ }
  }

  // À appeler depuis un gestionnaire de geste utilisateur.
  deverrouiller() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.sortie = this.ctx.createGain();
        this.sortie.gain.value = 0.9;
        this.sortie.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.chargement) this.chargement = this.precharger();
    } catch { this.ctx = null; }
  }

  async precharger() {
    await Promise.all(SONS.map(async (nom) => {
      try {
        const r = await fetch(`assets/audio/${nom}.${this.ext}`);
        if (!r.ok) return;
        const buf = await r.arrayBuffer();
        const t = await new Promise((ok, ko) => this.ctx.decodeAudioData(buf, ok, ko));
        this.tampons.set(nom, t);
      } catch { /* son absent : on reste muet pour celui-ci */ }
    }));
  }

  jouer(nom, { volume = 1, vitesse = 1 } = {}) {
    if (!this.actif || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.tampons.get(nom);
    if (!t) return;
    const src = this.ctx.createBufferSource();
    src.buffer = t;
    src.playbackRate.value = vitesse;
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g).connect(this.sortie);
    src.start();
  }

  basculer() {
    this.actif = !this.actif;
    ecrire(STOCKAGE.son, this.actif ? '1' : '0');
    return this.actif;
  }
}

export const audio = new Audio();
