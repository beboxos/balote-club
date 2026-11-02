// Règles de profil partagées entre le jeu et ses tests. Le serveur (supabase/profils.sql) reste
// l'autorité : ces contrôles ne servent qu'à répondre vite, sans aller-retour réseau.
import { AVATARS } from '../config.js';

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 14;
export const MDP_MIN = 8;
export const AVATAR_MAX = 20000;   // caractères d'une photo encodée

const INTERDITS = /(merde|pute|connard|connasse|salope|encule|nique|fdp|batard|nazi|hitler|fuck|shit|bitch|cunt|nigg|dick|pussy|asshole|whore|porn)/;
const PHOTO = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/;

export function pseudoValide(p) {
  const s = String(p ?? '').trim();
  if (s.length < PSEUDO_MIN || s.length > PSEUDO_MAX) return false;
  if (!/^[A-Za-z0-9ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ _.-]+$/.test(s)) return false;
  const nu = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return !INTERDITS.test(nu);
}

// Un avatar est un portrait du jeu (« 01 ») ou une petite photo encodée en data URL.
export function avatarValide(a) {
  if (typeof a !== 'string') return false;
  if (AVATARS.includes(a)) return true;
  return a.length <= AVATAR_MAX && PHOTO.test(a);
}

export function avatarSrc(id) {
  return typeof id === 'string' && id.startsWith('data:') && avatarValide(id) ? id : `assets/avatars/${AVATARS.includes(id) ? id : '01'}.webp`;
}
