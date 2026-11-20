/**
 * Genera l'immagine di condivisione predefinita del sito:
 * img/condivisione/cf-consulting.jpg, 1200x630 (il formato consigliato da
 * Meta per og:image, rapporto 1.91:1), JPEG perché WebP nelle anteprime
 * social non è garantito.
 *
 * Si lancia a mano, una volta, e il risultato si committa:
 *   node strumenti/immagine-condivisione.mjs
 * Va rifatta solo se cambiano il logo o la frase sotto.
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'img', 'condivisione', 'cf-consulting.jpg');

const W = 1200, H = 630;
const SFONDO = '#FFFFFF';
const GRIGIO = '#58616D';        // --label in assets/css/site.css
const ROSSO = '#8C1D2C';         // --red
const FRASE = 'Ingegneria, architettura ed energia · Terni';

// logo ridotto (mai ingrandito: l'originale è 900 px di larghezza)
const logoW = 640;
const logo = await sharp(join(ROOT, 'img', 'logo-cf-dark.webp'))
  .resize({ width: logoW, kernel: 'lanczos3' })
  .png()
  .toBuffer({ resolveWithObject: true });

// la frase in un carattere di sistema senza grazie (librsvg/Pango non
// leggono il woff2 del sito), grigio come le etichette
const testo = await sharp({
  text: {
    text: `<span foreground="${GRIGIO}">${FRASE}</span>`,
    font: 'Segoe UI 30',
    dpi: 72,
    rgba: true
  }
}).png().toBuffer({ resolveWithObject: true });

// filetto rosso fra logo e frase
const filettoW = 56, filettoH = 4;
const filetto = await sharp({
  create: { width: filettoW, height: filettoH, channels: 4, background: ROSSO }
}).png().toBuffer();

const spazio1 = 48, spazio2 = 30;
const altezzaGruppo = logo.info.height + spazio1 + filettoH + spazio2 + testo.info.height;
const top = Math.round((H - altezzaGruppo) / 2);
const yFiletto = top + logo.info.height + spazio1;
const yTesto = yFiletto + filettoH + spazio2;

await mkdir(dirname(OUT), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 3, background: SFONDO } })
  .composite([
    { input: logo.data, left: Math.round((W - logo.info.width) / 2), top },
    { input: filetto, left: Math.round((W - filettoW) / 2), top: yFiletto },
    { input: testo.data, left: Math.round((W - testo.info.width) / 2), top: yTesto }
  ])
  .jpeg({ quality: 88, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toFile(OUT);

console.log(`${OUT}: ${W}x${H}, ${((await stat(OUT)).size / 1024).toFixed(0)} KB`);
