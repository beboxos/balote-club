import { TERRAIN, LANCER, RAYON, PORTEE_AIR, sinCos, distance } from '../core/physique.js';
import { meilleures } from '../core/partie.js';
import { dessinerTerrain, spriteBoule, Effets, viderCaches } from './matieres.js';
import { Camera, peindreDecor, ombreSol, anneauSol, cochonnet, trajectoire, jauge, GROSSISSEMENT } from './vue3d.js';
import { dessinerPerso, positionRepos, POSTE } from './perso.js';

const DRAG_MAX = 150;     // unités du terrain pour la puissance pleine
const PUISSANCE_MIN = 0.04;
const ANGLE_DEFAUT = 27000;
const MAIN_LACHER = 28;  // hauteur de la main au lâcher, point de départ de la cloche
const TEX = 2;            // pixels de texture par unité du terrain
const GROSSISSEMENT_JACK = 2.2;
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
    this.decor = document.createElement('canvas');
    this.texture = null;
    this.cam = null;
    this.visee = null;           // { cd, p } pendant le geste ou au clavier
    this.drag = null;
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
    this.visee = null;
    this.drag = null;
    this.geste = null;
    this.vol = null;
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
    if (l === this.canvas.width && h === this.canvas.height && this.cam) return;
    this.canvas.width = l;
    this.canvas.height = h;
    this.dpr = dpr;
    this.rect = rect;
    this.unite = h / TERRAIN.h;   // pixels d'écran par unité, pour convertir le geste du doigt
    viderCaches();
    if (!this.texture) {
      this.texture = document.createElement('canvas');
      this.texture.width = TERRAIN.l * TEX;
      this.texture.height = TERRAIN.h * TEX;
      const t = this.texture.getContext('2d');
      t.scale(TEX, TEX);
      dessinerTerrain(t, TERRAIN.l, TERRAIN.h, TERRAIN.marge);
    }
    this.cam = new Camera(l, h);
    this.decor.width = l;
    this.decor.height = h;
    peindreDecor(this.decor.getContext('2d'), this.cam, this.texture, TEX);
  }

  coord(clientX, clientY) {
    return { x: (clientX - this.rect.left) * this.dpr, y: (clientY - this.rect.top) * this.dpr };
  }

  peutViser() {
    return !!this.partie && this.partie.estMonTour && !this.partie.vue;
  }

  ecouter() {
    const c = this.canvas;
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
    ctx.drawImage(this.decor, 0, 0);
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
        if (ch.force < 25) continue;
        if (!reduit.matches) this.effets.impact(ch.x, ch.y, ch.force, !ch.jack && ch.force > 120);
        this.onChoc?.(ch);
      }
      etat.chocs.length = 0;
    }
    this.effets.maj(dt);
    this.effets.dessinerDecalques(ctx, cam);

    const objets = etat.objets;
    // Boules en l'air : la physique donne le vol restant, on en tire hauteur et décalage visuels.
    const aeriennes = [];
    for (let i = 1; i < objets.length; i++) {
      const o = objets[i];
      if (o.vivant && o.air > 0) aeriennes.push(i);
    }

    // Ombres puis corps, du fond vers le premier plan.
    const ordre = [];
    for (let i = 0; i < objets.length; i++) if (objets[i].vivant && !(objets[i].air > 0)) ordre.push(i);
    ordre.sort((a, b) => objets[a].y - objets[b].y);
    for (const i of ordre) {
      const o = objets[i];
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
      const cible = e === actif ? POSTE : positionRepos(e);
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
      this.bouleMain(ctx, g.main, g.equipe, objets.length, 1);
    } else if (enMain && mains[enMain.equipe]) {
      this.bouleMain(ctx, mains[enMain.equipe], enMain.equipe, enMain.index, enMain.alpha);
    }
    // Les boules en l'air passent au-dessus de tout, avec leur ombre au sol décalée.
    for (const i of aeriennes) {
      const o = objets[i];
      const k = 1 - o.air / o.air0;
      const h = RAYON + (MAIN_LACHER - RAYON) * (1 - k) + o.arc * 4 * k * (1 - k);
      const main = this.vol?.main;
      const e = (1 - k) ** 4;
      const x = o.x + (main ? (main.x - LANCER.x) * e : 0);
      const y = o.y + (main ? (main.y - LANCER.y) * e : 0);
      ombreSol(ctx, cam, x, y, RAYON, 0.42, h - RAYON);
      const c = cam.projeter(x, y, h);
      this.spriteAt(ctx, c.x, c.y, RAYON * c.k * GROSSISSEMENT * (1 + (h - RAYON) / 160), o.equipe, i, 1);
    }

    this.effets.dessinerParticules(ctx, cam);
  }

  // Trajectoire prévue (sans la dispersion du lancer) : de la main au point de chute.
  courbe(cd, p) {
    const { s, c } = sinCos(cd);
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
