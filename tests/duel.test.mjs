// node tests/duel.test.mjs — deux clients lockstep reliés en mémoire, plus une reprise
// « rechargement d'onglet » depuis le journal. Vérifie scores et empreintes identiques.
import assert from 'node:assert/strict';

globalThis.performance ??= { now: () => Date.now() };
let horloge = 0;
globalThis.requestAnimationFrame = (f) => setTimeout(() => f((horloge += 16)), 0);

const { Partie } = await import('../js/core/partie.js');
const { choisirCoup } = await import('../js/core/bot.js');
const { empreinte } = await import('../js/core/physique.js');
const { mulberry32 } = await import('../js/core/rng.js');

const GRAINE = 987654321;
const journalServeur = [];
const clients = [];
const fins = [];

function creerClient(cote) {
  const reseau = {
    envoyerCoup(coup) {
      journalServeur.push(coup);
      // Livraison en double (broadcast + postgres_changes) : le doublon doit être ignoré.
      for (const c of clients) if (c !== client) { c.partie.recevoirCoup(coup); c.partie.recevoirCoup(coup); }
    },
  };
  const client = { cote, rng: mulberry32(cote + 1) };
  client.partie = new Partie({
    graine: GRAINE, cote, reseau,
    onTour: (e) => {
      if (e === cote && !client.partie.fini) {
        const c = choisirCoup(client.partie.moteur, 1, client.rng);
        client.partie.jouer(c.angle, c.puissance);
      }
    },
    onFin: (scores) => fins.push({ cote, scores }),
  });
  client.partie.acceleration = 1e6;
  return client;
}

clients.push(creerClient(0), creerClient(1));
const pauseOrig = globalThis.setTimeout;
// Les pauses d'affichage de fin de mène (1,6–2,2 s) sont raccourcies pour le test.
globalThis.setTimeout = (f, ms, ...a) => pauseOrig(f, Math.min(ms || 0, 1), ...a);

// Coup hors séquence : ignoré.
assert.equal(clients[1].partie.recevoirCoup({ seq: 5, angle: 27000, puissance: 0.5 }), false);

// L'hôte ouvre.
const c0 = choisirCoup(clients[0].partie.moteur, 1, clients[0].rng);
clients[0].partie.jouer(c0.angle, c0.puissance);

// Un client qui tente de jouer hors de son tour est refusé.
assert.equal(clients[1].partie.jouer(27000, 0.5), false);

let reprise = null;
await new Promise((ok) => {
  const t = setInterval(() => {
    // Rechargement simulé du client invité à mi-partie : nouvel objet, journal serveur rejoué.
    const p1 = clients[1].partie;
    if (!reprise && journalServeur.length >= 13 && !p1.enVol && p1.journal.length === journalServeur.length) {
      reprise = new Partie({ graine: GRAINE, cote: 1, reseau: null });
      reprise.resynchroniser(journalServeur.slice());
      assert.equal(empreinte(reprise.moteur.etat), empreinte(clients[1].partie.moteur.etat), 'reprise désynchronisée');
    }
    if (fins.length === 2) { clearInterval(t); ok(); }
  }, 5);
});

assert.deepEqual(fins[0].scores, fins[1].scores);
assert.equal(empreinte(clients[0].partie.moteur.etat), empreinte(clients[1].partie.moteur.etat));
assert.equal(clients[0].partie.journal.length, journalServeur.length);
assert.ok(reprise, 'reprise non testée');
console.log('duel OK :', fins[0].scores, '| coups', journalServeur.length, '| reprise vérifiée à', reprise.journal.length, 'coups');
process.exit(0);
