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

  // Bruit blanc de 2 s, créé une fois : matière première de l'atterrissage et du roulement.
  bruit() {
    if (!this.tamponBruit) {
      const n = Math.floor(this.ctx.sampleRate * 2);
      const t = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = t.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.tamponBruit = t;
    }
    return this.tamponBruit;
  }

  // Une boule qui retombe : un « poum » sourd plus un craquement de grains selon le sol.
  atterrir(force, sol = 'terre', jack = false) {
    if (!this.actif || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const maintenant = c.currentTime;
    const v = Math.min(1, force / 260 + 0.15) * (jack ? 0.55 : 1);
    const profil = { lisse: [650, 0.09, 0.5], terre: [900, 0.12, 0.7], gravier: [2600, 0.2, 1] }[sol] || [900, 0.12, 0.7];
    const [coupure, duree, grain] = profil;

    const n = c.createBufferSource();
    n.buffer = this.bruit();
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = coupure;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, maintenant);
    g.gain.exponentialRampToValueAtTime(0.5 * v * grain, maintenant + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, maintenant + duree);
    n.connect(f).connect(g).connect(this.sortie);
    n.start(maintenant, Math.random(), duree + 0.05);

    const o = c.createOscillator();
    const go = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(jack ? 150 : 95, maintenant);
    o.frequency.exponentialRampToValueAtTime(45, maintenant + 0.12);
    go.gain.setValueAtTime(0.0001, maintenant);
    go.gain.exponentialRampToValueAtTime(0.55 * v, maintenant + 0.006);
    go.gain.exponentialRampToValueAtTime(0.0001, maintenant + 0.14);
    o.connect(go).connect(this.sortie);
    o.start(maintenant);
    o.stop(maintenant + 0.16);
  }

  // Roulement continu : un bruit filtré dont le volume suit la vitesse de la boule la plus rapide.
  // vitesse en unités/s (0 = silence). Appelé à chaque image par le rendu.
  rouler(vitesse, sol = 'terre') {
    if (!this.ctx) return;
    if (!this.roulement) {
      if (this.ctx.state !== 'running') return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.bruit();
      src.loop = true;
      const filtre = this.ctx.createBiquadFilter();
      filtre.type = 'bandpass';
      filtre.Q.value = 0.7;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filtre).connect(gain).connect(this.sortie);
      src.start();
      this.roulement = { filtre, gain };
    }
    const { filtre, gain } = this.roulement;
    const t = this.ctx.currentTime;
    const k = Math.min(1, vitesse / 320);
    const base = { lisse: 260, terre: 420, gravier: 1500 }[sol] || 420;
    const niveau = { lisse: 0.12, terre: 0.16, gravier: 0.24 }[sol] || 0.16;
    filtre.frequency.setTargetAtTime(base * (0.6 + k), t, 0.05);
    gain.gain.setTargetAtTime(this.actif && vitesse > 8 ? niveau * Math.sqrt(k) : 0, t, 0.06);
  }

  basculer() {
    this.actif = !this.actif;
    ecrire(STOCKAGE.son, this.actif ? '1' : '0');
    return this.actif;
  }
}

export const audio = new Audio();
