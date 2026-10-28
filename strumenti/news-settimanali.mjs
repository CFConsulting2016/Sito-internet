/**
 * Giro del lunedì: se ci sono news approvate ma non ancora online, avvia una
 * ricostruzione di Netlify (15 crediti, una volta sola per tutte).
 *
 * Scorre i salvataggi del ramo principale dal più recente: si ferma al primo
 * che ha fatto costruire il sito. Se prima di arrivarci trova news rimaste
 * in attesa, preme il pulsante di avvio di Netlify; altrimenti non fa nulla
 * e non spende nulla.
 *
 *   node strumenti/news-settimanali.mjs          solo controllo
 *   node strumenti/news-settimanali.mjs --avvia  preme il pulsante
 *                                                (serve NETLIFY_BUILD_HOOK)
 */
import { execFileSync } from 'node:child_process';
import { quandoPubblicare } from './pubblicazione.mjs';

const git = (...arg) => execFileSync('git', arg, { encoding: 'utf8' });
const leggiIn = (sha) => (f) => {
  try { return git('show', `${sha}:${f}`); } catch { return null; }
};

const salvataggi = git('log', '--first-parent', '--format=%H %s', '-n', '300', 'HEAD')
  .split('\n').filter(Boolean).map((r) => ({ sha: r.slice(0, 40), titolo: r.slice(41) }));

const inAttesa = [];
for (const { sha, titolo } of salvataggi) {
  let file;
  try {
    file = git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter(Boolean);
  } catch {
    break; // primo salvataggio della storia
  }
  const quando = quandoPubblicare(file, leggiIn(sha));
  if (quando === 'subito') break;
  if (quando === 'lunedi') inAttesa.push(titolo);
}

if (!inAttesa.length) {
  console.log('Nessuna news in attesa: niente da pubblicare, nessun credito speso.');
  process.exit(0);
}
console.log(`News in attesa (${inAttesa.length}):\n${inAttesa.map((t) => `  - ${t}`).join('\n')}`);

if (!process.argv.includes('--avvia')) process.exit(0);
const pulsante = process.env.NETLIFY_BUILD_HOOK;
if (!pulsante) throw new Error('Manca NETLIFY_BUILD_HOOK: va aggiunto nei Secrets del repository');

const r = await fetch(`${pulsante}?trigger_title=${encodeURIComponent('News del lunedì')}`, { method: 'POST' });
if (!r.ok) throw new Error(`Netlify ha risposto ${r.status}`);
console.log('Ricostruzione avviata su Netlify.');
