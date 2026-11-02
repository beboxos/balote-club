"""Synthèse des 8 sons du jeu en WAV mono 44,1 kHz (encodés ensuite par optimiser.sh).

Usage : python tools/sons.py <dossier_sortie>
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def t(duree):
    return np.arange(int(SR * duree)) / SR


def env(x, attaque, decroissance):
    tt = np.arange(len(x)) / SR
    a = np.clip(tt / max(attaque, 1e-4), 0, 1)
    return x * a * np.exp(-tt / decroissance)


def bruit_filtre(n, coupure):
    b = rng.standard_normal(n)
    # passe-bas simple à un pôle
    alpha = np.exp(-2 * np.pi * coupure / SR)
    y = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc = (1 - alpha) * b[i] + alpha * acc
        y[i] = acc
    return y / (np.abs(y).max() + 1e-9)


def impact_boule():
    x = t(0.28)
    s = sum(a * np.sin(2 * np.pi * f * x) for f, a in [(2140, 1), (3390, 0.7), (5230, 0.45), (7810, 0.25)])
    s = env(s, 0.0005, 0.045)
    clic = env(rng.standard_normal(len(x)), 0.0002, 0.004) * 0.8
    return s + clic


def impact_jack():
    x = t(0.14)
    s = np.sin(2 * np.pi * 920 * x) + 0.5 * np.sin(2 * np.pi * 1630 * x)
    return env(s, 0.0005, 0.025) + env(rng.standard_normal(len(x)), 0.0002, 0.003) * 0.4


def lancer():
    x = t(0.5)
    n = bruit_filtre(len(x), 1800)
    forme = np.sin(np.pi * np.clip(x / 0.5, 0, 1)) ** 1.5
    grain = (rng.random(len(x)) > 0.985) * rng.standard_normal(len(x)) * 0.6
    return (n * 0.8 + grain) * forme


def chute():
    x = t(0.35)
    s = np.sin(2 * np.pi * (95 - 40 * x) * x)
    return env(s, 0.002, 0.08) + env(bruit_filtre(len(x), 600), 0.001, 0.05) * 0.6


def ui_valide():
    x = t(0.12)
    s = np.sin(2 * np.pi * 1320 * x) * (x < 0.05) + np.sin(2 * np.pi * 1760 * x) * (x >= 0.05)
    return env(s, 0.001, 0.04) * 0.6


def note(f, duree, dec=0.25):
    x = t(duree)
    s = np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * 2 * f * x) + 0.12 * np.sin(2 * np.pi * 3 * f * x)
    return env(s, 0.003, dec)


def enchainer(freqs, ecart, duree_note, dec):
    total = int(SR * (ecart * (len(freqs) - 1) + duree_note))
    out = np.zeros(total)
    for i, f in enumerate(freqs):
        n = note(f, duree_note, dec)
        d = int(SR * ecart * i)
        out[d:d + len(n)] += n
    return out


def victoire():
    return enchainer([523.25, 659.25, 783.99, 1046.5], 0.11, 0.6, 0.22)


def defaite():
    return enchainer([440.0, 392.0, 329.63], 0.16, 0.55, 0.25)


def jauge():
    x = t(0.045)
    return env(np.sin(2 * np.pi * 2400 * x), 0.0005, 0.01) * 0.5


SONS = {
    'impact-boule': impact_boule, 'impact-jack': impact_jack, 'lancer': lancer, 'chute': chute,
    'ui-valide': ui_valide, 'victoire': victoire, 'defaite': defaite, 'jauge': jauge,
}


def ecrire(chemin, s):
    s = s / (np.abs(s).max() + 1e-9) * 0.9
    fondu = min(len(s), int(SR * 0.01))
    s[-fondu:] *= np.linspace(1, 0, fondu)
    with wave.open(str(chemin), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((s * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    sortie = Path(sys.argv[1])
    sortie.mkdir(parents=True, exist_ok=True)
    for nom, f in SONS.items():
        ecrire(sortie / f'{nom}.wav', f())
        print('ok', nom)
