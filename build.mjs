/**
 * CF Consulting — generatore del sito statico.
 *
 * Unisce il partial condiviso (header + pannello servizi + drawer + footer)
 * alle pagine in src/pages/ e ai due template in src/templates/, e scrive
 * HTML statico nella radice del progetto. Nessuna dipendenza: `node build.mjs`.
 */
import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
// L'indirizzo del sito lo dà Netlify al momento della costruzione: così
// anteprime social, canonical e feed puntano all'indirizzo dove il sito
// vive davvero — l'anteprima ora, il dominio dopo il lancio. In locale,
// senza variabile, resta il dominio definitivo.
const SITE = (process.env.URL || 'https://www.cieffeconsulting.eu').replace(/\/+$/, '') + '/';

const read = (...p) => readFile(join(...p), 'utf8');

/** Una raccolta del CMS: una cartella di JSON, un file per scheda.
 *  Ordina per il campo `ordine` se c'è, altrimenti per nome file. */
async function leggiCartella(nomeCartella, prepara) {
  const dir = join(SRC, nomeCartella);
  const nomi = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.json')).sort();
  const voci = [];
  for (const f of nomi) {
    const voce = JSON.parse(await read(dir, f));
    if (prepara) prepara(voce, f.replace(/\.json$/, ''));
    voci.push(voce);
  }
  return voci.sort((a, b) => (a.ordine ?? 1e9) - (b.ordine ?? 1e9));
}

/* --- utilità ------------------------------------------------ */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** "Sostenibilità ambientale" -> "sostenibilita-ambientale" */
const slug = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, ' e ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** Variante piccola di una foto, per le anteprime.
 *  Alcune immagini nascono già sotto i 640px e non ne hanno una. */
const piccole = new Set();
const small = (f) => {
  const sm = f.replace(/\.webp$/, '-sm.webp');
  return piccole.has(sm) ? sm : f;
};

/** srcset a due misure: 640px per le schede, 1600px per le viste grandi. */
const srcset = (f) => `srcset="${small(f)} 640w, ${f} 1600w"`;

const subHref = (area, item) => `servizi/${area.id}/${slug(item)}.html`;
const projectHref = (p) => `progetti/${p.slug}.html`;

/* --- navigazione servizi (partial condiviso) ---------------- */

function panelAreas(areas) {
  return areas.map((a, i) => `        <button type="button" class="services-panel__area" role="tab"
                data-area="${a.id}" aria-selected="${i === 0}" aria-controls="cf-panel-${a.id}" tabindex="${i === 0 ? 0 : -1}">
          <span class="services-panel__num">${a.num}</span>
          <span class="services-panel__name">${esc(a.name)}</span>
        </button>`).join('\n');
}

function panelLists(areas) {
  return areas.map((a, i) => `      <div class="services-panel__list" id="cf-panel-${a.id}" role="tabpanel" data-area-panel="${a.id}"${i === 0 ? '' : ' hidden'}>
        <div class="services-panel__title">${esc(a.name)}</div>
${a.items.map((it) => `        <a class="services-panel__sub" href="${subHref(a, it)}">${esc(it)}</a>`).join('\n')}
        <a class="services-panel__all" href="servizi.html#${a.id}">Vai all'area →</a>
      </div>`).join('\n');
}

function drawerAreas(areas) {
  return areas.map((a) => `    <div class="drawer-acc">
      <button type="button" class="drawer-acc__btn" data-acc-toggle aria-expanded="false" aria-controls="cf-acc-${a.id}">
        <span class="drawer-acc__label">${a.num} — ${esc(a.name)}</span>
        <span class="drawer-acc__sign" aria-hidden="true">+</span>
      </button>
      <div class="drawer-acc__body" id="cf-acc-${a.id}">
        <div class="drawer-acc__inner">
          <a class="drawer-acc__area" href="servizi.html#${a.id}">Tutta l'area →</a>
${a.items.map((it) => `          <a class="drawer-acc__sub" href="${subHref(a, it)}">${esc(it)}</a>`).join('\n')}
        </div>
      </div>
    </div>`).join('\n');
}

/* --- blocchi di pagina -------------------------------------- */

function areasIndex(areas) {
  return areas.map((a) => `    <div class="area" id="${a.id}" data-rv>
      <div class="area__head">
        <span class="area__num">${a.num}</span>
        <h2 class="area__title" data-title><span>${esc(a.name)}</span></h2>
      </div>
      <div class="area__items">
${a.items.map((it) => `        <a class="area__item" href="${subHref(a, it)}">
          <span>${esc(it)}</span>
          <span class="area__arrow" aria-hidden="true">→</span>
        </a>`).join('\n')}
      </div>
    </div>`).join('\n');
}

function archiveCards(projects) {
  return projects.map((p) => `      <a class="card archive__card" href="${projectHref(p)}"
         data-cat="${p.cat}" data-rv>
        <div class="card__media">${p.img
          ? `<img src="${small(p.img)}" ${srcset(p.img)} sizes="(max-width: 700px) 100vw, 380px"
                  alt="${esc(p.shortTitle)}" loading="lazy" width="640" height="480" />`
          : '<div class="gallery__empty"><span>Foto progetto<br />da caricare</span></div>'}</div>
        <div class="card__body">
          <div class="card__tag">${esc(p.tag)}</div>
          <h3 class="card__title">${esc(p.shortTitle)}</h3>
          <span class="card__more">Vedi progetto <span aria-hidden="true">&rarr;</span></span>
        </div>
      </a>`).join('\n');
}

function projectCards(projects) {
  return projects.map((p) => `      <a class="card" href="${projectHref(p)}" data-rv>
        <div class="card__media">${p.img
          ? `<img src="${small(p.img)}" ${srcset(p.img)} sizes="(max-width: 700px) 100vw, 380px"
                  alt="${esc(p.shortTitle)}" loading="lazy" width="640" height="480" />`
          : '<div class="gallery__empty"><span>Foto progetto<br />da caricare</span></div>'}</div>
        <div class="card__body">
          <div class="card__tag">${esc(p.tag)}</div>
          <h3 class="card__title">${esc(p.shortTitle)}</h3>
        </div>
      </a>`).join('\n');
}

/** Progetto di apertura della homepage: il primo con una foto pronta. */
function homeFeatured(projects) {
  const p = projects.find((x) => x.img) || projects[0];
  return `    <a class="project-hero" href="${projectHref(p)}" data-rv>
      <div class="project-hero__media">
        <img class="media-img" src="${p.img}" ${srcset(p.img)} sizes="(max-width: 1240px) 100vw, 1184px"
             alt="${esc(p.shortTitle)}" width="1600" height="686" loading="lazy" decoding="async" />
      </div>
      <div class="project-hero__body">
        <h3 class="project-hero__title">${esc(p.shortTitle)}</h3>
      </div>
    </a>`;
}

function homeTrio(projects) {
  const withPhoto = projects.filter((x) => x.img);
  return withPhoto.slice(1, 4).map((p) => `      <a class="project-card" href="${projectHref(p)}" data-rv>
        <div class="project-card__media">
          <img class="media-img" src="${small(p.img)}" ${srcset(p.img)} sizes="(max-width: 700px) 100vw, 380px"
               alt="${esc(p.shortTitle)}" width="640" height="480" loading="lazy" decoding="async" />
        </div>
        <h3 class="project-card__title">${esc(p.shortTitle)}</h3>
      </a>`).join('\n');
}

function teamCards(team) {
  return team.map((m) => `      <div class="team-card" data-rv>
        <div class="team-card__photo">${m.foto
          ? `<img src="${small(m.foto)}" alt="${esc(m.name)}" loading="lazy" width="640" height="853" />`
          : '<div class="placeholder"><span>Foto<br />da inserire</span></div>'}</div>
        <div class="team-card__body">
          <div class="team-card__name">${esc(m.name)}</div>
          <div class="team-card__role">${esc(m.role || 'Ruolo da definire')}</div>
        </div>
      </div>`).join('\n');
}

/** Enti pubblici distinti fra i committenti: alimenta il contatore di Chi siamo. */
function publicBodies(projects) {
  return new Set(projects
    .filter((p) => p.cat === 'Pubblico' && p.committente !== '—')
    .map((p) => p.committente.toUpperCase())).size;
}

function certLogos(certificazioni) {
  if (!certificazioni.length) {
    return '      <div class="cert"><span class="cert__todo">loghi da inserire</span></div>';
  }
  return certificazioni.map((c) => `      <div class="cert">
        <img class="cert__logo" src="${c.file}" alt="${esc(c.nome)}" loading="lazy" />
        <span class="cert__name">${esc(c.nome)}</span>
      </div>`).join('\n');
}

/** La riga obbligatoria dell'art. 2250 c.c., che per le societa' di capitali
 *  va riportata anche negli spazi elettronici ad accesso pubblico. */
function rigaLegale(l) {
  const voci = [
    l.denominazione,
    `Sede legale: ${l.sedeLegale}`,
    `${l.registroImprese} / C.F. ${l.codiceFiscale}`,
    `REA ${l.rea}`,
    `Capitale sociale ${l.capitaleSociale}`,
    `P.IVA ${l.partitaIva}`,
  ];
  if (l.socioUnico) voci.splice(1, 0, 'Societaà con socio unico');
  if (l.pecPubblica && l.pec) voci.push(`PEC ${l.pec}`);
  return voci.map(esc).join(' &middot; ');
}

/** Ordine, numero e titolo: li chiede l'art. 7 del D.Lgs. 70/2003
 *  per chi esercita una professione regolamentata. */
function rigaAlbo(a) {
  if (!a || !a.numero) return '';
  return esc(`${a.titolo} ${a.nome}, iscritto all'${a.ordine} al n. ${a.numero}`
    + (a.sezione ? `, sezione ${a.sezione}` : '') + ` (${a.stato})`);
}

/** Fascia dei marchi sopra al piede: certificazione d'impresa e sostegni.
 *  Accanto al marchio stanno norma e numero di certificato, come chiedono
 *  i regolamenti d'uso degli enti. */
function fasciaMarchi(azienda) {
  const voci = [];
  for (const c of azienda.certificazioni || []) {
    voci.push({ file: c.file, alt: `${c.nome} — ${c.ente}`,
      testo: `${c.nome} &middot; certificato n. ${c.numero} &middot; ${c.ente}` });
  }
  for (const s of azienda.sostegni || []) {
    voci.push({ file: s.file, alt: s.nome, testo: s.testo });
  }
  if (!voci.length) return '';

  return `<section class="marchi">
  <div class="container marchi__inner">
${voci.map((v) => `    <figure class="marchio">
      <img class="marchio__logo" src="${v.file}" alt="${esc(v.alt)}" loading="lazy" />
      <figcaption class="marchio__testo">${v.testo}</figcaption>
    </figure>`).join('\n')}
  </div>
</section>`;
}

function sedeMedia(sede) {
  if (!sede.length) {
    return `    <div class="placeholder venue-grid__wide" data-rv><span>Foto della sede<br />da inserire</span></div>`;
  }
  return `    <div class="carosello venue-grid__wide" data-carousel data-carousel-auto="3000" data-rv tabindex="0"
         aria-roledescription="carosello" aria-label="Foto della sede">
      <div class="carosello__pista" data-carousel-track>
${sede.map((f, i) => `        <figure class="carosello__voce">
          <img src="${small(f)}" ${srcset(f)} sizes="(max-width: 900px) 100vw, 800px"
               data-zoom="sede" alt="La sede di CF Consulting a Terni — foto ${i + 1}"
               loading="${i ? 'lazy' : 'eager'}" width="640" height="360" />
        </figure>`).join('\n')}
      </div>
      <button type="button" class="carosello__btn carosello__btn--prev" data-carousel-prev
              aria-label="Foto precedente">&#8249;</button>
      <button type="button" class="carosello__btn carosello__btn--next" data-carousel-next
              aria-label="Foto successiva">&#8250;</button>
      <div class="carosello__barra">
        <button type="button" class="carosello__pausa" data-carousel-pause
                aria-pressed="false" aria-label="Ferma lo scorrimento automatico">&#8214;</button>
        <span class="carosello__conta" data-carousel-count></span>
      </div>
    </div>`;
}

/** La mappa resta dietro al consenso cookie, come su Contatti. */
function mappaSede() {
  return `    <div class="venue-grid__map" data-rv
         data-map="https://www.google.com/maps?q=Via+Aldo+Bartocci+7,+05100+Terni+TR,+Italia&amp;output=embed">
      <div class="map-consent map-consent--compact">
        <div class="map-consent__label">Mappa Google Maps</div>
        <button type="button" data-map-load>Carica la mappa</button>
      </div>
    </div>`;
}

/** Foto affiancata a un blocco di racconto su Chi siamo. */
function raccontoFoto(sede, indice, alt) {
  const f = sede[indice] || sede[0];
  if (!f) return '';
  return `    <div class="racconto__foto">
      <img src="${small(f)}" ${srcset(f)} sizes="(max-width: 900px) 100vw, 560px"
           data-zoom="sede" alt="${esc(alt)}" loading="lazy" width="640" height="480" />
    </div>`;
}

function siblingLinks(area, current) {
  return area.items.filter((i) => i !== current).map((it) => `    <a class="sibling" href="${subHref(area, it)}">
      <span class="sibling__name">${esc(it)}</span>
      <span class="sibling__arrow" aria-hidden="true">→</span>
    </a>`).join('\n');
}

/** Anni compiuti dalla costituzione: si aggiorna da solo a ogni build,
 *  così il numero in pagina non invecchia senza che nessuno lo noti. */
function anniAttivita(dataIso) {
  const nascita = new Date(dataIso);
  const oggi = new Date();
  let anni = oggi.getFullYear() - nascita.getFullYear();
  const compleanno = new Date(oggi.getFullYear(), nascita.getMonth(), nascita.getDate());
  if (oggi < compleanno) anni--;
  return anni;
}

/* --- news --------------------------------------------------- */

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** "2026-09-24" -> "24 settembre 2026" */
function dataEstesa(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[3])} ${MESI[Number(m[2]) - 1]} ${m[1]}`;
}

function newsList(news, fonti) {
  const perId = new Map(fonti.map((f) => [f.id, f]));

  // Due interruttori distinti, di proposito.
  //   attiva              se raccogliere ancora notizie nuove da questa fonte
  //   mantieniPubblicati  se lasciare online quelle già pubblicate
  // Spegnere una fonte perché le sue condizioni d'uso sono cambiate non
  // rende illecito ciò che è già stato pubblicato: la pagina non deve
  // svuotarsi da sola. L'archivio si toglie solo con una scelta esplicita.
  const visibili = news.filter((n) => perId.get(n.fonte)?.mantieniPubblicati !== false);

  if (!visibili.length) {
    return '    <p class="news-vuoto">Nessuna notizia pubblicata al momento.</p>';
  }

  return visibili.map((n) => {
    const fonte = perId.get(n.fonte);
    const media = n.foto
      ? `      <div class="news-item__media">
        <img src="${small(n.foto)}" ${srcset(n.foto)} sizes="(max-width: 700px) 100vw, 260px"
             alt="" loading="lazy" width="640" height="480" />
      </div>\n`
      : '';

    return `    <article class="news-item${n.foto ? ' news-item--foto' : ''}" data-rv>
${media}      <div class="news-item__body">
        <div class="news-item__meta">
          <time datetime="${esc(n.data)}">${dataEstesa(n.data)}</time>
          <span class="news-item__fonte">${esc(fonte.nome)}</span>
        </div>
        <h2 class="news-item__title">
          <a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.titolo)}</a>
        </h2>
${n.nota ? `        <p class="news-item__nota">${esc(n.nota)}</p>\n` : ''}        <div class="rule" data-line></div>
        <a class="news-item__link" href="${esc(n.url)}" target="_blank" rel="noopener nofollow">
          Leggi su ${esc(fonte.attribuzione || fonte.nome)}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>`;
  }).join('\n');
}

/** Il periodo di conservazione dei messaggi non lo possiamo inventare:
 *  se il cliente non l'ha ancora indicato, la pagina lo dice in chiaro
 *  e il build avvisa, così non finisce online un documento incompleto. */
let conservazioneMancante = false;
function conservazione(valore) {
  if (valore) return esc(valore);
  conservazioneMancante = true;
  return '<mark class="legale__manca">periodo da definire con il cliente</mark>';
}

/* --- assemblaggio ------------------------------------------- */

function markCurrent(html, nav) {
  return html.replace(/ data-nav="([a-z-]+)"/g, (_, key) =>
    key === nav ? ' aria-current="page"' : '');
}

const areas = JSON.parse(await read(SRC, 'data', 'areas.json'));
const projects = await leggiCartella('progetti', (p, nome) => {
  p.slug = nome;                       // il nome del file è lo slug: non cambia
  p.img = (p.foto || [])[0] || '';     // la copertina è sempre la prima foto
  Object.assign(p, p.scheda || {});    // nel CMS la scheda tecnica è un gruppo,
                                       // qui i campi tornano comodi in piano
});
// Un progetto appena creato dal pannello di solito non ha «Ordine»: va in
// cima, nell'archivio e nel feed. In fondo uscirebbe dai primi 30 del feed,
// e Zapier non lo vedrebbe mai: niente post sui social.
const posizione = (p) => (Number.isFinite(p.ordine) ? p.ordine : -1);
projects.sort((a, b) => posizione(a) - posizione(b));
const fonti = await leggiCartella('fonti', (f, nome) => { f.id = nome; });
// le notizie si ordinano per data, dalla più recente
const news = (await leggiCartella('news', (n, nome) => { n.id = nome; }))
  .sort((a, b) => String(b.data).localeCompare(String(a.data)));
const paginaNews = JSON.parse(await read(SRC, 'data', 'pagina-news.json'));
const serviceText = JSON.parse(await read(SRC, 'data', 'servizi-contenuti.json'));
const team = JSON.parse(await read(SRC, 'data', 'team.json'));
const azienda = JSON.parse(await read(SRC, 'data', 'azienda.json'));
const layout = await read(SRC, 'layout.html');
const heroGrid = (await read(SRC, 'partials', 'hero-grid.html')).trim();
let footer = (await read(SRC, 'partials', 'footer.html')).trim();

let header = await read(SRC, 'partials', 'header.html');
header = header
  .replace('{{PANEL_AREAS}}', panelAreas(areas))
  .replace('{{PANEL_LISTS}}', panelLists(areas))
  .replace('{{DRAWER_AREAS}}', drawerAreas(areas));

footer = fasciaMarchi(azienda) + '\n\n' + footer
  .replace('{{RIGA_LEGALE}}', rigaLegale(azienda.legale))
  .replace('{{RIGA_ALBO}}', rigaAlbo(azienda.legale.albo))
  .replace('{{ANNO}}', String(new Date().getFullYear()));

// le cartelle generate si ricreano da zero: altrimenti restano in giro
// le pagine di build precedenti con slug ormai cambiati
for (const dir of ['progetti', 'servizi']) {
  await rm(join(ROOT, dir), { recursive: true, force: true });
}

// versione degli asset: evita che i browser servano CSS e JS vecchi
const assetVersion = Math.max(
  (await stat(join(ROOT, 'assets', 'css', 'site.css'))).mtimeMs,
  (await stat(join(ROOT, 'assets', 'js', 'site.js'))).mtimeMs
).toFixed(0).slice(-8);

// censisce le varianti piccole disponibili
async function censisci(dir) {
  for (const voce of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${voce.name}`;
    if (voce.isDirectory()) await censisci(rel);
    else if (voce.name.endsWith('-sm.webp')) piccole.add(rel);
  }
}
await censisci('img');

const written = [];

async function emit(meta, content) {
  const depth = meta.out.split('/').length - 1;
  const base = depth ? '../'.repeat(depth) : '';

  let html = layout
    .replace(/\{\{title\}\}/g, esc(meta.title))
    .replace(/\{\{description\}\}/g, esc(meta.description))
    .replace(/\{\{canonical\}\}/g, meta.canonical)
    .replace(/\{\{assetVersion\}\}/g, assetVersion)
    .replace(/\{\{ogImage\}\}/g, meta.ogImage || SITE + 'img/logo-cf-dark.webp')
    .replace('{{header}}', markCurrent(header, meta.nav))
    .replace('{{content}}', content.replace('{{heroGrid}}', heroGrid).trim())
    .replace('{{footer}}', footer);

  // pagine in sottocartella: riscrive i percorsi relativi
  if (base) {
    const rialza = (url) => /^(https?:|mailto:|tel:|#|\.\.\/|data:)/.test(url) ? url : base + url;

    html = html.replace(/(src|href)="([^"]+)"/g,
      (_, attr, url) => `${attr}="${rialza(url)}"`);

    // srcset è una lista «percorso larghezza, percorso larghezza»
    html = html.replace(/srcset="([^"]+)"/g, (_, lista) => {
      const voci = lista.split(',').map((voce) => {
        const [url, ...resto] = voce.trim().split(/\s+/);
        return [rialza(url), ...resto].join(' ');
      });
      return `srcset="${voci.join(', ')}"`;
    });
  }

  const outPath = join(ROOT, meta.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  written.push(meta.out);
}

/* --- 1. pagine singole -------------------------------------- */

for (const file of (await readdir(join(SRC, 'pages'))).filter((f) => f.endsWith('.html'))) {
  const raw = await read(SRC, 'pages', file);
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file}: blocco <!--meta ... --> mancante`);
  const meta = JSON.parse(m[1]);

  const content = raw.slice(m[0].length)
    .replace('{{AREAS_INDEX}}', areasIndex(areas))
    .replace('{{ARCHIVE_CARDS}}', archiveCards(projects))
    .replace('{{HOME_FEATURED}}', homeFeatured(projects))
    .replace('{{HOME_TRIO}}', homeTrio(projects))
    .replace('{{PROJECT_COUNT}}', String(projects.length))
    .replace('{{ANNI_ATTIVITA}}', String(anniAttivita(azienda.fondazione)))
    .replace('{{CERT_COUNT}}', String(azienda.certificazioni.length))
    .replace('{{NEWS_LIST}}', newsList(news, fonti))
    .replace(/\{\{LEGALE_DENOMINAZIONE\}\}/g, esc(azienda.legale.denominazione))
    .replace(/\{\{LEGALE_SEDE\}\}/g, esc(azienda.legale.sedeLegale))
    .replace(/\{\{LEGALE_PIVA\}\}/g, esc(azienda.legale.partitaIva))
    .replace(/\{\{EMAIL_PRIVACY\}\}/g, esc(azienda.privacy.emailDiritti))
    .replace(/\{\{CONSERVAZIONE\}\}/g, conservazione(azienda.privacy.conservazioneForm))
    .replace(/\{\{DATA_POLICY\}\}/g, dataEstesa(azienda.privacy.ultimoAggiornamento))
    .replace('{{NEWS_TITOLO}}', esc(paginaNews.titolo))
    .replace('{{NEWS_SOMMARIO}}', esc(paginaNews.sommario))
    .replace('{{NEWS_NOTA}}', esc(paginaNews.nota))
    .replace('{{TEAM}}', teamCards(team))
    .replace('{{PUBLIC_BODIES}}', String(publicBodies(projects)))
    .replace('{{CERTIFICAZIONI}}', certLogos(azienda.certificazioni))
    .replace('{{SEDE}}', sedeMedia(azienda.sede))
    .replace('{{MAPPA_SEDE}}', mappaSede())
    .replace('{{RACCONTO_FOTO_1}}', raccontoFoto(azienda.sede, 3, 'La sala riunioni di CF Consulting a Terni'))
    .replace('{{RACCONTO_FOTO_2}}', raccontoFoto(azienda.sede, 5, 'Gli uffici di CF Consulting a Terni'));

  await emit(meta, content);
}

/* --- 2. le 22 pagine sotto-servizio ------------------------- */

const tplServizio = await read(SRC, 'templates', 'servizio.html');
const relatedPool = projects.filter((p) => p.img).slice(0, 3);

/** Primo periodo dell'introduzione, usato come sommario nell'hero. */
function firstSentence(text, max = 180) {
  if (!text) return '';
  const m = text.match(/^(.{40,}?[.!?])(\s|$)/);
  const s = (m ? m[1] : text).trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s\S*$/, '') + '…' : s;
}

function prose(paragraphs) {
  if (!paragraphs.length) {
    return '        <p>Testo del servizio da inserire.</p>';
  }
  return paragraphs.map((p) => `        <p>${esc(p)}</p>`).join('\n');
}

/** Elenco «Cosa comprende»: reso solo se il sito attuale ha le voci. */
function elencoBlock(items) {
  if (!items.length) return '';
  return `
      <div class="facts" data-rv>
        <div class="facts__col">
          <div class="facts__label">Cosa comprende</div>
          <ul class="ticks">
${items.map((i) => `            <li>${esc(i)}</li>`).join('\n')}
          </ul>
        </div>
      </div>`;
}

for (const area of areas) {
  for (const item of area.items) {
    const testo = serviceText[`${area.id}/${slug(item)}`] || { intro: [], elenco: [] };
    const lead = firstSentence(testo.intro[0]) || `Area ${area.name.toLowerCase()}.`;

    const content = tplServizio
      .replace(/\{\{nome\}\}/g, esc(item))
      .replace(/\{\{areaNome\}\}/g, esc(area.name))
      .replace(/\{\{areaId\}\}/g, area.id)
      .replace(/\{\{lead\}\}/g, esc(lead))
      .replace('{{PROSE}}', prose(testo.intro))
      .replace('{{ELENCO}}', elencoBlock(testo.elenco))
      .replace('{{RELATED}}', projectCards(relatedPool))
      .replace('{{SIBLINGS}}', siblingLinks(area, item));

    await emit({
      out: `servizi/${area.id}/${slug(item)}.html`,
      nav: 'servizi',
      title: `${item} — CF Consulting, Terni`,
      description: firstSentence(testo.intro[0], 155)
        || `${item}: il servizio di CF Consulting, studio di ingegneria a Terni.`,
      canonical: `${SITE}servizi/${area.id}/${slug(item)}.html`
    }, content);
  }
}

/* --- 3. le pagine progetto ---------------------------------- */

const tplProgetto = await read(SRC, 'templates', 'progetto.html');

const BLOCCHI = [
  ['descrizione', 'Descrizione progetto'],
  ['committente', 'Committente'],
  ['impresa', 'Impresa appaltatrice'],
  ['progettisti', 'Progettisti'],
  ['servizi', 'Servizi svolti'],
];

/** I blocchi con paragrafi brevi (indirizzi, elenchi di nomi) diventano liste. */
function blockBody(paragraphs) {
  const short = paragraphs.every((p) => p.length < 90);
  if (short && paragraphs.length > 2) {
    return `          <ul class="rule-list">
${paragraphs.map((p) => `            <li>${esc(p)}</li>`).join('\n')}
          </ul>`;
  }
  return paragraphs.map((p) => `          <p>${esc(p)}</p>`).join('\n');
}

function projectBlocks(p) {
  const out = [];
  let i = 0;
  for (const [key, label] of BLOCCHI) {
    const paragraphs = (p.blocchi && p.blocchi[key]) || [];
    if (!paragraphs.length) continue;
    const open = i === 0;
    out.push(`      <div${i === 0 ? ' class="accordion"' : ''} data-rv>
        <button type="button" class="accordion__btn" aria-expanded="${open}" aria-controls="cf-b${i}">
          <span class="accordion__label">${label}</span>
          <span class="accordion__sign" aria-hidden="true">+</span>
        </button>
        <div class="accordion__body" id="cf-b${i}">
${blockBody(paragraphs)}
        </div>
      </div>`);
    i++;
  }
  return out.join('\n');
}

function sheetRows(p) {
  const rows = [
    ['Categoria', p.categoria],
    ['Stato', p.stato],
    ['Inizio lavori', p.inizio],
    ['Fine lavori', p.fine],
    ['Impresa', p.impresa],
    ['Progettista', p.responsabile],
  ].filter(([, v]) => v && v !== '—');

  return rows.map(([k, v]) =>
    `        <div class="sheet__row"><span class="sheet__k">${k}</span><span class="sheet__v">${esc(v)}</span></div>`
  ).join('\n');
}

function gallery(p) {
  const foto = (p.foto || []).slice(1);   // la prima è già l'immagine di apertura
  if (!foto.length) return '';

  const items = foto.map((f, i) => `      <div class="gallery__item" data-rv>
        <img src="${small(f)}" ${srcset(f)} sizes="(max-width: 700px) 100vw, 400px"
             data-zoom="progetto" alt="${esc(p.shortTitle)} — foto ${i + 2}"
             loading="lazy" width="640" height="480" />
      </div>`).join('\n');

  return `<section class="section-tint section-tint--both">
  <div class="container section-inner-wide">
    <div class="gallery-head" data-rv><span data-gallery-counter></span></div>
    <div class="gallery" data-gallery>
${items}
    </div>
    <div class="gallery-more">
      <button type="button" class="btn--load" data-gallery-more>Carica tutte le immagini</button>
    </div>
  </div>
</section>`;
}

for (const p of projects) {
  const others = projects.filter((o) => o.slug !== p.slug && o.img).slice(0, 3);

  const figure = p.img
    ? `<img src="${p.img}" ${srcset(p.img)} sizes="(max-width: 1240px) 100vw, 1184px"
             data-zoom="progetto" alt="${esc(p.shortTitle)} — foto 1" width="1600" height="800" />`
    : '<div class="gallery__empty"><span>Immagine di progetto<br />da caricare</span></div>';

  let content = tplProgetto
    .replace('{{FIGURE}}', figure)
    .replace('{{BLOCCHI}}', projectBlocks(p))
    .replace('{{SCHEDA}}', sheetRows(p))
    .replace('{{GALLERIA}}', gallery(p))
    .replace('{{OTHERS}}', projectCards(others));

  for (const key of ['shortTitle', 'lead', 'committente', 'luogo', 'anno', 'importo']) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), esc(p[key] || '—'));
  }

  await emit({
    out: projectHref(p),
    nav: 'progetti',
    title: `${p.shortTitle} — CF Consulting`,
    description: firstSentence(p.lead, 155) || `${p.title}. Progetto CF Consulting.`,
    canonical: SITE + projectHref(p),
    ogImage: p.img ? SITE + p.img : undefined
  }, content);
}

/* --- 4. sitemap e robots ------------------------------------ */

const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + written.map((u) => `  <url><loc>${SITE}${u === 'index.html' ? '' : u}</loc></url>`).join('\n')
  + '\n</urlset>\n';
await writeFile(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

/* --- feed dei progetti -------------------------------------- */
// È il ponte fra il pannello e i social: quando il cliente pubblica un
// progetto, il sito si ricostruisce, il progetto compare qui, e Zapier
// se ne accorge. Niente webhook, che sul piano gratuito non ci sono.
//
// L'indirizzo di base lo dà Netlify al momento della costruzione: così
// il feed punta da solo all'anteprima finché il dominio non è spostato,
// e al dominio vero appena lo sarà, senza modifiche al codice.
{
  const base = (process.env.URL || SITE).replace(/\/+$/, '') + '/';
  const quando = new Date().toUTCString();

  // Il guid NON contiene l'indirizzo: e' con lui che Zapier riconosce i
  // progetti gia' visti. Se dipendesse dal dominio, il giorno del lancio
  // tutti i progetti sembrerebbero nuovi e verrebbero ripubblicati sui
  // social in blocco. Lo slug invece non cambia mai.
  const voci = projects.slice(0, 30).map((p) => {
    const url = base + projectHref(p);
    const foto = p.img ? base + p.img : '';
    return `    <item>
      <title>${esc(p.shortTitle)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="false">cf-consulting-progetto-${esc(p.slug)}</guid>
      <description>${esc(p.lead || p.title)}</description>
      <category>${esc(p.cat)}</category>${foto ? `
      <enclosure url="${esc(foto)}" type="image/webp" length="0" />` : ''}
    </item>`;
  }).join('\n');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CF Consulting — Progetti</title>
    <link>${esc(base)}progetti.html</link>
    <description>I progetti pubblicati da CF Consulting S.r.l.</description>
    <language>it-IT</language>
    <lastBuildDate>${quando}</lastBuildDate>
${voci}
  </channel>
</rss>
`;
  await writeFile(join(ROOT, 'progetti.xml'), feed, 'utf8');
  console.log(`progetti.xml: feed con ${Math.min(projects.length, 30)} progetti (base ${base})`);
}

/* --- reindirizzamenti dal vecchio sito ---------------------- */
// Il file lo legge solo Netlify: in locale e' inerte e non tocca nessuna pagina.
// L'ordine conta, Netlify applica la prima regola che combacia: prima gli
// indirizzi esatti, le regole con l'asterisco per ultime.
{
  const mappa = JSON.parse(await read(SRC, 'data', 'redirect.json'));
  const provenienza = JSON.parse(await read(SRC, 'data', 'provenienza.json'));
  const righe = [];
  const larghezza = 78;

  const blocco = (titolo, coppie) => {
    if (!coppie.length) return;
    righe.push(`# ${titolo}`);
    for (const [da, a] of coppie) righe.push(`${da.padEnd(larghezza)} ${a}  301`);
    righe.push('');
  };

  // le 79 schede: l'indirizzo vecchio sta nella provenienza dello scraping
  const schede = [];
  for (const p of projects) {
    const fonte = provenienza[p.slug]?.fonte;
    const m = fonte && fonte.match(/\/portfolio-lavori\/([^/]+)\//);
    if (m) schede.push([`/portfolio-lavori/${m[1]}/`, `/${projectHref(p)}`]);
  }
  schede.sort((a, b) => a[0].localeCompare(b[0]));

  righe.push('# Reindirizzamenti dal vecchio sito WordPress al nuovo.');
  righe.push('# Generato da build.mjs: non modificare a mano, si riscrive a ogni build.');
  righe.push('# Le voci da cambiare stanno in src/data/redirect.json.');
  righe.push('');
  blocco('Pagine principali', Object.entries(mappa.pagine));
  blocco(`Schede progetto (${schede.length})`, schede);
  blocco('Pagine servizio', Object.entries(mappa.servizi));
  blocco('Vecchi articoli', Object.entries(mappa.articoli));
  blocco('Regole generali: sempre per ultime', Object.entries(mappa.generali));

  await writeFile(join(ROOT, '_redirects'), righe.join('\n') + '\n', 'utf8');
  const quante = righe.filter((r) => r.includes('301')).length;
  console.log(`_redirects: ${quante} regole (${schede.length} schede progetto)`);
}

await writeFile(join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`, 'utf8');

console.log(`${written.length} pagine + sitemap.xml + robots.txt`);
// il blocco ai motori e' comodo adesso e disastroso al lancio:
// meglio un avviso a ogni build che un sito invisibile per settimane
try {
  const toml = await read(ROOT, 'netlify.toml');
  if (/X-Robots-Tag\s*=\s*"noindex/.test(toml)) {
    console.log('\nNOTA: il sito è escluso dai motori di ricerca (X-Robots-Tag in');
    console.log('netlify.toml). Giusto adesso, da togliere il giorno del lancio.');
  }
} catch { /* in locale netlify.toml puo' non esserci */ }

if (conservazioneMancante) {
  console.log('\nATTENZIONE: nella privacy policy manca il periodo di conservazione dei');
  console.log('messaggi del modulo contatti. Da chiedere al cliente e scrivere in');
  console.log('src/data/azienda.json -> privacy.conservazioneForm (es. "24 mesi").');
}
