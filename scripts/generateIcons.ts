/*
  Regenerate every PWA / home-screen icon from one source image.

    npm run icons                         # rebuild from the default source
    npm run icons -- path/to/new-icon.png # use a different image
    npm run icons -- new.png --bg "#ffffff" --padding 0.1

  Writes public/icons/icon-180.png (iOS home screen), icon-192.png and
  icon-512.png (Android / favicon) and icon-512-maskable.png (Android adaptive
  icon, extra safe-zone padding). Those file names are referenced from
  index.html, public/manifest.webmanifest and public/sw.js, so they stay fixed.

  Options
    --bg <css colour | transparent>  background behind the artwork (default #0a0a0a,
                                     the app's theme colour; iOS ignores transparency)
    --padding <0..0.4>               fraction of each edge left empty around the artwork
                                     on the regular icons (default 0.03)
*/
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const DEFAULT_SOURCE = path.join('src', 'assets', 'larry-obrien-icon.png');
const OUTPUT_DIR = path.join('public', 'icons');
const DEFAULT_BACKGROUND = '#0a0a0a';
const DEFAULT_PADDING = 0.03;
/* Android masks adaptive icons to a circle of radius 40%, so keep the artwork
   inside the central ~70% of the maskable variant. */
const MASKABLE_PADDING = 0.15;

type IconSpec = { file: string; size: number; padding: number };

type Rgba = { r: number; g: number; b: number; alpha: number };

function parseBackground(value: string): Rgba {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  const hex = v.startsWith('#') ? v.slice(1) : v;
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/.test(full)) {
    throw new Error(`--bg must be a hex colour like #0a0a0a or "transparent" (got "${value}")`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: 1,
  };
}

function parsePadding(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 0.4) {
    throw new Error(`--padding must be a number between 0 and 0.4 (got "${value}")`);
  }
  return n;
}

async function renderIcon(
  artwork: Buffer,
  spec: IconSpec,
  background: Rgba,
  outputDir: string,
): Promise<string> {
  const inner = Math.round(spec.size * (1 - spec.padding * 2));
  const fitted = await sharp(artwork)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const outPath = path.join(outputDir, spec.file);
  await sharp({
    create: { width: spec.size, height: spec.size, channels: 4, background },
  })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  return outPath;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bg: { type: 'string', default: DEFAULT_BACKGROUND },
      padding: { type: 'string', default: String(DEFAULT_PADDING) },
    },
  });

  const source = path.resolve(positionals[0] ?? DEFAULT_SOURCE);
  const background = parseBackground(values.bg);
  const padding = parsePadding(values.padding);
  const outputDir = path.resolve(OUTPUT_DIR);

  /* Trim any empty margin so padding is consistent whatever the source's own
     whitespace, then everything below scales from the same cropped artwork. */
  const artwork = await sharp(source).trim({ threshold: 10 }).png().toBuffer();

  const specs: IconSpec[] = [
    { file: 'icon-180.png', size: 180, padding },
    { file: 'icon-192.png', size: 192, padding },
    { file: 'icon-512.png', size: 512, padding },
    { file: 'icon-512-maskable.png', size: 512, padding: MASKABLE_PADDING },
  ];

  await mkdir(outputDir, { recursive: true });
  console.log(`Source: ${path.relative(process.cwd(), source)}`);
  for (const spec of specs) {
    const out = await renderIcon(artwork, spec, background, outputDir);
    console.log(`  wrote ${path.relative(process.cwd(), out)} (${spec.size}x${spec.size})`);
  }
  console.log(
    'Done. iOS copies the icon when you "Add to Home Screen", so remove and re-add the app to see a new icon there.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
