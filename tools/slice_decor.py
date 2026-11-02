#!/usr/bin/env python3
"""Découpe les planches d'accessoires (fond vert #00FF00) en sprites et en atlas WebP + JS.

Usage : python tools/slice_decor.py probe            # objets détectés + planche de contrôle (atlas/_probe/)
        python tools/slice_decor.py build            # écrit assets/decor/decor.webp + js/ui/decor-atlas.js

Pipeline : détourage du vert (dé-spill des franges JPEG) -> objets par composantes connexes ->
tri en lecture (lignes puis colonnes) -> rognage -> réduction à l'échelle du jeu -> atlas unique.
Outil de développement (Pillow, numpy, scipy) : le jeu n'a aucune dépendance.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / 'assets' / 'decor' / 'decor.webp'
OUT_JS = ROOT / 'js' / 'ui' / 'decor-atlas.js'
SONDE = ROOT / 'atlas' / '_probe'
ECHELLE = 0.45          # planche 2048 px -> sprites à l'échelle du jeu (≈ 1,7 px d'écran par unité)
MIN_AIRE = 4000         # px² : en dessous, bruit JPEG
LIGNES = 4

# Planche -> noms, dans l'ordre de lecture (ligne par ligne).
PLANCHES = [
    {
        'fichier': 'atlas/decor1.jpeg',
        'noms': ['platane', 'peuplier', 'olivier', 'fruitier',
                 'buisson', 'laurier', 'haie', 'lavande',
                 'banc', 'table-cafe', 'table-parasol', 'fontaine',
                 'lampadaire', 'caisse-boules', 'muret', 'geraniums'],
    },
]


def detourer(chemin):
    """Image RGB -> RGBA : le vert devient transparent, les franges sont dé-spillées."""
    rgb = np.asarray(Image.open(ROOT / chemin).convert('RGB')).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    vert = g - np.maximum(r, b)                 # « verdeur » : grande sur le fond, nulle ailleurs
    alpha = np.clip(1.0 - (vert - 25.0) / 70.0, 0.0, 1.0)
    # Dé-spill : sur les pixels semi-transparents, le vert est ramené au niveau du plus fort des autres canaux.
    plafond = np.maximum(r, b)
    g2 = np.where(alpha < 1.0, np.minimum(g, plafond + 8), g)
    rgba = np.dstack([r, g2, b, alpha * 255.0]).clip(0, 255).astype(np.uint8)
    return rgba


def objets(rgba):
    """Composantes connexes de l'alpha, triées en lecture. Retourne [(boîte, masque)]."""
    masque = rgba[..., 3] > 128
    ferme = ndimage.binary_closing(masque, iterations=3)
    etiquettes, n = ndimage.label(ferme)
    trouves = []
    for i, sl in enumerate(ndimage.find_objects(etiquettes), start=1):
        aire = int((etiquettes[sl] == i).sum())
        if aire < MIN_AIRE:
            continue
        trouves.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, i))
    # Lecture : regroupe par lignes selon le bas de l'objet (même ligne de base), puis par x.
    trouves.sort(key=lambda o: o[3])
    hauteur_ligne = max(1, len(trouves) // LIGNES)
    lignes = [trouves[k:k + hauteur_ligne] for k in range(0, len(trouves), hauteur_ligne)]
    ordre = []
    for ligne in lignes:
        ordre.extend(sorted(ligne, key=lambda o: o[0]))
    return ordre, etiquettes


def decouper(planche):
    rgba = detourer(planche['fichier'])
    ordre, etiquettes = objets(rgba)
    return rgba, ordre, etiquettes


def sonde():
    SONDE.mkdir(parents=True, exist_ok=True)
    for planche in PLANCHES:
        rgba, ordre, _ = decouper(planche)
        print(planche['fichier'], '->', len(ordre), 'objets (attendus', len(planche['noms']), ')')
        for (x0, y0, x1, y1, _), nom in zip(ordre, planche['noms']):
            print(f'  {nom:14s} {x1 - x0:4d}x{y1 - y0:<4d} en ({x0},{y0})')
        fond = Image.new('RGBA', (rgba.shape[1], rgba.shape[0]), (60, 40, 70, 255))
        fond.alpha_composite(Image.fromarray(rgba, 'RGBA'))
        fond.convert('RGB').save(SONDE / (Path(planche['fichier']).stem + '_sonde.png'))


def construire():
    sprites = []
    for planche in PLANCHES:
        rgba, ordre, etiquettes = decouper(planche)
        if len(ordre) != len(planche['noms']):
            sys.exit(f"{planche['fichier']} : {len(ordre)} objets détectés pour {len(planche['noms'])} noms (voir probe)")
        for (x0, y0, x1, y1, idx), nom in zip(ordre, planche['noms']):
            sub = rgba[y0:y1, x0:x1].copy()
            # Ne garde que l'objet : les voisins pris dans la boîte sont effacés.
            sub[etiquettes[y0:y1, x0:x1] != idx, 3] = 0
            im = Image.fromarray(sub, 'RGBA')
            w = max(1, round(im.width * ECHELLE))
            h = max(1, round(im.height * ECHELLE))
            # Alpha prémultiplié avant réduction : pas de liseré vert ni noir sur les bords.
            arr = np.asarray(im).astype(np.float32)
            a = arr[..., 3:4] / 255.0
            pre = Image.fromarray(np.dstack([arr[..., :3] * a, arr[..., 3:4]]).astype(np.uint8), 'RGBA')
            pre = pre.resize((w, h), Image.LANCZOS)
            p = np.asarray(pre).astype(np.float32)
            aa = p[..., 3:4] / 255.0
            rgb = np.where(aa > 0.01, p[..., :3] / np.maximum(aa, 0.01), 0)
            out = np.dstack([rgb, p[..., 3:4]]).clip(0, 255).astype(np.uint8)
            sprites.append((nom, Image.fromarray(out, 'RGBA')))

    # Atlas : rayonnage simple, largeur fixe.
    largeur = 1024
    x = y = ligne_h = 0
    pos = {}
    for nom, im in sorted(sprites, key=lambda s: -s[1].height):
        if x + im.width + 2 > largeur:
            x, y, ligne_h = 0, y + ligne_h + 2, 0
        pos[nom] = (x, y, im.width, im.height)
        x += im.width + 2
        ligne_h = max(ligne_h, im.height)
    hauteur = y + ligne_h + 2
    atlas = Image.new('RGBA', (largeur, hauteur), (0, 0, 0, 0))
    for nom, im in sprites:
        atlas.paste(im, pos[nom][:2])
    OUT_IMG.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_IMG, 'WEBP', quality=88, alpha_quality=95, method=6)
    data = {nom: {'x': p[0], 'y': p[1], 'w': p[2], 'h': p[3]} for nom, p in pos.items()}
    OUT_JS.write_text(
        '// Généré par tools/slice_decor.py : ne pas modifier à la main.\n'
        f"export const DECOR = {{ image: 'assets/decor/decor.webp', v: 1, l: {largeur}, h: {hauteur}, sprites: {json.dumps(data, ensure_ascii=False)} }};\n",
        encoding='utf-8')
    print('atlas', atlas.size, OUT_IMG.stat().st_size, 'octets,', len(data), 'sprites')


if __name__ == '__main__':
    {'probe': sonde, 'build': construire}.get(sys.argv[1] if len(sys.argv) > 1 else '', lambda: sys.exit(__doc__))()
