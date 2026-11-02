#!/usr/bin/env bash
# Encode les visuels et les sons sources vers assets/ (WebP, AVIF, OGG, MP3) et vérifie les budgets.
# Dépendance unique : ffmpeg (libwebp, libaom-av1, libvorbis, libmp3lame).
#
# Usage : tools/optimiser.sh <dossier_sources>
#   <dossier_sources>/hero.png, ambiance.png      visuels d'accueil (portrait)
#   <dossier_sources>/avatar-01.png … avatar-06.png  portraits carrés, sujet centré
#   <dossier_sources>/audio/*.wav                 sons mono courts
set -euo pipefail

SRC="${1:?usage: tools/optimiser.sh <dossier_sources>}"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$RACINE/assets/img"
AV="$RACINE/assets/avatars"
AUD="$RACINE/assets/audio"
mkdir -p "$IMG" "$AV" "$AUD"
FF=(ffmpeg -hide_banner -loglevel error -y)

taille() { stat -c %s "$1"; }

# Encode une image en largeur donnée, ratio 4:5, sujet centré haut.
encoder_visuel() {
  local src="$1" nom="$2" l="$3" qwebp="$4" crf="$5"
  local h=$(( l * 5 / 4 ))
  # Débruitage léger : le grain est rendu par l'overlay CSS, pas porté par l'image.
  local vf="crop='min(iw,ih*4/5)':'min(ih,iw*5/4)':'(iw-min(iw,ih*4/5))/2':0,hqdn3d=8:6:0:0,scale=${l}:${h}:flags=lanczos"
  "${FF[@]}" -i "$src" -vf "$vf" -c:v libwebp -quality "$qwebp" -compression_level 6 "$IMG/$nom-$l.webp"
  "${FF[@]}" -i "$src" -vf "$vf,format=yuv420p" -c:v libaom-av1 -still-picture 1 -crf "$crf" -cpu-used 4 "$IMG/$nom-$l.avif"
}

for l in 720 1080 1440; do encoder_visuel "$SRC/hero.png" hero "$l" 34 40; done
for l in 720 1080; do encoder_visuel "$SRC/ambiance.png" ambiance "$l" 30 44; done

# Avatars : 256², duotone terre cuite (ombres espresso → hautes lumières crème cuivrée).
DUO="format=gray,format=rgb24,lutrgb=r='26+val*(244-26)/255':g='18+val*(190-18)/255':b='15+val*(150-15)/255'"
for i in 01 02 03 04 05 06; do
  "${FF[@]}" -i "$SRC/avatar-$i.png" \
    -vf "crop='iw*0.78':'iw*0.78':'iw*0.11':'ih*0.04',scale=256:256:flags=lanczos,$DUO" \
    -c:v libwebp -quality 82 -compression_level 6 "$AV/$i.webp"
done

# Sons : mono 44,1 kHz, normalisés à −16 LUFS.
if [ -d "$SRC/audio" ]; then
  for f in "$SRC"/audio/*.wav; do
    n="$(basename "$f" .wav)"
    "${FF[@]}" -i "$f" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ac 1 -ar 44100 -c:a libvorbis -q:a 2 "$AUD/$n.ogg"
    "${FF[@]}" -i "$f" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k "$AUD/$n.mp3"
  done
fi

# Budgets
echo "--- Budgets"
erreur=0
verifier() { # fichier limite libellé
  local t; t=$(taille "$1")
  if [ "$t" -gt "$2" ]; then echo "DÉPASSÉ  $3 : $t > $2 octets"; erreur=1; else echo "ok       $3 : $t octets"; fi
}
verifier "$IMG/hero-1080.avif" 143360 "hero 1080 avif (≤140 Ko)"
verifier "$IMG/hero-1080.webp" 143360 "hero 1080 webp (≤140 Ko)"
total_av=0; for f in "$AV"/*.webp; do total_av=$(( total_av + $(taille "$f") )); done
[ "$total_av" -le 92160 ] && echo "ok       avatars : $total_av octets" || { echo "DÉPASSÉ  avatars : $total_av > 92160"; erreur=1; }
total_aud=0
for f in "$AUD"/*.ogg "$AUD"/*.mp3; do
  [ -e "$f" ] || continue
  t=$(taille "$f"); total_aud=$(( total_aud + t ))
  [ "$t" -le 20480 ] || { echo "DÉPASSÉ  $(basename "$f") : $t > 20480"; erreur=1; }
done
echo "info     audio (ogg+mp3) : $total_aud octets"
for f in "$RACINE"/assets/*/*; do
  [ "$(taille "$f")" -le 204800 ] || { echo "DÉPASSÉ  $(basename "$f") > 200 Ko"; erreur=1; }
done
total=0; for f in "$RACINE"/assets/*/*; do total=$(( total + $(taille "$f") )); done
echo "info     total assets : $total octets"
exit $erreur
