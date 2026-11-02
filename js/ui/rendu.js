import { TERRAIN, LANCER, RAYON, sinCos, distance } from '../core/physique.js';
import { meilleures } from '../core/partie.js';
import {
  dessinerTerrain, dessinerOmbre, dessinerBoule, dessinerCochonnet,
  dessinerViseur, Effets, viderCaches,
} from './matieres.js';

const DRAG_MAX = 150;     // unités logiques pour la puissance pleine
const PUISSANCE_MIN = 0.04;
const ANGLE_DEFAUT = 27000;
const reduit = window.matchMedia('(prefers-reduced-motion: reduce)');

function vibrer(ms) {
  try { navigator.vibrate?.(ms); } catch { /* API absente ou bloquée */ }
}

export class Rendu {
  constructor(canvas, { onTir, onChoc, onVisee, onChute } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTir = onTir;
    this.onChoc = onChoc;
    this.onVisee = onVisee;
    this.onChute = onChute;
    this.vivants = 0;
    this.partie = null;
    this.effets = new Effets();
    this.couche = document.createElement('canvas');
    this.visee = null;           // { cd, p } pendant le geste ou au clavier
    this.drag = null;
    this.etatVu = null;
    this.actif = false;
    this.dernierT = 0;
    this.mesurer();
    this.ecouter();
    this.boucle = this.boucle.bind(this);
  }

  attacher(partie) {
    this.partie = partie;
    this.visee = null;
    this.drag = null;
    this.effets.vider();
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this.mesurer();
    this.dernierT = performance.now();
    requestAnimationFrame(this.boucle);
  }

  arreter() { this.actif = false; }

  // Mesure unique par redimensionnement : pas de lecture de layout dans la boucle.
  mesurer() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const l = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (l === this.canvas.width && h === this.canvas.height && this.echelle) return;
    this.canvas.width = l;
    this.canvas.height = h;
    this.dpr = dpr;
    this.rect = rect;
    // Échelle « cover » centrée
    this.echelle = Math.max(l / TERRAIN.l, h / TERRAIN.h);
    this.ox = (l - TERRAIN.l * this.echelle) / 2;
    this.oy = (h - TERRAIN.h * this.echelle) / 2;
    viderCaches();
    this.couche.width = l;
    this.couche.height = h;
    const c = this.couche.getContext('2d');
    c.setTransform(this.echelle, 0, 0, this.echelle, this.ox, this.oy);
    dessinerTerrain(c, TERRAIN.l, TERRAIN.h, TERRAIN.marge);
  }

  versLogique(clientX, clientY) {
    const x = (clientX - this.rect.left) * this.dpr;
    const y = (clientY - this.rect.top) * this.dpr;
    return { x: (x - this.ox) / this.echelle, y: (y - this.oy) / this.echelle };
  }

  peutViser() {
    return !!this.partie && this.partie.estMonTour && !this.partie.vue;
  }

  ecouter() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (!this.peutViser() || this.drag) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, depart: this.versLogique(e.clientX, e.clientY) };
      this.visee = null;
      vibrer(8);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const p = this.versLogique(e.clientX, e.clientY);
      const dx = this.drag.depart.x - p.x;
      const dy = this.drag.depart.y - p.y;
      const long = Math.sqrt(dx * dx + dy * dy);
      if (long < 4) { this.visee = null; return; }
      const cd = Math.round((Math.atan2(dy, dx) * 18000) / Math.PI);
      const avant = this.visee?.p ?? 0;
      this.visee = { cd: (cd + 36000) % 36000, p: Math.min(1, long / DRAG_MAX) };
      if (Math.floor(avant * 10) !== Math.floor(this.visee.p * 10)) this.onVisee?.(this.visee.p);
    });
    const fin = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      const v = this.visee;
      this.visee = null;
      if (e.type === 'pointerup' && v && v.p >= PUISSANCE_MIN && this.peutViser()) {
        vibrer(14);
        this.onTir?.(v.cd, v.p);
      }
    };
    c.addEventListener('pointerup', fin);
    c.addEventListener('pointercancel', fin);

    // Alternative clavier : flèches pour viser et doser, espace pour lancer.
    c.addEventListener('keydown', (e) => {
      if (!this.peutViser()) return;
      const v = this.visee || { cd: ANGLE_DEFAUT, p: 0.7 };
      const pasAngle = e.shiftKey ? 10 : 50;
      let gere = true;
      switch (e.key) {
        case 'ArrowLeft': v.cd = (v.cd - pasAngle + 36000) % 36000; break;
        case 'ArrowRight': v.cd = (v.cd + pasAngle) % 36000; break;
        case 'ArrowUp': v.p = Math.min(1, v.p + (e.shiftKey ? 0.005 : 0.02)); break;
        case 'ArrowDown': v.p = Math.max(PUISSANCE_MIN, v.p - (e.shiftKey ? 0.005 : 0.02)); break;
        case ' ':
        case 'Enter':
          this.visee = null;
          this.onTir?.(v.cd, v.p);
          e.preventDefault();
          return;
        default: gere = false;
      }
      if (gere) {
        this.visee = v;
        e.preventDefault();
      }
    });

    window.addEventListener('resize', () => { if (this.actif) this.mesurer(); });
  }

  boucle(t) {
    if (!this.actif) return;
    const dt = Math.min(64, t - this.dernierT);
    this.dernierT = t;
    this.dessiner(t, dt);
    requestAnimationFrame(this.boucle);
  }

  dessiner(t, dt) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.couche, 0, 0);
    const partie = this.partie;
    if (!partie) return;
    ctx.setTransform(this.echelle, 0, 0, this.echelle, this.ox, this.oy);
    const etat = partie.etat;
    if (etat !== this.etatVu) {
      this.effets.vider();
      this.etatVu = etat;
      this.vivants = 0;
    }
    let vivants = 0;
    for (const o of etat.objets) if (o.vivant) vivants++;
    if (vivants < this.vivants) this.onChute?.();
    this.vivants = vivants;

    // Chocs produits par la physique → effets visuels et sonores (lecture seule).
    if (etat.chocs.length) {
      for (const ch of etat.chocs) {
        if (ch.force < 25) continue;
        if (!reduit.matches) this.effets.impact(ch.x, ch.y, ch.force, !ch.jack && ch.force > 120);
        this.onChoc?.(ch);
      }
      etat.chocs.length = 0;
    }
    this.effets.maj(dt);

    // Couches : décalques → ombres → boules → cochonnet → viseur → particules
    this.effets.dessinerDecalques(ctx);
    const objets = etat.objets;
    const enMain = this.bouleEnMain();
    for (let i = 1; i < objets.length; i++) {
      const o = objets[i];
      if (o.vivant) dessinerOmbre(ctx, o.x, o.y, o.r, this.echelle);
    }
    if (enMain) dessinerOmbre(ctx, LANCER.x, LANCER.y, RAYON, this.echelle);
    if (objets[0].vivant) dessinerOmbre(ctx, objets[0].x, objets[0].y, objets[0].r * 0.7, this.echelle);

    for (let i = 1; i < objets.length; i++) {
      const o = objets[i];
      if (o.vivant) dessinerBoule(ctx, o.x, o.y, o.r, o.equipe, i, this.echelle);
    }
    if (enMain) dessinerBoule(ctx, LANCER.x, LANCER.y, RAYON, enMain.equipe, enMain.index, this.echelle, enMain.alpha);

    if (partie.vue) this.dessinerPoints(ctx, etat);

    const jack = objets[0];
    if (jack.vivant) dessinerCochonnet(ctx, jack.x, jack.y, jack.r, t, reduit.matches);

    if (this.visee && this.peutViser()) {
      const { s, c } = sinCos(this.visee.cd);
      dessinerViseur(ctx, LANCER.x, LANCER.y, c, s, this.visee.p);
    }
    this.effets.dessinerParticules(ctx);
  }

  // Prochaine boule posée dans le cercle de lancer.
  bouleEnMain() {
    const p = this.partie;
    if (!p || p.enVol || p.fini || p.vue) return null;
    const m = p.moteur;
    if (m.restantes(m.tour) <= 0) return null;
    return {
      equipe: m.tour,
      index: m.etat.objets.length,
      alpha: m.tour === p.cote ? 1 : 0.55,
    };
  }

  // Fin de mène : cercle autour des boules qui marquent.
  dessinerPoints(ctx, etat) {
    const best = meilleures(etat);
    if (best[0] === best[1]) return;
    const g = best[0] < best[1] ? 0 : 1;
    const jack = etat.objets[0];
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,69,.9)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < etat.objets.length; i++) {
      const o = etat.objets[i];
      if (o.vivant && o.equipe === g && distance(o, jack) < best[1 - g]) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
