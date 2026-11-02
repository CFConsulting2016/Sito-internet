/**
 * Pubblicazione automatica delle news di CF Consulting.
 *
 * Legge i feed delle fonti attive (src/fonti/*.json), sceglie DUE articoli
 * nuovi e li scrive in src/news: il lunedi' e il giovedi' mattina il giro di
 * GitHub (.github/workflows/news.yml) li salva tutti in una volta, e Netlify
 * ricostruisce il sito una volta sola. Nessuna approvazione: il cliente non
 * vede le news nel pannello (decisione della call del 30/10/2026).
 *
 * Cosa finisce nella notizia: titolo dell'articolo, collegamento, testata
 * e data. Niente riassunto e niente immagini della fonte, come concordato:
 * e' questo formato a tenerci dentro i limiti della legge sul diritto
 * d'autore. Le news restano sul sito due mesi: le toglie build.mjs.
 *
 * Uso:
 *   node strumenti/raccogli-news.mjs           prova: mostra cosa pubblicherebbe
 *   node strumenti/raccogli-news.mjs --scrivi  scrive i file in src/news
 *
 * Nessuna dipendenza: solo Node 20 o superiore.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAX_TOTALE = 2;       // news per giro: lunedi' e giovedi', quattro a settimana
const MAX_PER_FONTE = 1;    // una per testata, se ce ne sono abbastanza (vedi sotto)
const GIORNI_MASSIMI = 14;  // gli articoli piu' vecchi non sono piu' notizie
const UA = 'CF-Consulting-News/1.0 (+https://www.cieffeconsulting.eu)';

/* --- lettura dei dati ----------------------------------------- */

async function leggiCartella(nome) {
  const dir = join(ROOT, 'src', nome);
  const file = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(file.map(async (f) => ({
    id: f.replace(/\.json$/, ''),
    ...JSON.parse(await readFile(join(dir, f), 'utf8')),
  })));
}

/* --- lettura dei feed ----------------------------------------- */

const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function pulisci(testo) {
  return String(testo || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITA[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function campo(blocco, tag) {
  const m = blocco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? pulisci(m[1]) : '';
}

/** Alcune testate pubblicano il feed in Latin-1, non in UTF-8: va letto
 *  con la codifica giusta, altrimenti gli accenti diventano punti di domanda. */
function decodifica(buffer, contentType) {
  const inizio = new TextDecoder('ascii').decode(buffer.slice(0, 200));
  const dichiarata = (inizio.match(/encoding=["']([^"']+)["']/i) || [])[1]
    || (contentType.match(/charset=([^;]+)/i) || [])[1]
    || 'utf-8';
  try {
    return new TextDecoder(dichiarata.trim().toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

async function leggiFeed(fonte) {
  const risposta = await fetch(fonte.feed, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!risposta.ok) throw new Error(`risposta ${risposta.status}`);
  const xml = decodifica(new Uint8Array(await risposta.arrayBuffer()),
    risposta.headers.get('content-type') || '');

  // RSS usa <item>, Atom usa <entry>: li accetto entrambi
  const blocchi = xml.match(/<item[\s>][\s\S]*?<\/item>/gi)
    || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  return blocchi.map((b) => {
    let link = campo(b, 'link');
    if (!link) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    if (link && !/^https?:/i.test(link) && fonte.base) link = fonte.base.replace(/\/+$/, '') + '/' + link.replace(/^\/+/, '');
    const data = new Date(campo(b, 'pubDate') || campo(b, 'published') || campo(b, 'updated') || campo(b, 'dc:date'));
    return { titolo: campo(b, 'title'), url: link, data, fonte: fonte.id };
  }).filter((a) => a.titolo && /^https?:/i.test(a.url) && !isNaN(a.data));
}

/* --- scelta degli articoli ------------------------------------ */

function slug(testo) {
  return testo.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

const giorno = (d) => d.toISOString().slice(0, 10);

function scegli(candidati, giaVisti, perTestata) {
  const limite = Date.now() - GIORNI_MASSIMI * 86400000;
  const perFonte = {};
  const scelti = [];
  const ordinati = candidati
    .filter((a) => a.data.getTime() >= limite && !giaVisti.has(a.url))
    .sort((a, b) => b.data - a.data);

  for (const a of ordinati) {
    if (scelti.length >= MAX_TOTALE) break;
    if ((perFonte[a.fonte] || 0) >= perTestata) continue;
    perFonte[a.fonte] = (perFonte[a.fonte] || 0) + 1;
    scelti.push(a);
  }
  return scelti;
}

/* --- giro principale ------------------------------------------ */

const scrivi = process.argv.includes('--scrivi');

const fonti = (await leggiCartella('fonti')).filter((f) => f.attiva === true && f.feed);
// anche le news scadute restano nella cartella: cosi' non tornano mai
const giaPubblicate = new Set((await leggiCartella('news')).map((n) => n.url));

console.log(`Fonti attive: ${fonti.map((f) => f.nome).join(', ') || 'nessuna'}`);

const candidati = [];
for (const fonte of fonti) {
  try {
    const articoli = await leggiFeed(fonte);
    console.log(`  ${fonte.nome}: ${articoli.length} articoli nel feed`);
    candidati.push(...articoli);
  } catch (e) {
    // una fonte irraggiungibile non deve fermare le altre
    console.log(`  ${fonte.nome}: feed non leggibile (${e.message})`);
  }
}

// una per testata; se una fonte non ha niente di nuovo, la seconda news
// puo' arrivare dalla stessa testata della prima
let scelti = scegli(candidati, giaPubblicate, MAX_PER_FONTE);
if (scelti.length < MAX_TOTALE) scelti = scegli(candidati, giaPubblicate, MAX_TOTALE);

if (!scelti.length) {
  console.log('\nNessun articolo nuovo da pubblicare.');
  process.exit(0);
}

console.log(`\n${scrivi ? 'Pubblicate' : "Da pubblicare (prova, nulla e' stato scritto)"}:`);
for (const a of scelti) {
  let nome = `${giorno(a.data)}-${slug(a.titolo)}`;
  if (existsSync(join(ROOT, 'src', 'news', `${nome}.json`))) nome += '-2';
  const notizia = { titolo: a.titolo, fonte: a.fonte, url: a.url, data: giorno(a.data), nota: '', foto: '' };
  if (scrivi) {
    await writeFile(join(ROOT, 'src', 'news', `${nome}.json`), JSON.stringify(notizia, null, 1) + '\n', 'utf8');
  }
  console.log(`  ${notizia.data}  ${a.titolo}`);
}
