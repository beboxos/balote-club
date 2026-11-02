import { TERRAIN, LANCER, RAYON, PORTEE_AIR, sinCos, distance, puissanceCochonnet } from '../core/physique.js';
import { meilleures } from '../core/partie.js';
import { dessinerTerrain, spriteBoule, Effets, viderCaches, HALO } from './matieres.js';
import { Camera, peindreDecor, ombreSol, haloSol, anneauSol, cochonnet, trajectoire, jauge, GROSSISSEMENT } from './vue3d.js';
import { dessinerPerso, positionRepos, poste } from './perso.js';

const DRAG_MAX = 150;     // unités du terrain pour la puissance pleine
const PUISSANCE_MIN = 0.04;
const ANGLE_DEFAUT = 27000;
const MAIN_LACHER = 28;  // hauteur de la main au lâcher, point de départ de la cloche
const TEX = 2;            // pixels de texture par unité du terrain
const GROSSISSEMENT_JACK = 1.54;   // cochonnet : 30 % plus petit qu'avant (2,2)
const SPRITE_R = 40;      // rayon de référence des sprites de boule, réduit ou agrandi au dessin
const DUREE_GESTE = 560;  // ms ; la boule part à RELACHE × DUREE_GESTE
const RELACHE = 0.68;
const reduit = window.matchMedia('(prefers-reduced-motion: reduce)');

function vibrer(ms) {
  try { navigator.vibrate?.(ms); } catch { /* API absente ou bloquée */ }
}

const lerp = (a, b, t) => a + (b - a) * t;
const adoucir = (t) => t * t * (3 - 2 * t);

export class Rendu {
  constructor(canvas, { onTir, onChoc, onVisee, onChute, onRoule } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTir = onTir;
    this.onChoc = onChoc;
    this.onVisee = onVisee;
    this.onChute = onChute;
    this.onRoule = onRoule;
    this.vivants = 0;
    this.partie = null;
    this.effets = new Effets();
    this.decor = document.createElement('canvas');
    this.texture = null;
    this.solId = null;
    this.cam = null;
    this.visee = null;           // { cd, p } pendant le geste ou au clavier
    this.drag = null;
    this.observer = false;       // mode observation : déplacer et zoomer la vue au lieu de viser
    this.vue = { z: 1, tx: 0, ty: 0 };
    this.vueDecor = { z: 1, tx: 0, ty: 0 };   // vue avec laquelle le décor pré-rendu a été peint
    this.pointes = new Map();
    this.minuteurDecor = null;
    this.etatVu = null;
    this.actif = false;
    this.dernierT = 0;
    this.geste = null;           // lancer en cours : { equipe, t0, p, lache }
    this.vol = null;             // trajectoire visuelle de la dernière boule lâchée
    this.persos = [positionRepos(0), positionRepos(1)];
    this.mesurer();
    this.ecouter();
    this.boucle = this.boucle.bind(this);
  }

  attacher(partie) {
    this.partie = partie;
    this.observer = false;
    this.reinitialiserVue();
    this.visee = null;
    this.drag = null;
    this.geste = null;
    this.vol = null;
    this.effets.vider();
    // Le sol de la partie décide de la texture de la piste.
    const sol = partie?.moteur.sol.id ?? this.solId;
    // La longueur du terrain change la géométrie : caméra, décor et position des joueurs sont refaits.
    if (TERRAIN.h !== this.hauteurVue) {
      this.hauteurVue = TERRAIN.h;
      this.solId = sol;
      this.texture = null;
      this.cam = null;
      this.persos = [positionRepos(0), positionRepos(1)];
      this.mesurer();
    } else if (sol && sol !== this.solId) {
      this.solId = sol;
      this.texture = null;
      if (this.cam) this.construire();
    }
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this.mesurer();
    this.dernierT = performance.now();
    requestAnimationFrame(this.boucle);
  }

  arreter() { this.actif = false; this.onRoule?.(0); }

  // Mesure unique par redimensionnement : pas de lecture de layout dans la boucle.
  mesurer() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const l = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (l === this.canvas.width && h === this.canvas.height && this.cam) return;
    this.canvas.width = l;
    this.canvas.height = h;
    this.dpr = dpr;
    this.rect = rect;
    this.unite = h / TERRAIN.h;   // pixels d'écran par unité, pour convertir le geste du doigt
    viderCaches();
    this.cam = new Camera(l, h);
    Object.assign(this.cam, this.vue);
    this.construire();
  }

  // Après le chargement de l'atlas du décor.
  rafraichirDecor() { if (this.cam) this.construire(); }

  // Décor statique : texture de la piste (selon le sol) projetée par la caméra.
  construire() {
    if (!this.texture) {
      this.texture = document.createElement('canvas');
      this.texture.width = TERRAIN.l * TEX;
      this.texture.height = TERRAIN.h * TEX;
      const t = this.texture.getContext('2d');
      t.scale(TEX, TEX);
      dessinerTerrain(t, TERRAIN.l, TERRAIN.h, TERRAIN.marge, this.solId || 'terre');
    }
    this.decor.width = this.canvas.width;
    this.decor.height = this.canvas.height;
    peindreDecor(this.decor.getContext('2d'), this.cam, this.texture, TEX);
    this.vueDecor = { z: this.cam.z, tx: this.cam.tx, ty: this.cam.ty };
  }

  coord(clientX, clientY) {
    return { x: (clientX - this.rect.left) * this.dpr, y: (clientY - this.rect.top) * this.dpr };
  }

  peutViser() {
    return !this.observer && !!this.partie && this.partie.estMonTour && !this.partie.vue;
  }

  // ---- Mode observation : glisser pour déplacer, pincer ou molette pour zoomer ----

  basculerObserver() {
    this.observer = !this.observer;
    this.drag = null;
    this.visee = null;
    this.pointes.clear();
    if (!this.observer) this.reinitialiserVue();
    return this.observer;
  }

  reinitialiserVue() {
    this.vue = { z: 1, tx: 0, ty: 0 };
    if (this.cam) { Object.assign(this.cam, this.vue); this.planifierDecor(); }
  }

  limiterVue() {
    const v = this.vue;
    v.z = Math.min(3.2, Math.max(1, v.z));
    const l = this.canvas.width;
    const h = this.canvas.height;
    v.tx = Math.min(l * 0.5 * v.z, Math.max(-l * 0.5 * v.z, v.tx));
    v.ty = Math.min(h * 0.5 * v.z, Math.max(-h * 0.5 * v.z, v.ty));
  }

  // Zoom d'un facteur s autour du point d'écran q (le point sous le doigt reste en place).
  zoomerVue(s, q) {
    const v = this.vue;
    const z = Math.min(3.2, Math.max(1, v.z * s));
    const e = z / v.z;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    v.tx = (q.x - cx) - (q.x - cx - v.tx) * e;
    v.ty = (q.y - cy) - (q.y - cy - v.ty) * e;
    v.z = z;
  }

  appliquerVue() {
    this.limiterVue();
    if (this.cam) Object.assign(this.cam, this.vue);
    this.planifierDecor();
  }

  // Le décor pré-rendu est étiré pendant le geste, puis repeint net une fois la vue stable.
  planifierDecor() {
    clearTimeout(this.minuteurDecor);
    this.minuteurDecor = setTimeout(() => { if (this.cam) this.construire(); }, 140);
  }

  dessinerDecor(ctx) {
    const a = this.vueDecor;
    const b = this.vue;
    if (a.z === b.z && a.tx === b.tx && a.ty === b.ty) { ctx.drawImage(this.decor, 0, 0); return; }
    const r = b.z / a.z;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    ctx.setTransform(r, 0, 0, r, cx * (1 - r) + b.tx - r * a.tx, cy * (1 - r) + b.ty - r * a.ty);
    ctx.drawImage(this.decor, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  ecouterObservation() {
    const c = this.canvas;
    const pts = this.pointes;
    const milieu = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const ecart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
    c.addEventListener('pointerdown', (e) => {
      if (!this.observer) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      pts.set(e.pointerId, this.coord(e.clientX, e.clientY));
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.observer || !pts.has(e.pointerId)) return;
      const avant = [...pts.values()];
      const p = this.coord(e.clientX, e.clientY);
      pts.set(e.pointerId, p);
      const apres = [...pts.values()];
      if (apres.length === 1) {
        this.vue.tx += p.x - avant[0].x;
        this.vue.ty += p.y - avant[0].y;
      } else {
        const m0 = milieu(avant[0], avant[1]);
        const m1 = milieu(apres[0], apres[1]);
        this.vue.tx += m1.x - m0.x;
        this.vue.ty += m1.y - m0.y;
        this.zoomerVue(ecart(apres[0], apres[1]) / ecart(avant[0], avant[1]), m1);
      }
      this.appliquerVue();
      e.preventDefault();
    });
    const lacher = (e) => pts.delete(e.pointerId);
    c.addEventListener('pointerup', lacher);
    c.addEventListener('pointercancel', lacher);
    c.addEventListener('wheel', (e) => {
      if (!this.observer) return;
      this.zoomerVue(Math.exp(-e.deltaY * 0.0015), this.coord(e.clientX, e.clientY));
      this.appliquerVue();
      e.preventDefault();
    }, { passive: false });
  }

  ecouter() {
    const c = this.canvas;
    this.ecouterObservation();
    c.addEventListener('pointerdown', (e) => {
      if (!this.peutViser() || this.drag) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, depart: this.coord(e.clientX, e.clientY) };
      this.visee = null;
      vibrer(8);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const p = this.coord(e.clientX, e.clientY);
      // Glissement d'écran (arrière = vers soi) → direction du terrain, selon la rotation de la vue.
      const sx = this.drag.depart.x - p.x;
      const sy = this.drag.depart.y - p.y;
      const long = Math.sqrt(sx * sx + sy * sy) / this.unite;
      if (long < 4) { this.visee = null; return; }
      const { ex, ey } = this.cam.base();
      const det = ex.x * ey.y - ey.x * ex.y;
      const dx = (sx * ey.y - ey.x * sy) / det;
      const dy = (ex.x * sy - sx * ex.y) / det;
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

  // Geste de lancer : la promesse se résout quand la main lâche la boule. La physique démarre alors.
  lancerGeste(equipe, puissance) {
    if (reduit.matches || !this.actif) return Promise.resolve();
    const g = { equipe, t0: performance.now(), p: puissance, lache: false };
    this.geste = g;
    return new Promise((ok) => {
      setTimeout(() => {
        g.lache = true;
        this.vol = { main: g.main };
        ok();
      }, DUREE_GESTE * RELACHE);
    });
  }

  boucle(t) {
    if (!this.actif) return;
    const dt = Math.min(64, t - this.dernierT);
    this.dernierT = t;
    this.dessiner(t, dt);
    requestAnimationFrame(this.boucle);
  }

  // Bras, buste et jambes d'un joueur selon ce qu'il fait à cet instant.
  pose(equipe, t) {
    const g = this.geste;
    const repos = { bras: -0.12 + 0.03 * Math.sin(t / 600 + equipe), penche: 0, pas: 0.25 * Math.sin(t / 900 + equipe * 2) };
    if (g && g.equipe === equipe) {
      const ph = (t - g.t0) / DUREE_GESTE;
      if (ph >= 1.5) { this.geste = null; return repos; }
      const depart = -0.3 - g.p * 0.6;
      const arriere = -1.15;
      if (ph < 0.38) {
        const k = adoucir(ph / 0.38);
        return { bras: lerp(depart, arriere, k), penche: lerp(-4 * g.p, -6, k), pas: 0 };
      }
      if (ph < RELACHE + 0.12) {
        const k = adoucir((ph - 0.38) / (RELACHE + 0.12 - 0.38));
        return { bras: lerp(arriere, 1.0, k), penche: lerp(-6, 6, k), pas: k * 2.4 };
      }
      const k = adoucir(Math.min(1, (ph - RELACHE - 0.12) / 0.7));
      return { bras: lerp(1.0, repos.bras, k), penche: lerp(6, 0, k), pas: lerp(2.4, 0, k) };
    }
    if (this.visee && this.peutViser() && this.partie.estJoueurLocal(equipe)) {
      return { bras: -0.3 - this.visee.p * 0.6, penche: -4 * this.visee.p, pas: 0 };
    }
    return repos;
  }

  dessiner(t, dt) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.dessinerDecor(ctx);
    const partie = this.partie;
    if (!partie) return;
    const cam = this.cam;
    const etat = partie.etat;
    if (etat !== this.etatVu) {
      this.effets.vider();
      this.etatVu = etat;
      this.vivants = 0;
      this.vol = null;
    }
    let vivants = 0;
    for (const o of etat.objets) if (o.vivant) vivants++;
    if (vivants < this.vivants) this.onChute?.();
    this.vivants = vivants;

    // Chocs produits par la physique → effets visuels et sonores (lecture seule).
    if (etat.chocs.length) {
      for (const ch of etat.chocs) {
        if (ch.atterri) { this.onChoc?.(ch); continue; }   // atterrissage : son seulement
        if (ch.force < 12) continue;
        if (!reduit.matches && ch.force >= 25) this.effets.impact(ch.x, ch.y, ch.force, !ch.jack && ch.force > 120);
        this.onChoc?.(ch);
      }
      etat.chocs.length = 0;
    }
    // Roulement : l'objet au sol le plus rapide donne le volume.
    let rapide = 0;
    for (const o of etat.objets) {
      if (!o.vivant || o.air > 0) continue;
      const v = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      if (v > rapide) rapide = v;
    }
    this.onRoule?.(rapide);
    this.effets.maj(dt);
    this.effets.dessinerDecalques(ctx, cam);

    const objets = etat.objets;
    // Boules en l'air : la physique donne le vol restant, on en tire hauteur et décalage visuels.
    const aeriennes = [];
    for (let i = 0; i < objets.length; i++) {
      const o = objets[i];
      if (o.vivant && o.air > 0) aeriennes.push(i);
    }

    this.dessinerCailloux(ctx, etat);

    // Ombres puis corps, du fond vers le premier plan (le cochonnet tenu en main n'est pas au sol).
    const ordre = [];
    for (let i = 0; i < objets.length; i++) {
      if (objets[i].vivant && !(objets[i].air > 0) && !objets[i].enMain) ordre.push(i);
    }
    ordre.sort((a, b) => objets[a].y - objets[b].y);
    for (const i of ordre) {
      const o = objets[i];
      if (i > 0) haloSol(ctx, cam, o.x, o.y, o.r * 1.9, HALO[o.equipe], 0.5);
      ombreSol(ctx, cam, o.x, o.y, o.r * (i === 0 ? 1.1 : 1), i === 0 ? 0.32 : 0.42);
    }
    for (const i of ordre) {
      const o = objets[i];
      if (i === 0) {
        const c = cam.projeter(o.x, o.y, o.r);
        cochonnet(ctx, c.x, c.y, o.r * c.k * GROSSISSEMENT_JACK, t, reduit.matches);
      } else {
        this.boule(ctx, o.x, o.y, o.r, o.equipe, i, 1);
      }
    }

    if (partie.vue) this.dessinerPoints(ctx, etat);

    if (this.visee && this.peutViser()) {
      jauge(ctx, cam, LANCER.x, LANCER.y, this.visee.p);
      trajectoire(ctx, cam, this.courbe(this.visee.cd, this.visee.p), t);
    }

    // Joueurs : celui qui lance au cercle, l'autre à côté ; ils glissent de l'un à l'autre.
    const actif = this.geste?.equipe ?? partie.moteur.tour;
    const mains = [null, null];
    for (const e of [1 - actif, actif]) {
      const cible = e === actif ? poste() : positionRepos(e);
      const p = this.persos[e];
      const a = 1 - Math.exp(-dt / 140);
      p.x = lerp(p.x, cible.x, a);
      p.y = lerp(p.y, cible.y, a);
      mains[e] = dessinerPerso(ctx, cam, { x: p.x, y: p.y, equipe: e, pose: this.pose(e, t) });
    }

    // Boule tenue en main, puis boule en l'air (devant le joueur).
    const g = this.geste;
    const enMain = this.bouleEnMain();
    if (g && !g.lache) {
      g.main = mains[g.equipe];
      if (objets[0].enMain) this.jackMain(ctx, g.main, t);
      else this.bouleMain(ctx, g.main, g.equipe, objets.length, 1);
    } else if (enMain && mains[enMain.equipe]) {
      if (enMain.jack) this.jackMain(ctx, mains[enMain.equipe], t, enMain.alpha);
      else this.bouleMain(ctx, mains[enMain.equipe], enMain.equipe, enMain.index, enMain.alpha);
    }
    // Les boules en l'air passent au-dessus de tout, avec leur ombre au sol décalée.
    for (const i of aeriennes) {
      const o = objets[i];
      const k = 1 - o.air / o.air0;
      const h = o.r + (MAIN_LACHER - o.r) * (1 - k) + o.arc * 4 * k * (1 - k);
      const main = this.vol?.main;
      const e = (1 - k) ** 4;
      const x = o.x + (main ? (main.x - LANCER.x) * e : 0);
      const y = o.y + (main ? (main.y - LANCER.y) * e : 0);
      ombreSol(ctx, cam, x, y, o.r, 0.42, h - o.r);
      const c = cam.projeter(x, y, h);
      const echelle = 1 + (h - o.r) / 160;
      if (i === 0) cochonnet(ctx, c.x, c.y, o.r * c.k * GROSSISSEMENT_JACK * echelle, t, reduit.matches);
      else this.spriteAt(ctx, c.x, c.y, o.r * c.k * GROSSISSEMENT * echelle, o.equipe, i, 1);
    }

    this.effets.dessinerParticules(ctx, cam);
  }

  // Trajectoire prévue (sans la dispersion du lancer) : de la main au point de chute.
  courbe(cd, pGeste) {
    const { s, c } = sinCos(cd);
    // Cochonnet : le geste est étalé sur la fourchette de distance autorisée.
    const m = this.partie.moteur;
    const p = m.phase === 'cochonnet' ? puissanceCochonnet(pGeste, m.sol) : pGeste;
    const portee = PORTEE_AIR * p;
    const arc = 20 + 120 * Math.sqrt(p);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      pts.push({
        x: LANCER.x + c * portee * k,
        y: LANCER.y + s * portee * k,
        h: RAYON + (MAIN_LACHER - RAYON) * (1 - k) + arc * 4 * k * (1 - k),
      });
    }
    return pts;
  }

  boule(ctx, x, y, r, equipe, index, alpha) {
    const c = this.cam.projeter(x, y, r);
    this.spriteAt(ctx, c.x, c.y, r * c.k * GROSSISSEMENT, equipe, index, alpha);
  }

  // Cochonnet tenu en main (taille du cochonnet qui roule).
  jackMain(ctx, main, t, alpha = 1) {
    const c = this.cam.projeter(main.x, main.y, main.z);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    cochonnet(ctx, c.x, c.y, 4.5 * c.k * GROSSISSEMENT_JACK, t, true);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  // Petits cailloux de la piste : posés au sol, avec leur ombre.
  dessinerCailloux(ctx, etat) {
    const cam = this.cam;
    for (const k of etat.cailloux) {
      ombreSol(ctx, cam, k.x, k.y, k.r * 1.3, 0.28);
      const c = cam.projeter(k.x, k.y, k.r * 0.5);
      const r = k.r * c.k * 1.15;
      ctx.fillStyle = '#6f675c';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(235,228,214,.55)';
      ctx.beginPath(); ctx.ellipse(c.x - r * 0.25, c.y - r * 0.3, r * 0.45, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Dans la main d'un joueur rapetissé : boule plus petite que celle qui roule.
  bouleMain(ctx, main, equipe, index, alpha) {
    const c = this.cam.projeter(main.x, main.y, main.z);
    this.spriteAt(ctx, c.x, c.y, RAYON * c.k * GROSSISSEMENT * 0.72, equipe, index, alpha);
  }

  spriteAt(ctx, x, y, rayon, equipe, index, alpha) {
    const s = spriteBoule(equipe, index % 6, SPRITE_R, 1);
    const facteur = rayon / SPRITE_R;
    const taille = s.c.width * facteur;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(s.c, x - s.m * facteur, y - s.m * facteur, taille, taille);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  // Prochaine boule du joueur dont c'est le tour, tenue en main.
  bouleEnMain() {
    const p = this.partie;
    if (!p || p.enVol || p.fini || p.vue) return null;
    const m = p.moteur;
    if (m.phase === 'cochonnet') return { equipe: m.tour, jack: true, alpha: p.estJoueurLocal(m.tour) ? 1 : 0.7 };
    if (m.restantes(m.tour) <= 0) return null;
    return {
      equipe: m.tour,
      index: m.etat.objets.length,
      alpha: p.estJoueurLocal(m.tour) ? 1 : 0.7,
    };
  }

  // Fin de mène : anneau autour des boules qui marquent.
  dessinerPoints(ctx, etat) {
    const best = meilleures(etat);
    if (best[0] === best[1]) return;
    const g = best[0] < best[1] ? 0 : 1;
    const jack = etat.objets[0];
    for (let i = 1; i < etat.objets.length; i++) {
      const o = etat.objets[i];
      if (o.vivant && o.equipe === g && distance(o, jack) < best[1 - g]) {
        anneauSol(ctx, this.cam, o.x, o.y, (o.r + 5) * GROSSISSEMENT, 'rgba(255,150,95,.95)', 3);
      }
    }
  }
}
