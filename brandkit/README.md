# SMRDefense Brandkit

Master logo assets, color tokens, and type rules. Source of truth — every surface (web, deck, social, print) should pull from here.

## Files

### Source
| File | Description |
|---|---|
| `SMRD-Logo-Dark.png` | Original master from Nick (silver wolf-shield on dark navy, 1280×1280) — kept as the immutable source. |
| `SMRD-Logos-Variations.png` | Original variations sheet from Nick — kept for reference. |

### Mark — transparent, high-resolution
Cleaned via Replicate pipeline (BiRefNet → Recraft Crisp Upscale → BiRefNet → connected-component cleanup). True alpha, no halos, no ghosts.

| File | Size | Use |
|---|---|---|
| `SMRD-Logo-Mark-master-4096.png` | 2926×2926 (master) | Print, large display, source for any further export |
| `SMRD-Logo-Mark-1024.png` | 1024×1024 | Hi-DPI web, social, app icon |
| `SMRD-Logo-Mark-512.png` | 512×512 | Standard web header / card |
| `SMRD-Logo-Mark-256.png` | 256×256 | Nav-bar, small UI |

### Favicons
| File | Size | Use |
|---|---|---|
| `SMRD-Logo-Favicon-32.png` | 32×32 | Browser tab |
| `SMRD-Logo-Favicon-64.png` | 64×64 | Browser tab (hi-DPI) |
| `SMRD-Logo-Favicon-180.png` | 180×180 | Apple touch icon |

### Composites (mark on background — when you can't use transparency)
| File | Size | Use |
|---|---|---|
| `SMRD-Logo-on-Dark-1024.png` | 1024×1024 | Square thumbnails, dark surfaces, app/store icon |
| `SMRD-Open-Graph-1200x630.png` | 1200×630 | OG card / Twitter card / link previews |

### Lockups (mark + wordmark)
| File | Use |
|---|---|
| `SMRD-Lockup-Dark.svg` | For dark surfaces. Wordmark uses silver→steel-blue gradient. |
| `SMRD-Lockup-Light.svg` | For light surfaces. Wordmark uses navy gradient. |

> The SVGs reference `SMRD-Logo-Mark-512.png` for the mark — keep them in the same folder when embedding.

---

## Color tokens (deck palette)

| Role | Hex | Notes |
|---|---|---|
| `--ink` (deepest) | `#04070d` | Page-edge background, footers |
| `--bg` | `#070b14` | Default page background |
| `--panel` | `#0e1524` | Cards, sections |
| `--panel-2` | `#131c30` | Hover state on panels |
| `--signal-deep` | `#1a3554` | Primary CTA gradient bottom |
| `--signal` | `#5a7fa8` | Steel blue (deck) |
| `--signal-bright` | `#8aa6c4` | Silver-blue (logo gradient mid) — kickers, accents, bullets |
| `--accent` | `#c8d6e6` | Lightest brand silver — highlights |
| `--text` | `#ffffff` | Primary text on dark |
| `--muted` | `#c7d2e0` | Secondary text on dark |
| `--dim` | `#8a99b0` | Tertiary / metadata |

The mark itself uses a vertical gradient: `#c8d6e6 → #a8bccd → #5a7fa8` (top → mid → bottom).

---

## Type

- **Display & body**: Roboto, weights 400 / 500 / 600 / 700
- **Mono / kicker**: Roboto Mono, weights 400 / 500
- Headlines: weight 600–700, letter-spacing −0.025em
- Kickers / eyebrows / labels: Roboto Mono, weight 600, letter-spacing 0.16em, UPPERCASE, color `--signal-bright`

---

## Usage rules

1. **On dark surfaces** (`--bg`, `--panel`, `--ink`) → use the transparent mark (`SMRD-Logo-Mark-*.png`) directly. The silver gradient reads cleanly.
2. **On light surfaces** → use `SMRD-Lockup-Light.svg`, which switches the wordmark to navy. The mark itself stays silver — there is no separate "navy mark" file because the silver still reads on white at small sizes.
3. **Minimum size** for the mark alone: 24px. Below that, hairlines start to soften.
4. **Clear-space**: leave at least the height of the wolf's ear ("E") around the mark on all sides.
5. **Don't**: recolor the mark, add effects (glow, drop-shadow at small sizes, embossing), stretch non-uniformly, or place on busy photos. If you need it on a photo, use the dark composite.

---

## Pipeline (how the master was generated)

Source: Nick's `SMRD-Logo-Dark.png` (1280×1280, silver wolf-shield on solid dark navy).

1. **Upload** to Replicate Files API → returns a CDN URL.
2. **`men1scus/birefnet`** (Bilateral Reference Net, A100, ~1.5s, ~$0.003) — strips the navy background, preserves sub-pixel alpha on hairlines.
3. **`recraft-ai/recraft-crisp-upscale`** (~8s, ~$0.05) — 4× upscale tuned for vector/illustration art, no smearing of geometric edges. *Note: kills alpha — it returns RGB-on-white.*
4. **`men1scus/birefnet` again** on the upscaled output — re-strips the white the upscaler introduced. Yields true alpha at 4096px.
5. **Local PIL connected-components cleanup** — flood-fills the alpha channel, keeps only the two largest blobs (shield outline + wolf head), drops upscaler hallucinations and noise.
6. **Crop to bounding box** + 40px transparent padding, square the canvas.
7. **`sips`** (macOS built-in) downsamples the master to 1024 / 512 / 256 / 180 / 64 / 32 with Lanczos.
8. **PIL alpha-composite** the 1024 mark onto `#0a1525` for the dark composite and 1200×630 OG card.

Total Replicate cost: ~$0.10 per logo cleanup. Total wall time: ~20 seconds.

If regenerating from a new source, the script lives in conversation history (or rebuild from the steps above — they're deterministic given the same input).
