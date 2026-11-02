# Balote Club

Pétanque tour par tour, mobile d'abord, vue 3D isométrique, lancer en cloche : solo contre le club
(3 niveaux, 3 ou 6 boules, 3 terrains : lisse, terre, gravier) ou duel à distance (3 boules), ou à deux sur le même téléphone. Site 100 % statique (HTML, CSS, modules ES natifs), hébergé sur GitHub Pages ;
le duel passe par Supabase (auth anonyme, Postgres, Realtime).

## Lancer en local

```bash
python tools/serveur.py 8737
```

Puis ouvrir `http://localhost:8737/`. Le solo fonctionne sans aucune configuration.

## Mettre en place le duel (Supabase)

1. **Créer un projet** sur [supabase.com](https://supabase.com) (ou réutiliser un projet
   existant : les tables s'appellent `parties` et `coups`).
2. **Exécuter le schéma** : *SQL Editor* → coller le contenu de `supabase/schema.sql` → *Run*.
   Le script est rejouable (création idempotente, policies et fonctions remplacées).
3. **Activer l'auth anonyme** : *Authentication* → *Sign In / Providers* →
   *Allow anonymous sign-ins*.
4. **Renseigner `js/config.js`** : `SUPABASE_URL` (*Project Settings* → *API*) et
   `SUPABASE_ANON_KEY` (clé `anon` ou `publishable`).

> La clé `anon` / `publishable` est **publique par conception** : elle part dans le
> navigateur de chaque joueur. La sécurité repose sur les policies RLS du schéma.
> Ne jamais mettre la clé `service_role` dans ce dépôt.

Ce que le schéma garantit :

- RLS active sur `parties` et `coups` ;
- lecture d'une partie réservée à ses membres ; un salon ne se rejoint qu'avec son code exact ;
- insertion d'un coup réservée aux membres, avec `auteur = auth.uid()`, seulement pour une partie `en_cours` et seulement au prochain `seq` ;
- le canal broadcast n'est qu'un signal : les clients n'appliquent que les coups du journal dont l'auteur est l'équipe au tour ;
- index unique `(partie_id, seq)` : un coup en double est rejeté par le serveur ;
- `creer_partie()` tire le code et la graine côté serveur ;
- `rejoindre_partie(code)` refuse l'auto-jointure et accepte un seul invité, avec un message explicite si le salon est plein, terminé ou inexistant.

## Publier sur GitHub Pages

1. Pousser le dépôt sur GitHub, branche `main`.
2. *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`.
3. Le fichier **`.nojekyll` doit rester à la racine** : sans lui, Jekyll ignore certains
   fichiers et les modules peuvent ne pas être servis.

Tous les chemins sont relatifs, le site fonctionne donc aussi sous `https://<user>.github.io/<repo>/`.

## Architecture

| Fichier | Rôle |
|---|---|
| `js/core/physique.js` | Physique déterministe : pas fixe 1/120 s, table sinus calculée par série, ordre d'itération fixe |
| `js/core/partie.js` | Règles (mènes, tour, points, cochonnet sorti) et boucle de coup ; reconstruction depuis le journal |
| `js/core/bot.js` | Bot : simule des coups candidats puis ajoute une erreur gaussienne selon le niveau |
| `js/net/reseau.js` | Auth anonyme, salons, journal `coups`, broadcast `partie:<id>` |
| `js/net/reconnexion.js` | Réabonnement et rattrapage des coups après retour d'onglet ou coupure |
| `js/ui/vue3d.js` | Caméra en hauteur pivotée de 35°, décor (herbe, haies, arbres, piste), volumes, ombres, courbe du lancer |
| `js/ui/perso.js` | Joueurs en volumes simples, vus de dos, poses du lancer |
| `js/ui/matieres.js` | Textures (terre battue), sprites de boules, particules et traces |
| `js/ui/rendu.js` | Canvas, DPR ≤ 2, gestes et clavier, animation du lancer |

Lockstep : seuls l'angle (centièmes de degré, entier) et la puissance (millièmes) d'un
coup transitent. Chaque client simule le même résultat ; aucune position n'est transmise.

## Tests

```bash
node tests/physique.test.mjs   # trigonométrie, portée, empreinte de référence
node tests/duel.test.mjs       # deux clients en mémoire + reprise depuis le journal
```

**Déterminisme iOS / Android (critère 5)** : ouvrir `tests/determinisme.html` sur chaque
appareil et comparer l'empreinte affichée. Valeur de référence (Node 24, Chromium) :
`63f0c7d5`, scores 2–5 à la mène 6.

## Assets

- Visuels et avatars : générés en local (ComfyUI, SDXL), puis encodés par
  `tools/optimiser.sh <sources>` (ffmpeg : WebP, AVIF, duotone, contrôle des budgets).
- Sons : synthétisés par `python tools/sons.py <sortie>`, puis encodés par `optimiser.sh`.
- Polices : Instrument Serif et Inter Tight (licence OFL), sous-ensemble latin, auto-hébergées.
