/**
 * Porta online le news in attesa: le sposta da src/news-in-attesa a src/news
 * e fa ricostruire il sito una volta sola.
 *
 *   node strumenti/sposta-news.mjs --tutte      tutte quelle in attesa
 *                                               (il lunedì, o «Pubblica ora»)
 *   node strumenti/sposta-news.mjs --immediate  solo quelle con
 *                                               «Pubblicazione immediata» accesa
 *   aggiungere --github per salvare e avviare davvero (da GitHub Actions)
 *
 * Il salvataggio porta «[skip netlify]», così Netlify non costruisce da solo;
 * la costruzione la avvia il pulsante di Netlify (NETLIFY_BUILD_HOOK), una
 * volta sola. Se non c'è niente da spostare non succede nulla e non si
 * spende nulla.
 */
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATTESA = join(ROOT, 'src', 'news-in-attesa');
const NEWS = join(ROOT, 'src', 'news');

const tutte = process.argv.includes('--tutte');
const suGithub = process.argv.includes('--github');

const spostate = [];
for (const nome of (await readdir(ATTESA)).filter((f) => f.endsWith('.json')).sort()) {
  const notizia = JSON.parse(await readFile(join(ATTESA, nome), 'utf8'));
  if (!tutte && notizia.pubblicaSubito !== true) continue;
  delete notizia.pubblicaSubito; // sul sito non serve più
  spostate.push(notizia.titolo || nome);
  if (!suGithub) continue;
  await writeFile(join(NEWS, nome), JSON.stringify(notizia, null, 1) + '\n', 'utf8');
  await rm(join(ATTESA, nome));
}

if (!spostate.length) {
  console.log(tutte ? 'Nessuna news in attesa: niente da pubblicare, nessun credito speso.'
    : 'Nessuna news con pubblicazione immediata.');
  process.exit(0);
}
console.log(`${suGithub ? 'Pubblicate' : 'Da pubblicare (prova, nulla è stato spostato)'} (${spostate.length}):`);
for (const t of spostate) console.log(`  - ${t}`);
if (!suGithub) process.exit(0);

const git = (...arg) => execFileSync('git', arg, { cwd: ROOT, stdio: 'inherit' });
git('config', 'user.name', 'Pubblicazione news');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('add', '-A', 'src/news', 'src/news-in-attesa');
git('commit', '-m', `Pubblicate ${spostate.length} news [skip netlify]\n\n${spostate.map((t) => `- ${t}`).join('\n')}`);
// un'altra automazione potrebbe aver salvato nel frattempo
for (let tentativo = 1; ; tentativo++) {
  try { git('pull', '--rebase', '--quiet'); git('push', '--quiet'); break; } catch (e) {
    if (tentativo === 3) throw e;
  }
}

const pulsante = process.env.NETLIFY_BUILD_HOOK;
if (!pulsante) throw new Error('Manca NETLIFY_BUILD_HOOK: news spostate ma sito non ricostruito');
const r = await fetch(`${pulsante}?trigger_title=${encodeURIComponent('Pubblicazione news')}`, { method: 'POST' });
if (!r.ok) throw new Error(`Netlify ha risposto ${r.status}: news spostate ma sito non ricostruito`);
console.log('Ricostruzione avviata su Netlify.');
