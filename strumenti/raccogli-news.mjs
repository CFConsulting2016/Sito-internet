/**
 * Raccolta automatica delle news per il pannello di CF Consulting.
 *
 * Legge i feed delle fonti attive (src/fonti/*.json), sceglie al massimo
 * TRE articoli nuovi e li propone nel pannello Decap come notizie pronte
 * da pubblicare. Non pubblica niente: decide il cliente, una per una.
 *
 * Ogni proposta e' una richiesta di modifica su un ramo cms/news/<nome>
 * con l'etichetta decap-cms/pending_publish: e' il formato che Decap usa
 * per le sue bozze, quindi la proposta compare nella scheda Workflow come
 * se l'avesse scritta il cliente. Le proposte vivono su rami a parte e
 * non toccano il sito finche' non vengono pubblicate.
 *
 * Cosa finisce nella notizia: titolo dell'articolo, collegamento, testata
 * e data. Niente riassunto e niente immagini della fonte, come concordato:
 * e' questo formato a tenerci dentro i limiti della legge sul diritto
 * d'autore. La nota redazionale resta vuota, la aggiunge il cliente se vuole.
 *
 * Uso:
 *   node strumenti/raccogli-news.mjs            prova in locale: mostra cosa
 *                                               proporrebbe, non scrive nulla
 *   node strumenti/raccogli-news.mjs --github   lo fa davvero (solo da GitHub
 *                                               Actions, serve GITHUB_TOKEN)
 *
 * Nessuna dipendenza: solo Node 20 o superiore.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAX_TOTALE = 3;       // proposte per giro, in tutto
const MAX_PER_FONTE = 2;    // per non far arrivare tre notizie dalla stessa testata
const GIORNI_MASSIMI = 14;  // gli articoli piu' vecchi non sono piu' notizie
const ETICHETTA = 'decap-cms/pending_publish';
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

function scegli(candidati, giaVisti) {
  const limite = Date.now() - GIORNI_MASSIMI * 86400000;
  const perFonte = {};
  const scelti = [];
  const ordinati = candidati
    .filter((a) => a.data.getTime() >= limite && !giaVisti.has(a.url))
    .sort((a, b) => b.data - a.data);

  for (const a of ordinati) {
    if (scelti.length >= MAX_TOTALE) break;
    if ((perFonte[a.fonte] || 0) >= MAX_PER_FONTE) continue;
    perFonte[a.fonte] = (perFonte[a.fonte] || 0) + 1;
    scelti.push(a);
  }
  return scelti;
}

/* --- GitHub: creare le proposte -------------------------------- */

function github(token, repo) {
  const api = async (metodo, percorso, corpo) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${percorso}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (!r.ok) throw new Error(`GitHub ${metodo} ${percorso}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };

  return {
    /** Una proposta per questo ramo esiste gia', aperta o chiusa? Le chiuse
     *  contano: se il cliente ha scartato un articolo, non va riproposto. */
    async giaProposto(ramo) {
      const proprietario = repo.split('/')[0];
      const elenco = await api('GET', `/pulls?state=all&head=${proprietario}:${encodeURIComponent(ramo)}`);
      return elenco.length > 0;
    },

    async proponi(ramo, percorso, contenuto, titolo) {
      const principale = await api('GET', '/git/ref/heads/main');
      await api('POST', '/git/refs', { ref: `refs/heads/${ramo}`, sha: principale.object.sha });
      await api('PUT', `/contents/${percorso}`, {
        message: `Proposta automatica: ${titolo}`,
        content: Buffer.from(contenuto, 'utf8').toString('base64'),
        branch: ramo,
      });
      const pr = await api('POST', '/pulls', {
        title: `Proposta news: ${titolo}`.slice(0, 250),
        head: ramo,
        base: 'main',
        body: 'Proposta automatica della raccolta news. Si pubblica dal pannello di gestione, nella scheda Workflow.',
      });
      await api('POST', `/issues/${pr.number}/labels`, { labels: [ETICHETTA] });
      return pr.number;
    },
  };
}

/* --- giro principale ------------------------------------------ */

const suGithub = process.argv.includes('--github');

const fonti = (await leggiCartella('fonti')).filter((f) => f.attiva === true && f.feed);
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

let gh = null;
if (suGithub) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('Mancano GITHUB_TOKEN o GITHUB_REPOSITORY');
  gh = github(token, repo);
}

// Scorro i candidati in ordine e salto quelli gia' proposti in passato,
// finche' non ne trovo tre davvero nuovi.
const scartati = new Set(giaPubblicate);
let scelti = [];
for (let giro = 0; giro < 10; giro++) {
  const prova = scegli(candidati, scartati);
  const nuovi = [];
  for (const a of prova) {
    const nome = `${giorno(a.data)}-${slug(a.titolo)}`;
    if (gh && await gh.giaProposto(`cms/news/${nome}`)) {
      scartati.add(a.url);
    } else {
      nuovi.push({ ...a, nome });
    }
  }
  scelti = nuovi;
  if (nuovi.length === prova.length) break; // nessuno scartato in questo giro
}

if (!scelti.length) {
  console.log('\nNessun articolo nuovo da proporre.');
  process.exit(0);
}

console.log(`\n${suGithub ? 'Proposte create' : 'Proposte che verrebbero create (prova, nulla e\' stato scritto)'}:`);
for (const a of scelti) {
  const notizia = {
    titolo: a.titolo,
    fonte: a.fonte,
    url: a.url,
    data: giorno(a.data),
    nota: '',
    foto: '',
  };
  const contenuto = JSON.stringify(notizia, null, 1) + '\n';
  if (gh) {
    const numero = await gh.proponi(`cms/news/${a.nome}`, `src/news/${a.nome}.json`, contenuto, a.titolo);
    console.log(`  #${numero}  ${a.titolo}`);
  } else {
    console.log(`\n  ramo:  cms/news/${a.nome}`);
    console.log(`  file:  src/news/${a.nome}.json`);
    console.log('  ' + contenuto.trim().replace(/\n/g, '\n  '));
  }
}
