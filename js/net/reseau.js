import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS } from '../config.js';

// supabase-js est chargé à la demande : le solo ne télécharge rien de plus.
let client = null;

export function enLigneDisponible() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Stockage de session explicite : la même identité anonyme survit au rechargement.
// Si le stockage est bloqué, supabase-js retombe sur une session en mémoire.
function stockageSession() {
  try { return globalThis.localStorage || undefined; } catch { return undefined; }
}

async function sb() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'balote.auth', storage: stockageSession() },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

function verifier({ data, error }) {
  if (error) throw new Error(error.message || 'Erreur réseau');
  return data;
}

// Auth anonyme : la session est réutilisée après rechargement de l'onglet.
export async function connexion() {
  const c = await sb();
  const { data } = await c.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const res = verifier(await c.auth.signInAnonymously());
  return res.user.id;
}

// Profils (supabase/profils.sql) : chaque appel passe par une fonction serveur, jamais par une table.
async function appel(nom, args) {
  await connexion();
  const c = await sb();
  return verifier(await c.rpc(nom, args));
}
export const pseudoStatut = (pseudo) => appel('bal_pseudo_statut', { p_pseudo: pseudo });
export const reserverPseudo = (pseudo, mdp, avatar) => appel('bal_reserver', { p_pseudo: pseudo, p_mdp: mdp, p_avatar: avatar ?? null });
export const connecterPseudo = (pseudo, mdp) => appel('bal_connecter', { p_pseudo: pseudo, p_mdp: mdp });
export const deconnecterPseudo = () => appel('bal_deconnecter', {});
export const monProfil = () => appel('bal_mon_profil', {});
export const changerAvatar = (avatar) => appel('bal_changer_avatar', { p_avatar: avatar });
export const profilDe = (uid) => appel('bal_profil_de', { p_uid: uid });

const unique = (d) => (Array.isArray(d) ? d[0] : d);

export async function creerSalon() {
  const c = await sb();
  return unique(verifier(await c.rpc('creer_partie')));
}

export async function rejoindre(code) {
  const c = await sb();
  return unique(verifier(await c.rpc('rejoindre_partie', { p_code: code.toUpperCase() })));
}

export async function chargerPartie(code) {
  const c = await sb();
  return verifier(await c.from('parties').select('*').eq('code', code.toUpperCase()).maybeSingle());
}

export async function chargerCoups(partieId, depuis = 0) {
  const c = await sb();
  return verifier(await c.from('coups')
    .select('seq, angle, puissance, auteur')
    .eq('partie_id', partieId)
    .gte('seq', depuis)
    .order('seq', { ascending: true }));
}

// Transport d'une partie. Le canal broadcast `partie:<id>` est public : n'importe qui
// connaissant l'id peut y émettre. Ses messages ne sont donc que des signaux ; les coups
// appliqués viennent uniquement du journal `coups` (auteur garanti par RLS), via
// postgres_changes ou une relecture déclenchée par le signal.
export class Reseau {
  constructor(partie, uid, { onCoup, onSignal, onAbandon, onProfil, onArrivee, onEtat } = {}) {
    this.partie = partie;
    this.uid = uid;
    this.cb = { onCoup, onSignal, onAbandon, onProfil, onArrivee, onEtat };
    this.canal = null;
    this.enAttente = [];
    this.ferme = false;
  }

  async ouvrir() {
    const c = await sb();
    if (this.canal) await c.removeChannel(this.canal);
    const id = this.partie.id;
    this.canal = c.channel('partie:' + id, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'coup' }, () => this.cb.onSignal?.())
      .on('broadcast', { event: 'abandon' }, () => this.verifierAbandon())
      .on('broadcast', { event: 'profil' }, ({ payload }) => this.cb.onProfil?.(payload))
      .on('broadcast', { event: 'arrivee' }, ({ payload }) => this.cb.onArrivee?.(payload))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'coups', filter: 'partie_id=eq.' + id },
        ({ new: ligne }) => { if (ligne.auteur !== this.uid) this.cb.onCoup?.(ligne); })
      .subscribe((statut) => this.cb.onEtat?.(statut));
    return this.canal;
  }

  diffuser(event, payload) {
    if (!this.canal) return;
    this.canal.send({ type: 'broadcast', event, payload }).catch(() => { /* rattrapé par le journal */ });
  }

  // Journalise puis diffuse. En cas d'échec, le coup reste en file et sera renvoyé.
  async envoyerCoup(coup) {
    this.enAttente.push(coup);
    await this.vider();
  }

  // Un seul envoi à la fois : les renvois (reconnexion) ne doublent pas les insertions.
  vider() {
    this.envoi = (this.envoi || Promise.resolve()).catch(() => false).then(() => this.envoyerFile());
    return this.envoi;
  }

  async envoyerFile() {
    const c = await sb();
    while (this.enAttente.length) {
      const coup = this.enAttente[0];
      const { error } = await c.from('coups').insert({
        partie_id: this.partie.id, auteur: this.uid,
        seq: coup.seq, angle: coup.angle, puissance: coup.puissance,
      });
      // Refus après une coupure : le coup peut déjà être journalisé (23505, ou 42501 car
      // le seq n'est plus le prochain attendu). S'il est bien à nous, il est livré.
      if (error && !(await this.dejaJournalise(c, coup.seq))) {
        this.derniereErreur = error;
        return false;
      }
      this.enAttente.shift();
      this.diffuser('coup', { seq: coup.seq });
    }
    return true;
  }

  async dejaJournalise(c, seq) {
    const { data } = await c.from('coups').select('auteur')
      .eq('partie_id', this.partie.id).eq('seq', seq).maybeSingle();
    return data?.auteur === this.uid;
  }

  // Un abandon n'est cru que si le serveur l'a enregistré (RPC réservée aux membres).
  async verifierAbandon() {
    try {
      const c = await sb();
      const { data } = await c.from('parties').select('statut').eq('id', this.partie.id).maybeSingle();
      if (data?.statut === 'abandon') this.cb.onAbandon?.();
    } catch { /* on réessaiera au prochain signal */ }
  }

  envoyerProfil(profil) { this.diffuser('profil', profil); }
  annoncerArrivee(profil) { this.diffuser('arrivee', profil); }

  async abandonner() {
    await this.cloturer('abandon');
    this.diffuser('abandon', {});
  }

  async cloturer(statut) {
    try {
      const c = await sb();
      await c.rpc('cloturer_partie', { p_id: this.partie.id, p_statut: statut });
    } catch { /* statut indicatif seulement */ }
  }

  async quitter() {
    this.ferme = true;
    if (this.canal) {
      const c = await sb();
      await c.removeChannel(this.canal);
      this.canal = null;
    }
  }
}

// Point d'accroche anti-triche v2 : re-simulation serveur via une Edge Function
// `valider_partie` (non implémentée en v1). Appelée en fin de partie, sans effet bloquant.
export async function demanderValidation(partieId) {
  void partieId;
  return { valide: null };
}
