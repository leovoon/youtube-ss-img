// Pixel-art icon set. Each icon is defined as an SVG path string on a 16x16
// grid, rendered with shape-rendering:crispEdges for a chunky retro look.
// fill=currentColor so buttons control color via CSS.

const PATHS = {
  // Camera body with lens
  capture: 'M5 2h6v2h3v10H2V4h3zM6 8a2 2 0 104 0 2 2 0 00-4 0z',
  // Play triangle (chunky)
  play: 'M4 3h2v10H4zM6 4h2v8H6zM8 5h2v6H8zM10 6h2v4h-2z',
  // Stop square
  stop: 'M3 3h10v10H3z',
  // Download arrow into tray
  download: 'M7 2h2v5h2l-3 4-3-4h2zM2 12h12v2H2z',
  // Refresh / reset (chunky circular arrow)
  reset: 'M4 3h5v2H6v1H4zM3 5h2v4H3zM11 4h2v5h-2zM4 11h5v-2h3v1h-1v2H6v-1H4zM11 9h2v2h-2z',
  // Swap / toggle type (two opposing arrows)
  swap: 'M2 4h9v2H2zM9 2h2v2H9zM9 6h2v2H9zM5 10h9v2H5zM5 8h2v2H5zM5 12h2v2H5z',
  // Arrow up (chevron)
  up: 'M7 3h2v10H7zM5 5h2v2H5zM9 5h2v2H9zM3 7h2v2H3zM11 7h2v2h-2z',
  // Arrow down (chevron)
  down: 'M7 3h2v10H7zM5 9h2v2H5zM9 9h2v2H9zM3 7h2v2H3zM11 7h2v2h-2z',
  // Pencil / edit
  edit: 'M11 2h3v3l-2 2-3-3zM8 5l3 3-6 6H2v-3z',
  // X / remove (clean diagonal cross)
  remove: 'M3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM11 11h2v2h-2zM11 3h2v2h-2zM9 5h2v2H9zM5 9h2v2H5zM3 11h2v2H3z',
  // Trash can
  trash: 'M5 2h6v2H5zM3 4h10v2H3zM4 6h8v8H4zm2 2h1v5H6zm3 0h1v5H9z',
  // Upload: arrow up out of a tray
  upload: 'M7 2h2v6h2l-3 4-3-4h2zM2 12h12v2H2z',
  // Picture with a plus badge — adding an existing image, not uploading.
  'image-add': 'M2 3h9v10H2zM3 4v7h7V4zM4 9l2-2 1 1 1-1 1 3zM12 2h2v2h2v2h-2v2h-2V6h-2V4h2z',
  // Text size: small 'A' beside a larger 'A'
  'text-size': 'M2 11h2l1-2h2l1 2h2L7 4H5zM5.5 5l1 3h-2zM9 12h3l1.5-3h3L18 12h3l-4-9h-2zM14.5 4l2 4h-3z',
  // Plus / minus steppers (caption size)
  plus: 'M7 2h2v5h5v2H9v5H7V9H2V7h5z',
  minus: 'M2 7h12v2H2z',
  // Magnifier (plain lens + handle) for the frame peek affordance
  magnifier: 'M2 2h6v1H2zM2 7h6v1H2zM2 3h1v4H2zM7 3h1v4H7zM8 8h1v1H8zM9 9h1v1H9zM10 10h1v1h-1zM11 11h1v1h-1zM12 12h1v1h-1zM13 13h1v1h-1z',
  // Sparkle / studio
  studio: 'M7 2h2v3H7zM7 11h2v3H7zM2 7h3v2H2zM11 7h3v2h-3zM4 4h2v2H4zM10 10h2v2h-2zM10 4h2v2h-2zM4 10h2v2H4z',
  // Keyframe: full picture frame with a mountain/scene inside
  keyframe: 'M2 3h12v10H2zm2 2v6h8V5zm1 4l2-2 1 1 2-3 1 4z',
  // Subtitle band: picture frame with a highlighted caption bar at the bottom
  subtitle: 'M2 3h12v10H2zm1 1v5h10V4zm2 6h6v2H5z',
  // Zoom in: magnifier with plus
  'zoom-in': 'M6 2a5 5 0 013.9 8.1l3 3-1.4 1.4-3-3A5 5 0 116 2zm-1 3v2H3v2h2v2h2V9h2V7H7V5z',
  // Zoom out: magnifier with minus
  'zoom-out': 'M6 2a5 5 0 013.9 8.1l3 3-1.4 1.4-3-3A5 5 0 116 2zM3 5v2h6V5z',
  // Fit / reset view: expand-to-fit corners
  fit: 'M2 2h4v2H4v2H2zm8 0h4v4h-2V4h-2zM2 10h2v2h2v2H2zm10 0h2v4h-4v-2h2z',
  // Jump to top: double chevron up with a bar
  'jump-top': 'M2 2h12v2H2zM7 5h2v7H7zM5 7h2v2H5zM9 7h2v2H9zM3 9h2v2H3zM11 9h2v2h-2z',
  // Jump to bottom: double chevron down with a bar
  'jump-bottom': 'M2 12h12v2H2zM7 4h2v7H7zM5 7h2v2H5zM9 7h2v2H9zM3 5h2v2H3zM11 5h2v2h-2z',
  // Arrow up (single chevron, compact)
  'arrow-up': 'M7 3h2v8H7zM5 5h2v2H5zM9 5h2v2H9zM3 7h2v2H3zM11 7h2v2h-2z',
  // Arrow down (single chevron, compact)
  'arrow-down': 'M7 5h2v8H7zM5 9h2v2H5zM9 9h2v2H9zM3 7h2v2H3zM11 7h2v2h-2z',
};

/**
 * Return an inline SVG string for a named pixel icon.
 * @param {string} name key of PATHS
 * @param {number} size pixel size (default 14)
 */
export function icon(name, size = 14) {
  const d = PATHS[name];
  if (!d) return '';
  return (
    `<svg class="pixi" width="${size}" height="${size}" viewBox="0 0 16 16" ` +
    `aria-hidden="true" focusable="false" ` +
    `style="shape-rendering:crispEdges;image-rendering:pixelated">` +
    `<path d="${d}" fill="currentColor"/></svg>`
  );
}

/** Wrap a label with a leading icon for button innerHTML. */
export function iconLabel(name, label, size = 14) {
  return `${icon(name, size)}<span class="btxt">${label}</span>`;
}

/** Decorate any elements in the document that declare data-icon="name". */
export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    const svg = icon(name, Number(el.getAttribute('data-icon-size')) || 14);
    if (!svg) return;
    const label = el.textContent.trim();
    el.innerHTML = label ? `${svg}<span class="btxt">${label}</span>` : svg;
    el.classList.add('has-icon');
  });
}

/** A small chinchilla illustration (vector, flat palette) used in empty states. */
export function chinchilla(size = 104) {
  const h = Math.round(size * (130 / 120));
  return (
    `<svg class="chin" width="${size}" height="${h}" viewBox="0 0 120 130" aria-hidden="true" focusable="false">` +
    // Bushy tail curling up behind the body
    `<path d="M72 102 Q106 108 97 70 Q92 50 77 53 Q68 56 71 65" fill="none" stroke="#7c8699" stroke-width="16" stroke-linecap="round"/>` +
    `<path d="M72 102 Q106 108 97 70 Q92 50 77 53 Q68 56 71 65" fill="none" stroke="#aab2c2" stroke-width="8" stroke-linecap="round"/>` +
    // Body + belly
    `<ellipse cx="58" cy="97" rx="31" ry="27" fill="#9aa4b6"/>` +
    `<ellipse cx="58" cy="101" rx="18" ry="16" fill="#eef2f8"/>` +
    // Feet
    `<ellipse cx="44" cy="121" rx="7" ry="4" fill="#727c91"/>` +
    `<ellipse cx="72" cy="121" rx="7" ry="4" fill="#727c91"/>` +
    // Head + cheek puffs
    `<circle cx="36" cy="64" r="8" fill="#9aa4b6"/>` +
    `<circle cx="80" cy="64" r="8" fill="#9aa4b6"/>` +
    `<circle cx="58" cy="56" r="26" fill="#9aa4b6"/>` +
    // Ears
    `<circle cx="40" cy="34" r="9" fill="#9aa4b6"/>` +
    `<circle cx="76" cy="34" r="9" fill="#9aa4b6"/>` +
    `<circle cx="40" cy="35" r="4.5" fill="#f3b4c0"/>` +
    `<circle cx="76" cy="35" r="4.5" fill="#f3b4c0"/>` +
    // Whiskers
    `<path d="M34 60 L22 58 M34 64 L22 65 M82 60 L94 58 M82 64 L94 65" stroke="#cbd2de" stroke-width="1.1" stroke-linecap="round"/>` +
    // Eyes + highlights
    `<circle cx="49" cy="55" r="3.6" fill="#2a2f3d"/>` +
    `<circle cx="67" cy="55" r="3.6" fill="#2a2f3d"/>` +
    `<circle cx="50.3" cy="53.6" r="1.2" fill="#ffffff"/>` +
    `<circle cx="68.3" cy="53.6" r="1.2" fill="#ffffff"/>` +
    // Nose + mouth
    `<path d="M58 62 q-3 0 -3 3 q0 3 3 4 q3 -1 3 -4 q0 -3 -3 -3z" fill="#f3b4c0"/>` +
    `<path d="M58 69 q-2.2 2 -4.4 1 M58 69 q2.2 2 4.4 1" stroke="#727c91" stroke-width="1.1" fill="none" stroke-linecap="round"/>` +
    `</svg>`
  );
}
