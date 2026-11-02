// node tests/physique.test.mjs
import assert from 'node:assert/strict';
import { creerEtat, ajouterBoule, lancer, step, sinCos, LANCER, MAX_PAS, SOLS, portee, puissanceCochonnet, JACK_DIST_MIN, JACK_DIST_MAX } from '../js/core/physique.js';
import { Moteur, rejouer, semerCailloux } from '../js/core/partie.js';
import { executerReference } from './scenario.js';

// Table trigo : écart max avec Math.sin (contrôle de précision uniquement).
let ecart = 0;
for (let cd = 0; cd < 36000; cd += 7) {
  const { s, c } = sinCos(cd);
  const a = cd / 100 * Math.PI / 180;
  ecart = Math.max(ecart, Math.abs(s - Math.sin(a)), Math.abs(c - Math.cos(a)));
}
assert.ok(ecart < 1e-4, 'table trigo imprécise : ' + ecart);

// Tir plein pot vers le haut : portée et arrêt.
const e = creerEtat({ x: 30, y: 30 });
const b = ajouterBoule(e, 0);
lancer(e, b, 27000, 0.8);
let n = 0;
while (!step(e)) n++;
assert.ok(n < MAX_PAS);
console.log('tir 0.8 : arrêt après', n, 'pas, y =', e.objets[b].y.toFixed(2), 'x =', e.objets[b].x.toFixed(4));
assert.equal(e.objets[b].x, LANCER.x);

// Cloche : la portée totale est linéaire en la puissance sur chaque sol, et la boule est bien en l'air au début.
for (const sol of Object.values(SOLS)) {
  for (const p of [0.2, 0.5, 0.7]) {
    const ec = creerEtat({ x: 30, y: 30 }, sol);
    const bc = ajouterBoule(ec, 0);
    lancer(ec, bc, 27000, p);
    step(ec);
    assert.ok(ec.objets[bc].air > 0, 'la boule doit être en vol');
    while (!step(ec));
    const parcouru = LANCER.y - ec.objets[bc].y;
    assert.ok(Math.abs(parcouru - portee(sol) * p) < 3, `${sol.id} portée ${p} : ${parcouru} au lieu de ${portee(sol) * p}`);
  }
}
// Un sol plus lisse fait rouler davantage la boule après l'atterrissage.
const roule = (sol) => {
  const ec = creerEtat({ x: 30, y: 30 }, sol);
  const bc = ajouterBoule(ec, 0);
  lancer(ec, bc, 27000, 0.5);
  while (ec.objets[bc].air > 0 || ec.pas < 2) step(ec);
  const yChute = ec.objets[bc].y;
  while (!step(ec));
  return yChute - ec.objets[bc].y;
};
assert.ok(roule(SOLS.lisse) > roule(SOLS.terre) && roule(SOLS.terre) > roule(SOLS.gravier), 'ordre de roulement lisse > terre > gravier');

// Un caillou dévie une boule qui roule dessus, une seule fois, du côté opposé.
const sans = creerEtat({ x: 30, y: 30 });
const bs = ajouterBoule(sans, 0);
lancer(sans, bs, 27000, 0.6);
while (!step(sans));
const avec = creerEtat({ x: 30, y: 30 }, SOLS.terre, [{ x: LANCER.x + 1, y: 566 - 340, r: 4, d: 0.12 }]);
const ba = ajouterBoule(avec, 0);
lancer(avec, ba, 27000, 0.6);
while (!step(avec));
assert.notEqual(avec.objets[ba].x, sans.objets[bs].x, 'le caillou doit dévier la boule');
assert.ok(avec.objets[ba].x < sans.objets[bs].x, 'caillou à droite de la trajectoire : déviation vers la gauche');

// Cochonnet : lancé par le premier joueur, toujours entre les distances autorisées.
for (const sol of Object.keys(SOLS)) {
  for (const p of [0.05, 0.5, 1]) {
    const pe = puissanceCochonnet(p, SOLS[sol]) * portee(SOLS[sol]);
    assert.ok(pe >= JACK_DIST_MIN - 1e-6 && pe <= JACK_DIST_MAX + 1e-6, `cochonnet ${sol} ${p} : ${pe}`);
  }
}
const mj = new Moteur(7, 3, 'terre');
assert.equal(mj.phase, 'cochonnet');
assert.equal(mj.etat.objets[0].enMain, true);
const evj = mj.jouerInstantane(27000, 0.5);
assert.equal(evj.type, 'tour');
assert.equal(evj.cochonnet, true);
assert.equal(mj.phase, 'boules');
assert.equal(mj.tour, mj.ouvreur, 'celui qui a lancé le cochonnet lance aussi la première boule');
const dj = LANCER.y - mj.etat.objets[0].y;
assert.ok(dj > JACK_DIST_MIN - 40 && dj < JACK_DIST_MAX + 40, 'cochonnet à distance raisonnable : ' + dj);
// Cochonnet sorti de côté : lancer nul, même équipe, nouvel essai, puis pose d'office.
const mn = new Moteur(7, 3, 'lisse');
assert.equal(mn.jouerInstantane(18500, 1).type, 'annulee');
assert.equal(mn.phase, 'cochonnet');
assert.equal(mn.jouerInstantane(18500, 1).type, 'annulee');
assert.equal(mn.phase, 'boules', 'après deux lancers nuls le cochonnet est posé d office');
assert.equal(semerCailloux(7, 1, 0, 5).length, 5);
assert.deepEqual(semerCailloux(7, 1, 0, 5), semerCailloux(7, 1, 0, 5));
// Pendant le vol, pas de choc : une boule posée sur la trajectoire n'est pas touchée.
const ev = creerEtat({ x: 30, y: 30 });
const cible = ajouterBoule(ev, 1);
ev.objets[cible].x = 180; ev.objets[cible].y = 400;
const tireuse = ajouterBoule(ev, 0);
lancer(ev, tireuse, 27000, 0.9);
for (let k = 0; k < 20; k++) step(ev);
assert.equal(ev.objets[cible].x, 180);
assert.equal(ev.objets[cible].y, 400);

// Choc frontal sur le cochonnet.
const e2 = creerEtat({ x: 180, y: 300 });
const b2 = ajouterBoule(e2, 1);
lancer(e2, b2, 27000, 0.75);
while (!step(e2));
console.log('choc : jack', e2.objets[0].y.toFixed(2), 'vivant', e2.objets[0].vivant, '| boule', e2.objets[b2].y.toFixed(2));

const r1 = executerReference();
const r2 = executerReference();
assert.deepEqual(r1, r2);
console.log('référence :', JSON.stringify(r1), '| écart trigo', ecart.toExponential(2));
console.log('OK');
