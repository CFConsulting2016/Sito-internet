/**
 * Sorveglianza delle condizioni d'uso delle fonti News.
 *
 * Una volta a settimana rilegge la pagina delle condizioni di ogni fonte
 * attiva e la confronta con quella registrata. Se cambia in modo che
 * conta, e il cambiamento si conferma per due controlli di fila:
 *   - spegne la raccolta automatica da quella fonte (attiva: false)
 *   - segna la fonte "condizioni cambiate, da rivedere" con il dettaglio
 *   - apre una segnalazione su GitHub, che arriva per email
 * Le notizie gia' pubblicate restano online: un cambio di condizioni non
 * rende illecito quello che e' stato pubblicato prima.
 *
 * Perche' due controlli: le pagine cambiano per mille motivi innocui
 * (banner dei cookie, test, l'anno nel copyright). Senza conferma il
 * cliente si troverebbe fonti spente per niente.
 *
 * Cosa si confronta, per non scattare a vuoto:
 *   - se la fonte ha una pagina di condizioni vera, solo le frasi che
 *     parlano di riproduzione, citazione, autorizzazioni, feed...
 *   - se la fonte non ha condizioni (si controlla la home), solo la
 *     comparsa o la scomparsa di formule forti ("riproduzione riservata",
 *     "termini d'uso"...): una home cambia ogni giorno, le formule no.
 *
 * Lo stato sta in strumenti/sorveglianza-fonti.json, non dentro le schede
 * delle fonti: il pannello Decap cancella i campi che non conosce.
 *
 * Uso:
 *   node strumenti/sorveglia-fonti.mjs               prova: mostra e basta
 *   node strumenti/sorveglia-fonti.mjs --inizializza registra lo stato attuale
 *   node strumenti/sorveglia-fonti.mjs --github      lo fa davvero (GitHub Actions)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATO = join(ROOT, 'strumenti', 'sorveglianza-fonti.json');
const UA = 'CF-Consulting-News/1.0 (+https://www.cieffeconsulting.eu)';
const AVVISARE = '@FrancescoF23';

const PAROLE_RIUSO = /riprodu|ripubblic|riutilizz|citazion|estratt|autorizzazion|consenso|vietat|consentit|diritti riservat|propriet[aà] intellettual|uso commercial|fini commercial|licenz|feed|rss|copyright/i;

const FORMULE_FORTI = [
  'riproduzione riservata', 'vietata la riproduzione', 'riproduzione vietata',
  'tutti i diritti riservati', 'all rights reserved', 'senza autorizzazione',
  "termini d'uso", 'termini di utilizzo', "condizioni d'uso", 'condizioni di utilizzo',
  'note legali', 'copyright',
];

const oggi = new Date().toISOString().slice(0, 10);
const modo = process.argv.includes('--github') ? 'github'
  : process.argv.includes('--inizializza') ? 'inizializza' : 'prova';

/* --- lettura della pagina ------------------------------------- */

function decodifica(buffer, contentType) {
  const inizio = new TextDecoder('ascii').decode(buffer.slice(0, 1500));
  const dichiarata = (inizio.match(/charset=["']?([\w-]+)/i) || [])[1]
    || (contentType.match(/charset=([^;]+)/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(dichiarata.trim().toLowerCase()).decode(buffer); }
  catch { return new TextDecoder('utf-8').decode(buffer); }
}

async function testoDellaPagina(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`risposta ${r.status}`);
  const html = decodifica(new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type') || '');
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Le frasi che contano, ripulite da quello che cambia senza significare
 *  nulla: maiuscole, spazi e soprattutto gli anni (il © 2026 che diventa 2027). */
function impronta(testo, suHome) {
  const t = testo.toLowerCase().replace(/[’`]/g, "'");
  if (suHome) return FORMULE_FORTI.filter((f) => t.includes(f)).sort();
  return [...new Set(
    t.split(/(?<=[.;:!?])\s+/)
      .filter((f) => f.length > 30 && f.length < 500 && PAROLE_RIUSO.test(f))
      .map((f) => f.replace(/\b(19|20)\d{2}\b/g, 'AAAA').trim()),
  )].sort();
}

const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* --- giro principale ------------------------------------------ */

const dirFonti = join(ROOT, 'src', 'fonti');
const nomi = (await readdir(dirFonti)).filter((f) => f.endsWith('.json'));
const stato = JSON.parse(await readFile(STATO, 'utf8').catch(() => '{}'));
const statoIniziale = JSON.stringify(stato);
const confermate = [];

for (const nome of nomi) {
  const id = nome.replace(/\.json$/, '');
  const percorso = join(dirFonti, nome);
  const fonte = JSON.parse(await readFile(percorso, 'utf8'));
  if (fonte.attiva !== true || !fonte.condizioni) continue;

  const suHome = new URL(fonte.condizioni).pathname.replace(/\/+$/, '') === '';
  let attuale;
  try {
    attuale = impronta(await testoDellaPagina(fonte.condizioni), suHome);
  } catch (e) {
    // pagina irraggiungibile: non e' un cambio di condizioni, si riprova la volta dopo
    console.log(`${fonte.nome}: pagina non leggibile (${e.message}), nessuna azione`);
    continue;
  }

  const prima = stato[id];
  if (!prima || modo === 'inizializza') {
    stato[id] = { url: fonte.condizioni, modo: suHome ? 'home' : 'pagina', frasi: attuale, controllato: oggi };
    console.log(`${fonte.nome}: stato registrato (${attuale.length} elementi)`);
    continue;
  }

  // la data si aggiorna solo quando succede qualcosa: nelle settimane
  // tranquille lo script non deve salvare nulla sul ramo principale
  if (uguali(prima.frasi, attuale)) {
    if (prima.sospetto) { delete prima.sospetto; prima.controllato = oggi; }
    console.log(`${fonte.nome}: nessun cambiamento`);
    continue;
  }

  if (!prima.sospetto || !uguali(prima.sospetto.frasi, attuale)) {
    prima.sospetto = { frasi: attuale, dal: oggi };
    prima.controllato = oggi;
    console.log(`${fonte.nome}: possibile cambiamento, si conferma al prossimo controllo`);
    continue;
  }

  // confermato per due controlli di fila
  const comparse = attuale.filter((f) => !prima.frasi.includes(f));
  const sparite = prima.frasi.filter((f) => !attuale.includes(f));
  console.log(`${fonte.nome}: CAMBIAMENTO CONFERMATO, raccolta sospesa`);
  confermate.push({ fonte, comparse, sparite });

  fonte.attiva = false;
  fonte.revisione = {
    stato: 'da-verificare',
    data: oggi,
    nota: `Le condizioni d'uso sono cambiate (confermato il ${oggi}). `
      + `Raccolta automatica sospesa. Leggete la pagina ${fonte.condizioni}: se va ancora bene, `
      + `riaccendete «Raccogli nuove notizie» e rimettete lo stato su «A posto». `
      + `Le notizie già pubblicate restano online.`,
  };
  stato[id] = { url: fonte.condizioni, modo: suHome ? 'home' : 'pagina', frasi: attuale, controllato: oggi };
  if (modo === 'github') await writeFile(percorso, JSON.stringify(fonte, null, 1) + '\n', 'utf8');
}

if (modo !== 'prova' && JSON.stringify(stato) !== statoIniziale) {
  await writeFile(STATO, JSON.stringify(stato, null, 1) + '\n', 'utf8');
}

/* --- segnalazione --------------------------------------------- */

if (modo === 'github' && confermate.length) {
  const elenco = (v) => (v.length ? v.map((f) => `- ${f}`).join('\n') : '- (nessuna)');
  const corpo = confermate.map(({ fonte, comparse, sparite }) =>
    `## ${fonte.nome}\n\nPagina controllata: ${fonte.condizioni}\n\n`
    + `**Comparse:**\n${elenco(comparse)}\n\n**Sparite:**\n${elenco(sparite)}`).join('\n\n');
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Condizioni d'uso cambiate: ${confermate.map((c) => c.fonte.nome).join(', ')}`,
      body: `${AVVISARE} la sorveglianza ha rilevato un cambiamento confermato nelle condizioni d'uso. `
        + `La raccolta automatica da queste fonti è stata sospesa; le notizie già pubblicate restano online.\n\n${corpo}`,
    }),
  });
  console.log(r.ok ? 'Segnalazione aperta su GitHub.' : `Segnalazione non aperta (${r.status}): controllare che le Issues siano attive.`);
}
