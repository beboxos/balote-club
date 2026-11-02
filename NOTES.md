# Écarts par rapport à la spécification v1

| § | Spécification | Réalisation | Justification |
|---|---|---|---|
| 5 | Table `Float32Array(720)` « pré-calculée au chargement » | Table remplie par **série de Taylor** (`+ - * /` seulement), avec interpolation linéaire entre les entrées | Remplie avec `Math.sin`, la table ne serait pas garantie identique au bit près entre JavaScriptCore et V8. L'interpolation évite un pas de 0,5° qui décalerait le tir d'environ une demi-boule en fond de terrain. |
| 5, 8 | `angle float8` | Angle **quantifié en centièmes de degré** (entier 0–35999), puissance en millièmes, avant envoi et avant simulation | Les deux clients simulent exactement la même entrée, quelle que soit la précision du geste. |
| 7 | `lancer(…, puissance)` | Vitesse = `V_MAX × √puissance` | La portée (∝ v²) devient linéaire au geste : la plage utile passe d'environ 10 % à environ 25 % de la course du doigt. La puissance reste proportionnelle au geste, comme demandé. |
| 3.6 | « Boule sortie du terrain (marge 40) » | La piste jouable est le rectangle intérieur `[40, 320] × [40, 600]` ; une boule dont le centre en sort est morte | Interprétation de la marge comme bande hors-jeu. Elle garde la piste entière visible sous l'échelle « cover ». |
| 3 | Non spécifié | Point de lancer fixe `(180, 566)` ; cochonnet tiré de la graine serveur dans `x ∈ [100, 260]`, `y ∈ [80, 200]` ; ouverture : rouge (l'hôte) à la mène 1, puis l'équipe qui a marqué ; cochonnet sorti : mène rejouée avec un nouveau tirage et le même ouvreur | Choix validés avant l'implémentation. Une équipe sans boule vivante est « la plus éloignée » (distance infinie). En égalité parfaite de fin de mène, personne ne marque. |
| 7 / 9.4 | `audio.js` : un audio-sprite / 9.4 : fichiers séparés | **Fichiers séparés** (OGG ou MP3 selon le support), décodés une fois en `AudioBuffer` au premier geste | La 9.4 est plus précise et justifiée (8 sons courts). |
| 6 | Arborescence imposée | En plus : `tests/` (tests Node + page de déterminisme), `tools/serveur.py` (serveur local sans cache), `tools/sons.py` (synthèse des sons), `NOTES.md` | Outillage de vérification ; rien de cela n'est chargé par le jeu. |
| 7 | Événements `coup` et `abandon` | En plus : `profil` (pseudo et avatar) et `arrivee` (l'invité prévient l'hôte), plus un abonnement `postgres_changes` sur `coups` | Il faut afficher le nom de l'adversaire. L'hôte doit démarrer sans attendre son sondage de 3 s. Le journal sert de filet si un broadcast se perd ; les doublons sont écartés par `seq`. |
| 8 | Schéma « exactement » | En plus : RPC `cloturer_partie(id, statut)`, index **unique** `(partie_id, seq)` et `grant` explicites (`select` sur `parties`, `select, insert` sur `coups` pour `authenticated`, rien pour `anon`) | Sans policy `update`, il fallait une RPC pour passer une partie en `fin` ou `abandon`. L'unicité rejette côté serveur un coup dupliqué. Les projets Supabase récents n'accordent plus de droits table par défaut : sans ces `grant`, la lecture et l'insertion échouaient malgré les policies. |
| 8 | `seed bigint` | Graine tirée sur 31 bits | Le nombre reste exact en JavaScript (sous 2^53) et identique sur tous les clients. |
| 11 | `user-scalable=no` | **Retiré** du viewport | Contradiction avec le critère 14.8 : Lighthouse pénalise `user-scalable=no` en accessibilité (94 avec, 100 sans), et iOS Safari l'ignore depuis iOS 10. Le zoom involontaire reste neutralisé par `touch-action: none` sur le canvas, `touch-action: manipulation` sur les boutons et des champs en 16 px. |
| 9.5 | `inter-tight-latin-400.woff2` et `-600.woff2` | Les deux fichiers sont livrés, mais un seul `@font-face` (`font-weight: 400 600`) les remplace | Google Fonts sert Inter Tight en police variable : les deux fichiers sont identiques à l'octet près. Les charger tous les deux coûtait 45 Ko pour rien. |
| 9.6 | Total assets ≤ 700 Ko | Un client télécharge environ 330 Ko d'assets (une variante par image, un format audio). Toutes variantes confondues, le dossier fait environ 1,3 Mo | Le budget est lu comme poids transféré par client. AVIF et WebP × 3 largeurs dépasseraient sinon 700 Ko à eux seuls. |
| 9.3 | Hero : « trois boules et un cochonnet » | Le visuel généré montre davantage de boules, recadrées sur le haut | Meilleur rendu parmi quatre générations SDXL. À régénérer si le nombre exact compte. |
| 10 | Boutons ≥ 58 px | Boutons d'action à 58 px ; icônes (son, quitter) à 44–48 px | Le bandeau du bas doit laisser le cercle de lancer visible sur 375 × 667. 44 px reste au-dessus du minimum WCAG. |
| 8 | Lecture « limitée aux membres (ou salon en attente) » | Lecture **limitée aux membres** ; on ne rejoint qu'avec le code exact, via la RPC | Revue de sécurité : sinon, n'importe quel joueur anonyme pouvait lister tous les salons ouverts et leur graine, puis les rejoindre avant l'invité prévu. |
| 7, 12 | Transport par broadcast `partie:<id>` (`coup`, `abandon`) | Le broadcast n'est plus qu'un **signal**. Un coup n'est appliqué que s'il vient du journal `coups` (auteur garanti par RLS) **et** que son auteur est l'équipe au tour. Un abandon n'est cru que si `parties.statut = 'abandon'` côté serveur. Côté serveur, `seq` doit valoir le prochain numéro (`prochain_seq`) | Revue de sécurité : le canal broadcast est public. Quiconque connaît l'id pouvait injecter un faux coup ou un faux abandon. Le coût est une lecture du journal en plus par coup. |
| 12 | Score recalculé depuis le journal | En fin de mène, le score affiché vient de `rejouer(graine, journal)`, et non de l'état en mémoire | Conforme. Le point d'accroche `demanderValidation()` (Edge Function `valider_partie`) est prévu dans `reseau.js`, sans implémentation. |

## Évolutions après la v1 (retour de jeu)

| Sujet | Avant | Maintenant | Justification |
|---|---|---|---|
| Vue | Terrain vu du dessus (ressemblait à un billard) | Caméra en perspective derrière le lanceur, ciel, haie, arbres, terre battue, planches de bordure | Retour de jeu : la vue du dessus ne faisait pas pétanque. La physique reste en 2D (x, y) et n'est pas touchée : seul l'affichage projette les positions. |
| Joueurs | Aucun | Deux personnages en blocs (style Minecraft), vus de dos. Celui dont c'est le tour se tient au cercle, l'autre à côté | Lire le geste : bras en arrière selon la puissance pendant la visée, puis balancier et lâcher. |
| Départ de la boule | Immédiat | Après le geste (environ 0,4 s). L'animation ne change pas la physique : elle retarde seulement le départ, de la même façon sur les deux appareils | Synchroniser la boule avec la main du joueur. La boule suit un petit arc visuel (hauteur) pendant son vol. |
| Viseur | Trait de longueur arbitraire | Ligne au sol jusqu'au point d'arrêt estimé (puissance × 585 unités, sans choc) | Doser la force à l'œil. |
| Boules par joueur | 4 | 3 par défaut, 2, 3 ou 4 au choix en solo | Les duels restent à 3 : le nombre de boules n'est pas stocké côté serveur (pas de changement de schéma). |
| Taille à l'écran | Taille réelle | Boules ×1,2, cochonnet ×2,2, joueurs à 62 % | Au fond de la piste, les rayons réels tombent à quelques pixels. |

L'empreinte de référence de `tests/determinisme.html` (`af2de690`) valait pour la v1 ; la cloche l'a changée (voir plus bas).

## Retour de jeu n° 2 : cloche, difficulté, vue en hauteur

| Sujet | Avant | Maintenant | Justification |
|---|---|---|---|
| Lancer | Boule qui roule en ligne droite dès le départ | Cloche : vol sans frottement, impact (35 % de la vitesse conservée), puis roulement. Pendant le vol, la boule ne touche personne. Portée totale linéaire en la puissance (≈ 560 unités à puissance 1) | Retour de jeu : le lancer droit n'est pas de la pétanque. La hauteur et l'ombre au sol décalée rendent la cloche lisible. |
| Difficulté | Un réticule indiquait le point d'arrêt : il suffisait de le poser sur la cible | Plus de point d'arrivée affiché : un trait court donne la direction, un anneau montre la force. Le joueur dose à l'œil | Retour de jeu : la partie était gagnée d'avance. |
| Dispersion | Aucune | Chaque lancer est perturbé (écart-type de 0,45° et de 2,2 % de portée), tiré de la graine du serveur et du numéro du lancer. Les deux appareils obtiennent donc le même résultat | Un joueur n'est jamais parfaitement précis. L'arithmétique est entière, donc le résultat reste identique d'un appareil à l'autre. |
| Boules par joueur | 3 par défaut, 2 à 4 au choix | 3 ou 6 au choix en solo (duels à 3) | Retour de jeu. |
| Vue | Perspective basse derrière le lanceur | Caméra en hauteur, tangage 50°, terrain entier visible avec herbe, haies et arbres autour. Les joueurs restent animés | Retour de jeu : vue de dessus de type isométrique, comme la référence. Le glissement du doigt est corrigé de l'écrasement vertical. |

La référence de `tests/determinisme.html` change avec la nouvelle physique : voir la valeur affichée par `node tests/physique.test.mjs`.

## Retour de jeu n° 3 : courbe visible, vue iso, deux joueurs

| Sujet | Avant | Maintenant | Justification |
|---|---|---|---|
| Courbe du lancer | Aucune indication d'arrivée | Pendant la visée : courbe en pointillés de la main au point de chute, trace au sol dessous, anneau d'impact. Seule la phase en l'air est montrée : ni le rebond ni le roulement | Retour de jeu : sans indication, on ne sait plus où la boule tombe. Le roulement après impact (≈ 48 unités à pleine puissance) et la dispersion restent à deviner, donc la difficulté demeure. |
| Vue | Caméra en hauteur, axée sur le terrain | Même caméra pivotée de 35° (type isométrique), cadrée automatiquement sur la piste et les joueurs | Retour de jeu. La piste est plaquée par triangles texturés et les volumes n'affichent que leurs faces visibles. Le glissement du doigt est converti en direction du terrain selon la rotation. |
| Deux joueurs | Solo ou duel en ligne | Mode « 2 joueurs, un téléphone » : chacun joue à son tour, un écran « Au tour de X, passez le téléphone » apparaît quand le tour change de joueur et le jeu attend le bouton Prêt | Demande de l'utilisateur. Aucun réseau ni bot ; 3 ou 6 boules au choix, comme en solo. |

## Retour de jeu n° 4 : terrains, cailloux, cochonnet lancé

- **Le terrain roulait trop peu** : le roulement après l'atterrissage est maintenant réglé par un sol (`SOLS` dans `physique.js`). Lisse et Terre (défaut) : frottement 260, rebond 0,5 (le réglage validé en jeu, environ 3,6 fois plus de roulement qu'avant) ; seuls les cailloux les distinguent. Gravier : 380 et 0,45. Le choix est dans le menu (solo et deux joueurs). Le duel en ligne reste sur « terre » : le sol n'est pas dans le schéma Supabase.
- **Cailloux** : semés à chaque mène depuis la graine (`semerCailloux`) : 0 sur lisse, 5 sur terre, 12 sur gravier. Un objet qui roule sur un caillou est dévié de 3 à 9° du côté opposé, freiné de 5 %, une seule fois par caillou et par déplacement. Même résultat sur les deux appareils (arithmétique simple, masque de bits dans `o.cai`).
- **Cochonnet** : le premier joueur de chaque mène le lance (c'est un coup du journal, `phase === 'cochonnet'`), puis lance aussi la première boule. Le geste 0..1 est étalé sur 330 à 450 unités : ni trop près, ni trop loin, l'angle restant libre. Sorti du terrain, il est relancé, et posé d'office après deux lancers nuls.
- **Taille du cochonnet** : rendu réduit de 30 % (facteur 2,2 → 1,54). Le rayon physique ne change pas.
- Le portée n'est plus une constante : `portee(sol)`. Empreinte de référence recalculée : `b2d3e572`, 1–5 à la mène 5.
- Non vérifié : ressenti réel du roulement et des cailloux au toucher, équilibrage du bot sur les nouveaux sols, duel entre deux navigateurs avec le lancer du cochonnet.

### Ajustements suivants

- **Cailloux plus marqués** : déviation de 8 à 18° (avant 3 à 9°), perte de vitesse 10 %, zone de contact élargie, 7 cailloux sur Terre.
- **Points pour gagner** : 5 ou 13 au menu (solo et deux joueurs), `BUTS_CHOIX` dans `partie.js`. Le duel en ligne reste à 5. Empreinte de référence : `b2d3e572`.

## Retour de jeu n° 5 : sons, réglages du terrain

- **Sons au sol** : un choc `atterri` est émis à chaque atterrissage (poum sourd + craquement de grains selon le sol, `audio.atterrir`), un roulement continu suit la boule la plus rapide (`audio.rouler`, bruit filtré), les chocs entre boules sont plus audibles (seuil 12, volume relevé) et un tic léger signale un caillou. Atterrissage et roulement sont synthétisés en WebAudio ; le « tac » entre boules (`impact-boule`) a été refait plus sec et métallique dans `tools/sons.py` (le premier, trop aigu et résonnant, sonnait comme du verre). Les chocs ne sont pas dans l'empreinte.
- **Réglages** (engrenage du menu) : roulage Lisse (frottement 200) < Terre (260) < Gravier (380) ; cailloux de 0 à 100 % (`nombreCailloux`, 30 % = 7, max 24), indépendants du sol ; longueur Normal / Long / Très long (`LONGUEURS`, terrain de 640 / 780 / 920 ; 640 est le minimum). La distance du cochonnet et la portée totale sont multipliées par 1 / 1,3 / 1,6 : le vol d'une boule étant borné, c'est le roulage qui s'allonge (`frottementEffectif`, frottement divisé pour que `portee(sol)` = k × la portée normale). La caméra se redresse avec la longueur (tangage 50° → 59°, rotation 35° → 18°, `angles` dans `vue3d.js`) pour que le terrain entier garde la même taille à l'écran. `fixerLongueur` modifie `TERRAIN.h` et `LANCER.y` à la création du `Moteur` ; la caméra pivote au milieu du terrain et le rendu refait décor et joueurs quand la hauteur change.
- Le duel en ligne reste sur Terre, 30 % et longueur normale (rien de plus dans le schéma). Empreinte de référence inchangée : `b2d3e572`.
- Non vérifié : écoute réelle sur téléphone (niveaux relatifs mesurés à l'analyseur seulement), lisibilité du terrain long sur petit écran.

- **Bot dosé sur terrain long** (retour : « l'ordinateur joue trop fort ») : mesure bot contre bot, 13 % de boules sorties au fond sur terrain long contre 3 % sur terrain normal, surtout des tirs ratés (une petite erreur d'angle à 600 unités fait manquer la cible et la boule file dehors). Corrections dans `bot.js` : chaque coup est jugé sur son pire cas (tel quel, 5 % trop fort, dévié d'un écart de visée à gauche ou à droite), le surplus de puissance des tirs se règle en distance (÷ k) et l'erreur du bot est ramenée à une erreur absolue comparable (÷ k, trop fort moins fréquent que trop court). Résultat : 1 % et 0 % de sorties sur long et très long, `tests/bot.test.mjs`. Les duels bot (tests) changent de scores, la physique et l'empreinte de référence non.

## Retour de jeu n° 6 : musiques d'ambiance

- **Six pistes chill** dans `js/ui/musique.js` (Terrasse, Fin d'après-midi, Cigales, Sous les platanes, Pastis, Crépuscule), synthétisées en Web Audio, sans fichier : pad, basse, comping (accords / arpège / pluck), mélodie pentatonique tirée d'une graine par passage (jamais deux tours identiques), batterie légère lofi ou bossa, écho en croche pointée. Séquenceur à planification en avance (tempo exact même thread occupé).
- **Réglages** : curseur de volume (40 % par défaut, coupé avec le bouton son) et choix « enchaînement automatique » (une piste dure 10 passages, ≈ 2 min) ou une piste fixe. La musique démarre au premier geste (politique d'autoplay).
- Niveaux égalisés piste par piste (RMS ≈ 0,06 à 100 %, mesuré à l'analyseur dans Chrome) avec `vol` ; non écoutées par moi : le rendu musical (goût, mixage) reste à juger à l'oreille, les mélodies sont aléatoires dans la gamme.

## Retour de jeu n° 7 : décor en sprites

- **Atlas Gemini** : une planche de 16 accessoires (platane, peuplier, olivier, fruitier, buissons, haie, lavande, banc, tables, fontaine, lampadaire, caisse de boules, muret, géraniums) générée dans Gemini (prompt dans `atlas/PROMPT_DECOR_GEMINI.md`, source `atlas/decor1.jpeg`), détourée et réduite par `python tools/slice_decor.py build` en `assets/decor/decor.webp` (220 Ko) + `js/ui/decor-atlas.js`.
- **Rendu** : `sprites()` dans `vue3d.js` pose les sprites au sol (ancrés par leur pied, taille en unités du terrain, triés du fond vers l'avant, petite ombre) hors des haies, plus lampadaires, jardinières et pots dans la bande d'herbe ; l'emplacement suit la longueur du terrain (`DECOR_PLAN`). Le décor est repeint une fois l'atlas chargé (`Rendu.rafraichirDecor`) ; sans atlas, les anciens arbres dessinés en code reviennent.
- **Boules d'acier** (idée du joueur) : `spriteBoule` dessine un corps chromé (reflet du ciel en haut, sol sombre en bas, spéculaire) ; l'équipe se lit à une fine bande gravée (orange / bleu, deux filets sombres autour) et à un halo coloré posé au sol sous chaque boule (`haloSol` dans `vue3d.js`, couleurs `HALO` dans `matieres.js`). À juger au jeu : si le repère manque de lisibilité de loin, augmenter l'alpha du halo (0,5 dans `rendu.js`).

## Retour de jeu n° 8 : pseudos réservés et portraits

- **Modèle** : on joue sans compte avec un pseudo libre ; « Mon profil » (clic sur le portrait) permet de réserver son pseudo avec un mot de passe (6 caractères minimum, bcrypt côté serveur, non récupérable), de retrouver un pseudo réservé sur un autre appareil et de choisir un des 6 portraits ou sa photo (carré 128 px, WebP ou JPEG, ≤ 18 000 caractères, stockée dans la ligne du profil : pas de Storage). Un pseudo réservé est refusé à tout autre joueur, sosies compris (squelette : sans accents, espaces ni `_ . -`).
- **Serveur** : `supabase/profils.sql` (appliqué le 2026-11-02 sur le projet mot-a-mot, additif, tout en `bal_*`) : tables `bal_profils`, `bal_liens` (identité anonyme de l'appareil → profil), `bal_echecs`, aucune policy, aucun droit direct ; tout passe par des fonctions `security definer` (`bal_pseudo_statut`, `bal_reserver`, `bal_connecter`, `bal_deconnecter`, `bal_mon_profil`, `bal_changer_avatar`, `bal_profil_de`).
- **Duel** : l'adversaire qui a un profil est affiché avec le pseudo et le portrait du serveur (`bal_profil_de`, d'après son identité de salon), jamais d'après ce qu'il annonce ; un pseudo annoncé invalide (caractères exotiques) ou réservé par un autre s'affiche « Adversaire ».
- **Revue de sécurité (traitée, deux passes)** : blocage de connexion par appareil (5 échecs = 15 min pour cet appareil seulement, un appareil déjà lié n'est jamais bloqué) ; les plafonds globaux (40 échecs/heure par pseudo, 30 réservations/heure) ont été retirés car n'importe qui pouvait les atteindre pour bloquer les autres ; alphabet limité aux lettres que le squelette sait normaliser (donc ni cyrillique ni Ø, Æ, ß, Þ, Ý…) et 0/1 lus o/l dans le squelette ; 3 réservations par appareil. **Limite connue** : une identité anonyme se recrée sans effort, donc l'anti-squat et le freinage des essais de mots de passe à identités multiples reposent en dernier ressort sur la limite d'inscriptions anonymes par IP de Supabase (Authentication, Rate Limits) et, si besoin, un captcha (Attack Protection).
- Tests : `tests/profil.test.mjs` (règles), `tests/profils.e2e.mjs` (33 contrôles contre le vrai serveur : sosies, blocage par appareil, profils partagés, avatars invalides, tables inaccessibles). Purge des profils de test : `delete from public.bal_profils where pseudo ~ '^zz';` dans l'éditeur SQL.
- Non vérifié : duel entre deux navigateurs avec profils (les fonctions serveur le sont, pas l'enchaînement complet côté jeu) ; photo prise sur un vrai téléphone.

## Vérifié

- Solo complet (navigateur, 375 × 667) : partie menée jusqu'à l'écran de fin, aucune erreur console.
- `tests/duel.test.mjs` : deux clients lockstep reliés en mémoire, doublons de livraison ignorés, coup hors tour refusé, coup hors séquence ignoré, scores et empreintes identiques.
- Empreinte de référence identique sous Node et Chromium mobile (v1 : `af2de690`).
- Lighthouse mobile (serveur local, sans compression) : performance 94, accessibilité 100, 323 Ko au premier rendu, aucune 404.
- Aucun `TODO`, `FIXME`, `console.log` ; aucun chemin absolu ; aucune fonction interdite dans `physique.js`.

### Duel réel sur Supabase (projet mot-a-mot, 2026-11-02)

Deux clients Node exécutent les vrais `reseau.js`, `reconnexion.js`, `partie.js` et `bot.js`. Un navigateur joue face à un client Node.

- **Critère 2** : duel complet hôte contre invité, scores 7–3 et empreinte `7b34e3c6` identiques des deux côtés.
- **Critère 3** :
  - L'invité est coupé à 14 coups puis relancé. Il garde la même identité anonyme, lit le journal (14 coups), se resynchronise et finit identique.
  - Côté navigateur, l'hôte est rechargé (`?p=CODE`) après 6 coups. Il reprend la partie et finit à 0–5 avec l'empreinte `50b08a9b`, comme l'invité.
- **Attaques** : un membre qui envoie un `seq` hors séquence est refusé (42501). Un coup déjà pris par l'adversaire est refusé. Un salon en attente est invisible pour un tiers. Des broadcasts `coup` et `abandon` forgés par un intrus n'ont aucun effet sur la partie. Le renvoi d'un coup déjà journalisé est reconnu comme livré.
- **Critère 4** : un troisième client anonyme ne voit ni la partie ni les coups, son insertion de coup est refusée par RLS, et `rejoindre` répond « Salon plein ». Un code inconnu répond « Salon inexistant ».

## Non vérifié

- Vue 3D : contrôlée dans le navigateur intégré à 375 × 667 (parties solo complètes à 3 et 4 boules, poses du lancer). Pas encore sur de vrais téléphones ni sur d'autres formats d'écran.
- Mode 2 joueurs : parties complètes jouées par script (24 lancers, 11 passages de téléphone, écran de fin « X gagne »). Le passage réel du téléphone entre deux personnes n'a pas été essayé.
- Le geste du doigt dans la vue 3D (glisser vers l'arrière) n'a été exercé qu'au clavier et par appel direct, pas au toucher.

- Critère 5 sur de vrais iPhone et Android : à faire avec `tests/determinisme.html`.
- Duel entre deux navigateurs pilotés à la main : le parcours a été couvert par un navigateur face à un client Node, pas par deux navigateurs.
- **Tour de jeu non imposé par le serveur** : un membre peut journaliser un coup au prochain `seq` alors que c'est à l'adversaire de jouer. Les clients le rejettent (mauvais auteur), mais ce `seq` reste bloqué et la partie se fige. L'effet est le même qu'un abandon, et seul un membre de la partie peut le faire. Pour imposer le tour côté serveur, il faut connaître les distances, donc re-simuler la physique : c'est le rôle de l'Edge Function `valider_partie` prévue en v2.
