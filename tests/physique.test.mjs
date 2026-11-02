// node tests/physique.test.mjs
import assert from 'node:assert/strict';
import { creerEtat, ajouterBoule, lancer, step, sinCos, LANCER, MAX_PAS } from '../js/core/physique.js';
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
