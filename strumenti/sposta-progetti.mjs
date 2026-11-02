/**
 * Porta online i progetti in attesa: li sposta da src/progetti-in-attesa a
 * src/progetti e fa ricostruire il sito una volta sola, per tutti.
 *
 *   node strumenti/sposta-progetti.mjs            prova: mostra cosa sposterebbe
 *   node strumenti/sposta-progetti.mjs --github   sposta, salva e avvia davvero
 *
 * Il salvataggio porta «[skip netlify]», così Netlify non costruisce da solo;
 * la costruzione la avvia il pulsante di Netlify (NETLIFY_BUILD_HOOK), una
 * volta sola. Se non c'è niente da spostare non succede nulla e non si
 * spende nulla. Il feed si aggiorna con tutti i progetti nuovi insieme, e
 * Zapier pubblica un post per ognuno.
 */
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATTESA = join(ROOT, 'src', 'progetti-in-attesa');
const PUBBLICATI = join(ROOT, 'src', 'progetti');
const suGithub = process.argv.includes('--github');

const spostati = [];
for (const nome of (await readdir(ATTESA)).filter((f) => f.endsWith('.json')).sort()) {
  const progetto = JSON.parse(await readFile(join(ATTESA, nome), 'utf8'));
  // un nome già usato da un progetto online non deve sovrascriverlo
  let arrivo = nome;
  for (let n = 2; existsSync(join(PUBBLICATI, arrivo)); n++) arrivo = nome.replace(/\.json$/, `-${n}.json`);
  spostati.push(progetto.shortTitle || progetto.title || nome);
  if (!suGithub) continue;
  await writeFile(join(PUBBLICATI, arrivo), JSON.stringify(progetto, null, 1) + '\n', 'utf8');
  await rm(join(ATTESA, nome));
}

if (!spostati.length) {
  console.log('Nessun progetto in attesa: niente da pubblicare, nessun credito speso.');
  process.exit(0);
}
console.log(`${suGithub ? 'Pubblicati' : 'Da pubblicare (prova, nulla è stato spostato)'} (${spostati.length}):`);
for (const t of spostati) console.log(`  - ${t}`);
if (!suGithub) process.exit(0);

const git = (...arg) => execFileSync('git', arg, { cwd: ROOT, stdio: 'inherit' });
git('config', 'user.name', 'Pubblicazione progetti');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('add', '-A', 'src/progetti', 'src/progetti-in-attesa');
git('commit', '-m', `Pubblicati ${spostati.length} progetti [skip netlify]\n\n${spostati.map((t) => `- ${t}`).join('\n')}`);
// un'altra automazione potrebbe aver salvato nel frattempo
for (let tentativo = 1; ; tentativo++) {
  try { git('pull', '--rebase', '--quiet'); git('push', '--quiet'); break; } catch (e) {
    if (tentativo === 3) throw e;
  }
}

const pulsante = process.env.NETLIFY_BUILD_HOOK;
if (!pulsante) throw new Error('Manca NETLIFY_BUILD_HOOK: progetti spostati ma sito non ricostruito');
const r = await fetch(`${pulsante}?trigger_title=${encodeURIComponent('Pubblicazione progetti')}`, { method: 'POST' });
if (!r.ok) throw new Error(`Netlify ha risposto ${r.status}: progetti spostati ma sito non ricostruito`);
console.log('Ricostruzione avviata su Netlify.');
