// Nécessite le réseau et la migration supabase/profils.sql : node tests/profils.e2e.mjs (laisse trois profils zzTest... à purger, voir NOTES.md).
// Test de bout en bout des profils contre le vrai serveur (REST, trois appareils anonymes).
import assert from 'node:assert/strict';
import { SUPABASE_URL as URL, SUPABASE_ANON_KEY as KEY } from '../js/config.js';

async function appareil() {
  const r = await fetch(`${URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json();
  assert.ok(j.access_token, 'signup anonyme : ' + JSON.stringify(j).slice(0, 200));
  const jeton = j.access_token;
  const rpc = async (nom, args = {}) => {
    const res = await fetch(`${URL}/rest/v1/rpc/${nom}`, { method: 'POST', headers: { apikey: KEY, authorization: 'Bearer ' + jeton, 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const texte = await res.text();
    return { status: res.status, data: texte ? JSON.parse(texte) : null };
  };
  return { uid: j.user.id, jeton, rpc };
}

const A = await appareil();
const B = await appareil();
const C = await appareil();
const pseudo = 'zzTest' + Math.floor(Math.random() * 1e5);
const autre = pseudo.replace('zzTest', 'zz.Test_');   // même squelette

// Validation et statut
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: 'ab' })).data, 'invalide');
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: 'Лeа12' })).data, 'invalide');
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: pseudo })).data, 'libre');

// Alphabet : lettres que le squelette sait normaliser seulement
for (const exotique of ['Øystein', 'Straße', 'Þórr', 'Æsir']) assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: exotique })).data, 'invalide', exotique);

// Réservation
assert.equal((await A.rpc('bal_reserver', { p_pseudo: pseudo, p_mdp: 'abc' })).data.error, 'mdp');
assert.equal((await A.rpc('bal_reserver', { p_pseudo: pseudo, p_mdp: 'secret1', p_avatar: 'x' })).data.error, 'avatar');
const r1 = (await A.rpc('bal_reserver', { p_pseudo: pseudo, p_mdp: 'secret1', p_avatar: '02' })).data;
assert.deepEqual(r1, { ok: true, pseudo, avatar: '02' });
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: pseudo })).data, 'a_moi');
assert.equal((await B.rpc('bal_pseudo_statut', { p_pseudo: pseudo.toLowerCase() })).data, 'reserve');
assert.equal((await B.rpc('bal_pseudo_statut', { p_pseudo: autre })).data, 'reserve', 'sosie par squelette');
assert.equal((await B.rpc('bal_reserver', { p_pseudo: pseudo, p_mdp: 'secret1' })).data.error, 'pris');
assert.equal((await B.rpc('bal_reserver', { p_pseudo: autre, p_mdp: 'secret1' })).data.error, 'pris', 'sosie refusé');

// 1 lu l, 0 lu o : « zz1ab… » et « zzlab… » sont le même pseudo
const n5 = String(Math.floor(Math.random() * 1e5)).padStart(5, '2');
const chiffre = 'zz1ab' + n5;
assert.equal((await A.rpc('bal_reserver', { p_pseudo: chiffre, p_mdp: 'secret1' })).data.ok, true);
assert.equal((await B.rpc('bal_pseudo_statut', { p_pseudo: 'zzlab' + n5 })).data, 'reserve', 'sosie chiffre');
assert.equal((await B.rpc('bal_reserver', { p_pseudo: 'zzlab' + n5, p_mdp: 'secret1' })).data.error, 'pris');
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: pseudo })).data, 'reserve', 'A est maintenant lié au second profil');
await A.rpc('bal_connecter', { p_pseudo: pseudo, p_mdp: 'secret1' });   // A revient sur le premier

// Profil et vérification
assert.deepEqual((await A.rpc('bal_mon_profil')).data, { pseudo, avatar: '02' });
assert.equal((await B.rpc('bal_mon_profil')).data, null);
assert.deepEqual((await B.rpc('bal_profil_de', { p_uid: A.uid })).data, { pseudo, avatar: '02' });
assert.equal((await A.rpc('bal_profil_de', { p_uid: B.uid })).data, null);

// Connexion : mauvais mots de passe, blocage par appareil
assert.equal((await B.rpc('bal_connecter', { p_pseudo: 'inconnu' + pseudo, p_mdp: 'x' })).data.error, 'inconnu');
for (let i = 0; i < 5; i++) assert.equal((await B.rpc('bal_connecter', { p_pseudo: pseudo, p_mdp: 'faux' + i })).data.error, 'mdp');
assert.equal((await B.rpc('bal_connecter', { p_pseudo: pseudo, p_mdp: 'secret1' })).data.error, 'bloque', 'B bloqué même avec le bon mot de passe');
const c = (await C.rpc('bal_connecter', { p_pseudo: pseudo, p_mdp: 'secret1' })).data;
assert.deepEqual(c, { ok: true, pseudo, avatar: '02' }, 'C n\'est pas bloqué par les échecs de B');
assert.equal((await A.rpc('bal_connecter', { p_pseudo: pseudo, p_mdp: 'nimportequoi' })).data.ok, true, 'appareil lié jamais bloqué');

// Avatar
const photo = 'data:image/webp;base64,' + 'A'.repeat(300);
assert.equal((await A.rpc('bal_changer_avatar', { p_avatar: photo })).data.ok, true);
assert.equal((await C.rpc('bal_mon_profil')).data.avatar, photo, 'profil partagé entre appareils liés');
assert.equal((await A.rpc('bal_changer_avatar', { p_avatar: 'javascript:alert(1)' })).data.error, 'avatar');
assert.equal((await A.rpc('bal_changer_avatar', { p_avatar: 'data:image/svg+xml;base64,AAAA' })).data.error, 'avatar');
assert.equal((await B.rpc('bal_changer_avatar', { p_avatar: '03' })).data.error, 'non_connecte');

// Déconnexion
await A.rpc('bal_deconnecter');
assert.equal((await A.rpc('bal_pseudo_statut', { p_pseudo: pseudo })).data, 'reserve');
assert.equal((await A.rpc('bal_mon_profil')).data, null);

// Aucun accès direct aux tables
for (const t of ['bal_profils', 'bal_liens', 'bal_echecs']) {
  const res = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { apikey: KEY, authorization: 'Bearer ' + B.jeton } });
  assert.ok(res.status === 401 || res.status === 403 || res.status === 404, `${t} lisible : ${res.status}`);
}
// Sans connexion : les fonctions refusent
const anon = await fetch(`${URL}/rest/v1/rpc/bal_pseudo_statut`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ p_pseudo: 'abcd' }) });
assert.ok(anon.status >= 400, 'anon refusé : ' + anon.status);

console.log('profils E2E OK, pseudo de test :', pseudo);
