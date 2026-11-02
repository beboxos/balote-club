# Prompt décor Balote Club (Gemini, « Créer une image », format 1:1)

Planche d'accessoires de boulodrome de village, vus en plongée à ~50° (comme la vue du jeu),
lumière chaude venant du haut à gauche, fond vert #00FF00 uni (découpé ensuite par tools/slice_decor.py).

```
Sprite sheet of 16 props for a cozy French village pétanque court, stylized soft 3D clay-render look,
smooth shapes, warm natural palette (olive and sage greens, terracotta, cream stone, honey wood),
soft shading, subtle outlines. Every object is seen from a HIGH 3/4 ANGLE (about 50 degrees from above,
slightly rotated), standing upright on its own base, light from the upper left, a small soft contact shadow
directly under each object only.

LAYOUT (an automatic tool cuts the objects out):
- Background: ONE flat solid chroma green #00FF00 everywhere. No gradient, no floor, no cast shadow on the
  background, no checkerboard. That green is used nowhere in the artwork.
- Grid of 4 rows x 4 columns, at least 60 px of empty green between objects, never touching or overlapping.
- No frames, no grid lines, no numbers, no captions, no text.
- Objects drawn at their natural relative scale inside a row.

Row 1 (trees): a big round plane tree, a tall slim poplar, a twisted olive tree, a small round fruit tree.
Row 2 (greenery): a round clipped bush, a flowering pink oleander bush, a long low hedge segment, a lavender planter.
Row 3 (furniture): a wooden park bench, a round cafe table with two chairs, a picnic table with a striped parasol, a stone drinking fountain.
Row 4 (props): a cast-iron street lamp, a wooden crate full of petanque boules, a low stone wall segment, a terracotta flower pot with geraniums.
Export as PNG.
```
