import { chargerCoups } from './reseau.js';

// Réabonne le canal après retour d'onglet ou coupure réseau, renvoie les coups locaux
// en attente et rejoue les coups journalisés depuis le seq local.
export class Reconnexion {
  constructor(reseau, partie, { onStatut } = {}) {
    this.reseau = reseau;
    this.partie = partie;
    this.onStatut = onStatut;
    this.enCours = null;
    this.essais = 0;
    this.minuteur = 0;
    this.surVisibilite = () => { if (document.visibilityState === 'visible') this.resynchroniser(); };
    this.surEnLigne = () => this.resynchroniser();
    this.surHorsLigne = () => this.onStatut?.('hors-ligne');
  }

  brancher() {
    document.addEventListener('visibilitychange', this.surVisibilite);
    window.addEventListener('online', this.surEnLigne);
    window.addEventListener('offline', this.surHorsLigne);
  }

  detacher() {
    document.removeEventListener('visibilitychange', this.surVisibilite);
    window.removeEventListener('online', this.surEnLigne);
    window.removeEventListener('offline', this.surHorsLigne);
    clearTimeout(this.minuteur);
  }

  // Appelé par main.js sur un statut de canal en erreur.
  signalerPanne() {
    clearTimeout(this.minuteur);
    const delai = Math.min(15000, 1000 * 2 ** this.essais);
    this.essais++;
    this.minuteur = setTimeout(() => this.resynchroniser(), delai);
  }

  resynchroniser() {
    if (this.reseau.ferme) return Promise.resolve();
    if (!this.enCours) {
      this.enCours = this.executer().finally(() => { this.enCours = null; });
    }
    return this.enCours;
  }

  async executer() {
    this.onStatut?.('reconnexion');
    try {
      await this.reseau.ouvrir();
      await this.reseau.vider();
      const p = this.partie;
      const coups = await chargerCoups(this.reseau.partie.id, p.journal.length);
      for (const c of coups) p.recevoirCoup(c);
      this.essais = 0;
      this.onStatut?.('ok');
    } catch {
      this.onStatut?.('hors-ligne');
      this.signalerPanne();
    }
  }
}
