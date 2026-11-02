// PRNG 32 bits seedé. Local au client : sert au bot et au rendu, jamais à la physique.
export function mulberry32(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussienne approchée (somme de 4 uniformes, centrée réduite).
export function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508;
}

// Dérive une graine 32 bits d'une graine serveur et d'un indice (mène, boule…).
export function deriver(graine, n) {
  let h = (Number(BigInt.asUintN(32, BigInt(graine))) ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
