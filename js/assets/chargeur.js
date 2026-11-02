import { AVATARS } from '../config.js';
import { DECOR } from '../ui/decor-atlas.js';
import { poserAtlasDecor } from '../ui/vue3d.js';

// Précharge polices, visuel d'accueil et avatars avec une progression réelle.
// Aucun atlas : chaque fichier est indépendant et mis en cache par le navigateur.
function chargerImage(src) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error('Échec : ' + src));
    img.src = src;
  });
}

function heroSource() {
  const img = document.querySelector('.hero img');
  return img ? (img.currentSrc || img.src) : null;
}

export function charger(onProgression) {
  const taches = [];
  if (document.fonts?.load) {
    taches.push(() => document.fonts.load('400 1em "Instrument Serif"'));
    taches.push(() => document.fonts.load('600 1em "Inter Tight"'));
  }
  taches.push(() => {
    const src = heroSource();
    return src ? chargerImage(src) : Promise.resolve();
  });
  // Atlas du décor : en cas d'échec, le décor reste celui dessiné en code.
  taches.push(() => chargerImage(`${DECOR.image}?v=${DECOR.v}`).then((img) => poserAtlasDecor(DECOR, img), () => {}));
  for (const a of AVATARS) taches.push(() => chargerImage(`assets/avatars/${a}.webp`));

  let faits = 0;
  onProgression?.(0);
  return Promise.all(taches.map((t) => t().then(() => {
    faits++;
    onProgression?.(faits / taches.length);
  })));
}

// Le visuel d'ambiance n'est pas sur le chemin critique : posé en fond après le boot.
export function poserAmbiance() {
  const l = window.innerWidth * Math.min(2, window.devicePixelRatio || 1) > 800 ? 1080 : 720;
  const base = `assets/img/ambiance-${l}`;
  for (const el of document.querySelectorAll('.fond-ambiance')) {
    el.style.backgroundImage = `url("${base}.webp")`;
    el.style.backgroundImage = `image-set(url("${base}.avif") type("image/avif"), url("${base}.webp") type("image/webp"))`;
  }
}
