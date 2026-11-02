// Dosage du bot : sur un terrain long, il ne doit pas envoyer ses boules derrière le fond.
import assert from 'node:assert/strict';
import { Moteur } from '../js/core/partie.js';
import { choisirCoup } from '../js/core/bot.js';
import { mulberry32 } from '../js/core/rng.js';
import { step, fixerLongueur } from '../js/core/physique.js';

for (const longueur of ['normal', 'long', 'tresLong']) {
  let boules = 0;
  let sorties = 0;
  for (let g = 1; g <= 12; g++) {
    const m = new Moteur(g * 104729, 3, 'terre', 5, { cailloux: 30, longueur });
    const rng = mulberry32(g * 31);
    for (let coups = 0; !m.fini && coups < 60; coups++) {
      const c = choisirCoup(m, 1, rng);
      const cochonnet = m.phase === 'cochonnet';
      m.preparer(c.angle, c.puissance);
      while (!step(m.etat));
      if (!cochonnet) {
        boules++;
        if (!m.etat.objets[m.etat.objets.length - 1].vivant) sorties++;
      }
      m.etat.chocs.length = 0;
      m.resoudre();
    }
  }
  const taux = sorties / boules;
  console.log(`bot ${longueur} : ${sorties}/${boules} boules sorties (${Math.round(taux * 100)} %)`);
  assert.ok(taux <= 0.12, `trop de boules sorties sur terrain ${longueur} : ${taux}`);
}
fixerLongueur('normal');
console.log('bot OK');
