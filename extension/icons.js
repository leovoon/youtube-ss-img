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
  // Crop icon: corner brackets
  'crop': 'M2 4h2V2h2v2h4V2h2v2h2v2h-2v4h2v2h-2v2H8v-2H6v2H4v-2H2v-2h2V6H2zM6 6v4h4V6z',
  // Duplicate: two overlapping rectangles
  'duplicate': 'M2 2h7v2H4v5H2zM6 6h8v8H6zm2 2v4h4V8z',
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

/** Minimal geometric empty-state illustration — Swiss/forest design tone.
 *  Stacked frames motif with the forest accent at various opacities. */
export function emptyStateArt(size = 80) {
  const w = size;
  const h = Math.round(size * 0.75);
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 120 90" aria-hidden="true" focusable="false" style="display:block;margin:0 auto 12px">` +
    // Back frame (most faded)
    `<rect x="30" y="4" width="68" height="44" rx="2" fill="none" stroke="#2D6A4F" stroke-width="1.5" opacity="0.20"/>` +
    // Middle frame
    `<rect x="22" y="18" width="68" height="44" rx="2" fill="none" stroke="#2D6A4F" stroke-width="1.5" opacity="0.40"/>` +
    // Front frame (full accent)
    `<rect x="14" y="32" width="68" height="44" rx="2" fill="rgba(45,106,79,0.08)" stroke="#2D6A4F" stroke-width="1.5" opacity="0.70"/>` +
    // Mountain scene inside front frame
    `<path d="M24 66 L42 48 L54 58 L68 42 L72 66Z" fill="#2D6A4F" opacity="0.15"/>` +
    // Subtle plus icon (add frame cue)
    `<line x1="98" y1="50" x2="98" y2="62" stroke="#2D6A4F" stroke-width="1.5" opacity="0.35" stroke-linecap="round"/>` +
    `<line x1="92" y1="56" x2="104" y2="56" stroke="#2D6A4F" stroke-width="1.5" opacity="0.35" stroke-linecap="round"/>` +
    `</svg>`
  );
}
