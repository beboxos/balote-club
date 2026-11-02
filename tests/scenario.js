// Scénario de référence : mêmes entrées sur tous les appareils → même empreinte.
import { rejouer } from '../js/core/partie.js';
import { empreinte } from '../js/core/physique.js';
import { mulberry32 } from '../js/core/rng.js';

export const GRAINE = 123456789;

export function coupsReference(n = 64) {
  const rng = mulberry32(42);
  const coups = [];
  for (let i = 0; i < n; i++) {
    coups.push({ seq: i, angle: Math.round(25500 + rng() * 3000), puissance: Math.round((0.55 + rng() * 0.45) * 1000) / 1000 });
  }
  return coups;
}

export function executerReference() {
  const m = rejouer(GRAINE, coupsReference());
  return { empreinte: empreinte(m.etat), scores: m.scores.slice(), mene: m.mene, fini: m.fini };
}
