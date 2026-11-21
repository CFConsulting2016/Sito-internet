/**
 * CF Consulting — generatore del sito statico.
 *
 * Unisce il partial condiviso (header + pannello servizi + drawer + footer)
 * alle pagine in src/pages/ e ai due template in src/templates/, e scrive
 * HTML statico nella radice del progetto: `node build.mjs`.
 * Unica dipendenza, facoltativa: sharp, per le immagini di condivisione JPEG
 * (vedi «immagini di condivisione» più sotto). Senza, il sito si costruisce
 * lo stesso.
 */
import { readFile, writeFile, readdir, mkdir, rm, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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

/** Taglia un testo a `max` caratteri alla parola intera, con «…» in coda.
 *  Toglie la punteggiatura e le parole vuote rimaste appese alla fine. */
function tagliaParola(testo, max) {
  const s = String(testo || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let t = s.slice(0, max).replace(/\s+\S*$/, '');   // «…» compreso nei max
  const appese = /(?:[\s,;:–—\-(/]+|\s+(?:e|ed|o|di|del|della|dei|degli|delle|da|in|a|al|alla|con|per|su|il|lo|la|le|gli|i|un|una|che|è|n\.?))$/i;
  while (appese.test(t)) t = t.replace(appese, '');
  return t + '…';
}

/** Primo periodo di un testo, entro `max` caratteri. Non si ferma sui punti
 *  delle abbreviazioni («n. 63», «D.Lgs. 81», «art. 14», «c.a.»): finiva lì
 *  e la frase restava monca. Se il periodo è troppo lungo, taglia alla parola. */
const ABBREVIAZIONI = /(?:^|[\s(.])(?:\p{L}{1,2}|d\.lgs|lgs|art|artt|ing|arch|geom|dott|sig|ss|pag|cfr|ecc|loc|fraz|ex|tab|cap|reg|dir|min|lett|co)\.$/iu;
function firstSentence(text, max = 180) {
  // via anche i caratteri invisibili incollati dal vecchio sito (trattino morbido)
  const s = String(text || '').replace(/[­​﻿]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const fine = /[.!?](?=\s|$)/g;
  let m;
  while ((m = fine.exec(s))) {
    const fino = s.slice(0, m.index + 1);
    if (fino.length < 40) continue;
    if (m[0] === '.' && ABBREVIAZIONI.test(fino)) continue;
    if (fino.length > max) break;
    return fino;
  }
  return tagliaParola(s, max);
}

/** Larghezza e altezza di un'immagine WebP, lette dall'intestazione del file:
 *  servono a width/height dei marchi, senza dipendere da sharp. */
async function misureWebp(file) {
  try {
    const b = await readFile(join(ROOT, file));
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const tipo = b.toString('ascii', 12, 16);
    if (tipo === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (tipo === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
    }
    if (tipo === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  } catch { /* file mancante: niente misure */ }
  return null;
}
const attrMisure = (m) => (m ? ` width="${m.w}" height="${m.h}"` : '');

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

function certLogos(certificazioni, misure) {
  if (!certificazioni.length) {
    return '      <div class="cert"><span class="cert__todo">loghi da inserire</span></div>';
  }
  return certificazioni.map((c) => `      <div class="cert">
        <img class="cert__logo" src="${c.file}" alt="${esc(c.nome)}"${attrMisure(misure.get(c.file))} loading="lazy" />
        <span class="cert__name">${esc(c.nome)}</span>
      </div>`).join('\n');
}

/** Le schede delle certificazioni in Chi siamo: d'impresa e personali,
 *  ciascuna con il suo PDF da scaricare quando c'è. */
async function certificatiSchede(azienda) {
  const voci = [
    ...(azienda.certificazioni || []).map((c) => ({
      tipo: "Certificazione d'impresa", titolo: c.nome, chi: azienda.legale.denominazione,
      dettaglio: c.ambito, ente: c.ente, numero: c.numero, scadenza: c.scadenza, pdf: c.pdf })),
    ...(azienda.certificazioniPersonali || []).map((c) => ({
      tipo: 'Certificazione personale', titolo: c.titolo, chi: c.persona,
      dettaglio: c.specializzazione, ente: c.ente, numero: c.numero, scadenza: c.scadenza, pdf: c.pdf })),
  ];
  const schede = [];
  for (const v of voci) {
    let scarica = '';
    if (v.pdf) {
      const kb = Math.round((await stat(join(ROOT, v.pdf))).size / 1024);
      scarica = `
        <a class="certificato__pdf" href="${esc(v.pdf)}" target="_blank" rel="noopener">Scarica il certificato <span>PDF, ${kb} KB</span></a>`;
    }
    schede.push(`      <article class="certificato" data-rv>
        <div class="certificato__tipo">${esc(v.tipo)}</div>
        <h3 class="certificato__titolo">${esc(v.titolo)}</h3>
        <div class="certificato__chi">${esc(v.chi)}</div>${v.dettaglio ? `
        <p class="certificato__dettaglio">${esc(v.dettaglio)}</p>` : ''}
        <dl class="certificato__dati">
          <div><dt>Ente</dt><dd>${esc(v.ente)}</dd></div>
          <div><dt>Numero</dt><dd>${esc(v.numero)}</dd></div>
          <div><dt>Valida fino al</dt><dd><time datetime="${esc(v.scadenza)}">${dataEstesa(v.scadenza)}</time></dd></div>
        </dl>${scarica}
      </article>`);
  }
  return schede.join('\n');
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
  if (l.socioUnico) voci.splice(1, 0, 'Società con socio unico');
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
function fasciaMarchi(azienda, misure) {
  const voci = [];
  for (const c of (azienda.certificazioni || []).filter((x) => x.file)) { // senza marchio non c'è logo da mostrare
    const testo = `${c.nome} &middot; certificato n. ${c.numero} &middot; ${c.ente}`;
    voci.push({ file: c.file, alt: `${c.nome} — ${c.ente}`,
      testo: c.pdf ? `<a href="${esc(c.pdf)}" target="_blank" rel="noopener">${testo}</a>` : testo });
  }
  for (const s of azienda.sostegni || []) {
    voci.push({ file: s.file, alt: s.nome, testo: s.testo });
  }
  // sotto i loghi, l'anteprima di ogni certificato (d'impresa e personali):
  // cliccandola si apre il PDF (richiesta del cliente, 21/11/2026)
  const certi = [...(azienda.certificazioni || []), ...(azienda.certificazioniPersonali || [])]
    .filter((c) => c.anteprima && c.pdf);
  if (!voci.length && !certi.length) return '';

  const miniature = certi.length ? `
  <div class="container certificati-mini">
${certi.map((c) => {
    const titolo = c.nome || c.titolo;
    const chi = c.persona || '';
    return `    <a class="certificato-mini" href="${esc(c.pdf)}" target="_blank" rel="noopener" title="${esc([titolo, chi].filter(Boolean).join(' — '))} (PDF)">
      <img src="${c.anteprima}" alt="Certificato ${esc(titolo)}${chi ? ' — ' + esc(chi) : ''}"${attrMisure(misure.get(c.anteprima))} loading="lazy" />
      <span class="certificato-mini__nome">${esc(titolo)}</span>${chi ? `
      <span class="certificato-mini__chi">${esc(chi)}</span>` : ''}
    </a>`;
  }).join('\n')}
  </div>` : '';

  return `<section class="marchi">
  <div class="container marchi__inner">
${voci.map((v) => `    <figure class="marchio">
      <img class="marchio__logo" src="${v.file}" alt="${esc(v.alt)}"${attrMisure(misure.get(v.file))} loading="lazy" />
      <figcaption class="marchio__testo">${v.testo}</figcaption>
    </figure>`).join('\n')}
  </div>${miniature}
</section>`;
}

/** L'immagine della prima pagina del certificato: quella caricata dal pannello
 *  o, se manca, img/certificazioni/anteprime/<nome del PDF>.webp. */
function anteprimaCert(c) {
  if (c.anteprima) return String(c.anteprima).replace(/^\/+/, '');
  const nome = (c.pdf || '').split('/').pop().replace(/\.pdf$/i, '');
  const f = nome && `img/certificazioni/anteprime/${nome}.webp`;
  return f && existsSync(join(ROOT, f)) ? f : '';
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
  // Ogni notizia resta online due mesi, poi sparisce da sola alla prima
  // ricostruzione: il file resta, così la raccolta non la ripubblica.
  const scadenza = new Date(Date.now() - 61 * 864e5).toISOString().slice(0, 10);
  const visibili = news.filter((n) => perId.get(n.fonte)?.mantieniPubblicati !== false
    && String(n.data) >= scadenza);

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

// Il giorno della costruzione, all'ora italiana: decide «In corso» o «Concluso».
const OGGI = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

const areas = JSON.parse(await read(SRC, 'data', 'areas.json'));
const tuttiProgetti = await leggiCartella('progetti', (p, nome) => {
  p.slug = nome;                       // il nome del file è lo slug: non cambia
  p.img = (p.foto || [])[0] || '';     // la copertina è sempre la prima foto
  Object.assign(p, p.scheda || {});    // nel CMS la scheda tecnica è un gruppo,
                                       // qui i campi tornano comodi in piano
  completaProgetto(p);
});

/**
 * Dal pannello il cliente incolla solo i cinque testi (descrizione,
 * committente, impresa, progettisti, servizi), sceglie la data e scrive
 * l'importo. Tutto il resto si ricava da lì: la tabellina in alto, la scheda
 * tecnica, il sommario, il filtro Pubblico/Privato. Un valore scritto a mano
 * nella scheda vince sempre su quello ricavato.
 */
function completaProgetto(p) {
  const vuoto = (v) => v === undefined || v === null || String(v).trim() === '' || v === '—';
  const righe = (v) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/))
    .map((r) => String(r).trim()).filter(Boolean);

  // i testi arrivano come un unico riquadro: una riga, un paragrafo
  const b = p.blocchi = p.blocchi || {};
  for (const k of ['descrizione', 'committente', 'impresa', 'progettisti', 'servizi']) b[k] = righe(b[k]);

  if (vuoto(p.committente) && b.committente.length) p.committente = b.committente[0];
  // Il luogo non si ricava dall'indirizzo del committente: è la sede di chi
  // ha dato l'incarico, non per forza il cantiere. Esce solo se scritto.
  if (vuoto(p.luogo) && !vuoto(p.luogoCantiere)) p.luogo = String(p.luogoCantiere).trim();
  if (vuoto(p.impresa) && b.impresa.length) p.impresa = b.impresa[0];
  if (vuoto(p.responsabile)) {
    // «Progettista responsabile: Ing. Rossi», oppure «Progettista Responsabile»
    // senza due punti, da solo o seguito da altri ruoli («…, Direttore dei
    // Lavori»), e il nome sulla riga dopo
    const pr = b.progettisti;
    const conNome = pr.map((x) => x.match(/progettista\s+responsabile\s*:\s*(.+)/i)).find(Boolean);
    const titolo = pr.findIndex((x) => /^progettista\s+responsabile\b[^:]*$/i.test(x));
    if (conNome) p.responsabile = conNome[1].trim();
    else if (titolo >= 0 && pr[titolo + 1]) p.responsabile = pr[titolo + 1];
  }
  // Le date: «data» è l'inizio lavori, «dataFine» la fine (facoltativa). Sul
  // sito escono per esteso; un valore scritto a mano nella scheda vince.
  const iso = (v) => (String(v || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
  const inizioIso = iso(p.data);
  const fineIso = iso(p.dataFine);
  if (vuoto(p.inizio) && inizioIso) p.inizio = dataEstesa(inizioIso);
  if (vuoto(p.fine) && fineIso) p.fine = dataEstesa(fineIso);
  // Lo stato si calcola alla costruzione: senza fine, o con la fine ancora da
  // venire, i lavori sono in corso. «—» scelto a mano nella scheda lo nasconde.
  if (vuoto(p.stato) && p.stato !== '—' && (inizioIso || fineIso)) {
    p.stato = !fineIso || fineIso >= OGGI ? 'In corso' : 'Concluso';
  }
  // La cella in alto mostra l'inizio lavori. I progetti vecchi senza data
  // tengono la loro «Data» scritta a mano (spesso un intervallo, «2021–2022»).
  if (inizioIso || (vuoto(p.anno) && !vuoto(p.inizio))) { p.cellaDataK = 'Inizio lavori'; p.cellaDataV = p.inizio; }
  else { p.cellaDataK = 'Data'; p.cellaDataV = p.anno; }
  if (typeof p.importoLavoro === 'number') {
    p.importo = `€ ${p.importoLavoro.toLocaleString('it-IT', { maximumFractionDigits: 2 })}`;
  }
  if (p.cat !== 'Pubblico' && p.cat !== 'Privato') {
    const pubblico = /\b(comune|provincia|regione|ater|roma capitale|ministero|questura|prefettura|guardia di finanza|carabinieri|polizia|consorzio di bonifica|comunit[aà] montana|universit[aà]|istituto|scuola|asl|azienda sanitaria|agenzia del demanio|stato)\b/i;
    p.cat = pubblico.test(p.committente || '') ? 'Pubblico' : 'Privato';
  }
  if (vuoto(p.shortTitle)) p.shortTitle = p.title;
  if (vuoto(p.tag)) p.tag = p.committente || (p.cat === 'Pubblico' ? 'Committente pubblico' : 'Committente privato');
  if (vuoto(p.lead) && b.descrizione.length) p.lead = b.descrizione[0];
  if (vuoto(p.categoria)) p.categoria = p.cat;
}

// Un progetto appena creato dal pannello di solito non ha «Ordine»: va in
// cima, nell'archivio e nel feed. In fondo uscirebbe dai primi 30 del feed,
// e Zapier non lo vedrebbe mai: niente post sui social.
const posizione = (p) => (Number.isFinite(p.ordine) ? p.ordine : -1);
tuttiProgetti.sort((a, b) => posizione(a) - posizione(b));
// Un progetto senza foto né testo non si pubblica: la scheda sarebbe vuota.
// Resta nel pannello e compare da solo appena gli si aggiunge qualcosa.
const haContenuto = (p) => (p.foto || []).length > 0 || Boolean(p.lead)
  || ((p.blocchi || {}).descrizione || []).length > 0;
const projects = tuttiProgetti.filter(haContenuto);
if (projects.length < tuttiProgetti.length) {
  console.log(`progetti: ${tuttiProgetti.length - projects.length} senza foto né testo, non pubblicati`);
}
const fonti = await leggiCartella('fonti', (f, nome) => { f.id = nome; });
// le notizie si ordinano per data, dalla più recente
const news = (await leggiCartella('news', (n, nome) => { n.id = nome; }))
  .sort((a, b) => String(b.data).localeCompare(String(a.data)));
const paginaNews = JSON.parse(await read(SRC, 'data', 'pagina-news.json'));
const serviceText = JSON.parse(await read(SRC, 'data', 'servizi-contenuti.json'));
const team = JSON.parse(await read(SRC, 'data', 'team.json'));
const azienda = JSON.parse(await read(SRC, 'data', 'azienda.json'));
// Le certificazioni stanno in src/certificazioni, un file ciascuna: il
// cliente le aggiunge dal pannello senza toccare gli altri dati aziendali.
// Qui tornano nella forma che usa il resto del generatore.
{
  const percorso = (p) => String(p || '').replace(/^\/+/, '');
  const certificazioni = await leggiCartella('certificazioni');
  azienda.certificazioni = certificazioni.filter((c) => c.tipo === 'impresa').map((c) => ({
    nome: c.titolo, ente: c.ente, numero: c.numero, scadenza: c.scadenza,
    ambito: c.specializzazione, file: percorso(c.marchio), pdf: percorso(c.pdf), anteprima: anteprimaCert(c) }));
  azienda.certificazioniPersonali = certificazioni.filter((c) => c.tipo !== 'impresa').map((c) => ({
    persona: c.persona, titolo: c.titolo, specializzazione: c.specializzazione,
    ente: c.ente, numero: c.numero, scadenza: c.scadenza, pdf: percorso(c.pdf), anteprima: anteprimaCert(c) }));
}
// Una certificazione scaduta non si mostra: presentarla come valida, in una
// gara, è peggio che non averla. Due mesi prima si avvisa di caricare il rinnovo.
{
  const oggi = new Date().toISOString().slice(0, 10);
  const fra60 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const valide = (elenco) => (elenco || []).filter((c) => {
    const nome = `${c.nome || c.titolo}${c.persona ? ` (${c.persona})` : ''}`;
    if (c.scadenza && c.scadenza < oggi) {
      console.log(`ATTENZIONE: certificazione scaduta il ${c.scadenza}, tolta dal sito: ${nome}`);
      return false;
    }
    if (c.scadenza && c.scadenza < fra60) {
      console.log(`ATTENZIONE: certificazione in scadenza il ${c.scadenza}, caricare il rinnovo: ${nome}`);
    }
    return true;
  });
  azienda.certificazioni = valide(azienda.certificazioni);
  azienda.certificazioniPersonali = valide(azienda.certificazioniPersonali);
}

/* --- contatti e dati strutturati ---------------------------- */
// Il dominio definitivo, come nei canonical: i dati strutturati descrivono
// l'azienda, non l'indirizzo provvisorio dell'anteprima.
const DOMINIO = 'https://www.cieffeconsulting.eu/';
const contatti = azienda.contatti;

/** "0744 196 3005" -> "+3907441963005" (per i link tel: e lo schema) */
const telInternazionale = (t) => {
  const cifre = String(t).replace(/[^\d+]/g, '');
  return cifre.startsWith('+') ? cifre : `+39${cifre}`;
};

/** Scheda JSON-LD dell'azienda, la stessa su ogni pagina. Solo dati già
 *  presenti in azienda.json: niente coordinate, prezzi o recensioni. */
const jsonLd = (() => {
  const i = contatti.indirizzo;
  const dati = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${DOMINIO}#azienda`,
    name: 'CF Consulting',
    legalName: azienda.legale.denominazione,
    url: DOMINIO,
    logo: `${DOMINIO}img/logo-cf-dark.webp`,
    foundingDate: azienda.fondazione,
    vatID: azienda.legale.partitaIva,
    telephone: telInternazionale(contatti.telefono),
    email: contatti.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: i.via,
      postalCode: i.cap,
      addressLocality: i.citta,
      addressRegion: i.provincia,
      addressCountry: i.paese,
    },
    openingHoursSpecification: contatti.orari.fasce.map(([apre, chiude]) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: contatti.orari.giorni.map((g) => `https://schema.org/${g}`),
      opens: apre,
      closes: chiude,
    })),
    sameAs: contatti.social,
  };
  // dentro <script> un «</script>» o un «<!--» nei dati chiuderebbe il blocco
  const testo = JSON.stringify(dati)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">\n${testo}\n</script>`;
})();

/* --- immagini di condivisione (og:image e feed) -------------- */
// Facebook, LinkedIn e WhatsApp documentano JPEG, PNG e GIF, non WebP, e
// consigliano 1200x630: per ogni progetto con foto se ne ricava un JPEG
// dalla prima foto, ritagliato al centro. Lo fa il build, così funziona anche
// per i progetti nuovi caricati dal pannello (che carica solo WebP).
//
// Il nome contiene un'impronta della foto sorgente: /img/* è in cache per un
// anno (netlify.toml) e Meta ricorda l'anteprima per indirizzo d'immagine,
// quindi copertina nuova = indirizzo nuovo. Se il file con quel nome c'è già
// non si rifà: quelli dei progetti esistenti sono nel repository, su Netlify
// si generano solo i nuovi. Senza sharp, o se una foto non si legge, si usa
// l'immagine predefinita (strumenti/immagine-condivisione.mjs) e il build
// va avanti lo stesso.
const OG = { w: 1200, h: 630, maxByte: 300 * 1024, cartella: 'img/condivisione/progetti' };
const OG_PREDEFINITA = 'img/condivisione/cf-consulting.jpg';
const OG_VERSIONE = 'v1';   // da cambiare se cambia il ritaglio: rinomina e rifà tutti i file

let sharp = null;
try {
  if (process.env.CF_SENZA_SHARP) throw new Error('disattivato con CF_SENZA_SHARP');
  sharp = (await import('sharp')).default;
} catch (err) {
  console.log(`AVVISO: sharp non disponibile (${err.code || err.message}): i progetti`);
  console.log('senza JPEG di condivisione già pronto useranno l\'immagine predefinita.');
}

const condivisione = new Map();   // slug -> { file, byte }
{
  const usati = new Set();
  let generati = 0;
  for (const p of projects.filter((q) => q.img)) {
    try {
      const sorgente = await readFile(join(ROOT, p.img));
      const impronta = createHash('sha1').update(OG_VERSIONE).update(sorgente).digest('hex').slice(0, 8);
      // nomi oltre 255 caratteri non si possono scrivere: si accorcia solo quando serve,
      // così le immagini dei progetti già condivisi non cambiano indirizzo
      const file = `${OG.cartella}/${p.slug.length > 200 ? p.slug.slice(0, 200) : p.slug}-${impronta}.jpg`;
      const percorso = join(ROOT, file);
      usati.add(file);
      let byte = await stat(percorso).then((s) => s.size, () => 0);
      if (!byte) {
        if (!sharp) continue;
        await mkdir(join(ROOT, OG.cartella), { recursive: true });
        // qualità 80; se una foto molto dettagliata supera il limite, si scende
        let jpeg;
        for (const quality of [80, 72, 64, 56]) {
          jpeg = await sharp(sorgente)
            .rotate()                                   // segue l'orientamento EXIF
            .resize(OG.w, OG.h, { fit: 'cover', position: 'centre' })
            .flatten({ background: '#FFFFFF' })         // eventuale trasparenza
            .jpeg({ quality, progressive: true, mozjpeg: true })
            .toBuffer();
          if (jpeg.length <= OG.maxByte) break;
        }
        await writeFile(percorso, jpeg);
        byte = jpeg.length;
        generati++;
      }
      condivisione.set(p.slug, { file, byte });
    } catch (err) {
      console.log(`AVVISO: immagine di condivisione non creata per ${p.slug} (${err.message}): uso la predefinita`);
    }
  }
  // via i JPEG di copertine non più usate (solo in questa cartella)
  let tolti = 0;
  for (const nome of await readdir(join(ROOT, OG.cartella)).catch(() => [])) {
    if (nome.endsWith('.jpg') && !usati.has(`${OG.cartella}/${nome}`)) {
      await unlink(join(ROOT, OG.cartella, nome));
      tolti++;
    }
  }
  console.log(`condivisione: ${condivisione.size} JPEG progetto (${generati} nuovi${tolti ? `, ${tolti} vecchi tolti` : ''})`);
}
const ogImmagine = (p) => condivisione.get(p.slug)?.file || OG_PREDEFINITA;

const layout = await read(SRC, 'layout.html');
const heroGrid = (await read(SRC, 'partials', 'hero-grid.html')).trim();
let footer = (await read(SRC, 'partials', 'footer.html')).trim();

let header = await read(SRC, 'partials', 'header.html');
header = header
  .replace('{{PANEL_AREAS}}', panelAreas(areas))
  .replace('{{PANEL_LISTS}}', panelLists(areas))
  .replace('{{DRAWER_AREAS}}', drawerAreas(areas));

const schedeCertificati = await certificatiSchede(azienda);

// misure vere dei marchi (fascia in fondo e loghi delle certificazioni):
// con width e height la pagina non salta quando l'immagine arriva
const misureMarchi = new Map();
for (const f of [...azienda.certificazioni.map((c) => c.file), ...(azienda.sostegni || []).map((s) => s.file),
  ...[...azienda.certificazioni, ...azienda.certificazioniPersonali].map((c) => c.anteprima)]) {
  if (f && !misureMarchi.has(f)) misureMarchi.set(f, await misureWebp(f));
}

footer = fasciaMarchi(azienda, misureMarchi) +'\n\n' + footer
  .replace('{{RIGA_LEGALE}}', rigaLegale(azienda.legale))
  .replace('{{RIGA_ALBO}}', rigaAlbo(azienda.legale.albo))
  .replace('{{ANNO}}', String(new Date().getFullYear()))
  .replace('{{FOOTER_INDIRIZZO}}', esc(`${contatti.indirizzo.via}, ${contatti.indirizzo.citta}`))
  .replace('{{FOOTER_TEL_LINK}}', telInternazionale(contatti.telefono))
  .replace('{{FOOTER_TEL}}', esc(contatti.telefono))
  .replace(/\{\{FOOTER_EMAIL\}\}/g, esc(contatti.email));

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

const impronteCaricate = new Map();
async function versioneCaricate(html) {
  const trovati = [...new Set(html.match(/img\/caricate\/[^"'\s,?)]+\.(?:webp|jpe?g|png|gif)(?![?\w])/g) || [])];
  for (const percorso of trovati) {
    if (!impronteCaricate.has(percorso)) {
      const dati = await readFile(join(ROOT, percorso)).catch(() => null);
      impronteCaricate.set(percorso, dati ? createHash('sha1').update(dati).digest('hex').slice(0, 8) : '');
    }
  }
  return html.replace(/img\/caricate\/[^"'\s,?)]+\.(?:webp|jpe?g|png|gif)(?![?\w])/g,
    (p) => (impronteCaricate.get(p) ? `${p}?v=${impronteCaricate.get(p)}` : p));
}

async function emit(meta, content) {
  const depth = meta.out.split('/').length - 1;
  const base = depth ? '../'.repeat(depth) : '';

  let html = layout
    .replace(/\{\{title\}\}/g, esc(meta.title))
    .replace(/\{\{description\}\}/g, esc(meta.description))
    .replace(/\{\{canonical\}\}/g, meta.canonical)
    .replace(/\{\{assetVersion\}\}/g, assetVersion)
    .replace(/\{\{ogImage\}\}/g, SITE + (meta.ogImage || OG_PREDEFINITA))
    .replace(/\{\{ogImageAlt\}\}/g, esc(meta.ogImageAlt || meta.title))
    .replace('{{robots}}', meta.noindex ? '<meta name="robots" content="noindex" />\n' : '')
    .replace('{{jsonld}}', () => jsonLd)
    .replace('{{header}}', markCurrent(header, meta.nav))
    .replace('{{content}}', content.replace('{{heroGrid}}', heroGrid).trim())
    .replace('{{footer}}', footer);

  // pagine in sottocartella: riscrive i percorsi relativi.
  // La 404 (meta.assoluti) Netlify la serve a qualunque indirizzo sbagliato,
  // anche /a/b/c.html: lì i percorsi relativi non tornano, servono quelli
  // dalla radice. In locale funzionano lo stesso se si serve la radice.
  if (base || meta.assoluti) {
    const prefisso = meta.assoluti ? '/' : base;
    const rialza = (url) => /^(https?:|mailto:|tel:|#|\.\.\/|\/|data:)/.test(url) ? url : prefisso + url;

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

  // Le foto caricate dal pannello prendono un «?v=» col contenuto del file.
  // Mentre si prepara un progetto in attesa il pannello le chiede al sito, che
  // non le ha ancora: alcuni browser si erano tenuti quella risposta «non
  // trovata» e la foto restava rotta anche dopo la pubblicazione (20/11/2026).
  // Con l'indirizzo nuovo il browser la richiede. Testi e nomi dei file non cambiano.
  html = await versioneCaricate(html);

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
    .replace('{{CERT_COUNT}}', String(azienda.certificazioni.length + (azienda.certificazioniPersonali || []).length))
    .replace('{{CERTIFICATI_SCHEDE}}', schedeCertificati)
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
    .replace('{{CERTIFICAZIONI}}', certLogos(azienda.certificazioni.filter((c) => c.file), misureMarchi))
    .replace('{{SEDE}}', sedeMedia(azienda.sede))
    .replace('{{MAPPA_SEDE}}', mappaSede())
    .replace('{{RACCONTO_FOTO_1}}', raccontoFoto(azienda.sede, 3, 'La sala riunioni di CF Consulting a Terni'))
    .replace('{{RACCONTO_FOTO_2}}', raccontoFoto(azienda.sede, 5, 'Gli uffici di CF Consulting a Terni'));

  await emit(meta, content);
}

/* --- 2. le 22 pagine sotto-servizio ------------------------- */

const tplServizio = await read(SRC, 'templates', 'servizio.html');
const DESC_MAX_SERVIZI = 160;
const relatedPool = projects.filter((p) => p.img).slice(0, 3);

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

/* Meta description dei servizi: il primo periodo dell'introduzione, se è
   una frase vera. In molte pagine il primo paragrafo è solo il nome del
   servizio ripetuto («Medicina del lavoro»): allora una frase neutra col
   nome, seguita dal primo periodo utile della pagina, entro 160 caratteri. */
const testoServizio = (area, item) => serviceText[`${area.id}/${slug(item)}`] || { intro: [], elenco: [] };
const tuttoMaiuscolo = (s) => !/\p{Ll}/u.test(s);
const candidateServizi = areas.flatMap((a) => a.items.map((it) => firstSentence(testoServizio(a, it).intro[0], DESC_MAX_SERVIZI)));
function descrizioneServizio(area, item) {
  const intro = testoServizio(area, item).intro;
  const d = firstSentence(intro[0], DESC_MAX_SERVIZI);
  const doppia = candidateServizi.filter((x) => x === d).length > 1;
  if (d && d.length >= 70 && !doppia && !tuttoMaiuscolo(d)) return d;
  const utile = intro.slice(1).find((x) => x.trim().length >= 60 && !tuttoMaiuscolo(x));
  return tagliaParola(`${item}: servizio di CF Consulting, studio di ingegneria a Terni.`
    + (utile ? ` ${firstSentence(utile, 400)}` : ''), DESC_MAX_SERVIZI);
}

for (const area of areas) {
  for (const item of area.items) {
    const testo = testoServizio(area, item);
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
      // oltre i 65 caratteri Google taglia: «, Terni» è il primo a cadere
      title: `${item} — CF Consulting, Terni`.length > 65 ? `${item} — CF Consulting` : `${item} — CF Consulting, Terni`,
      description: descrizioneServizio(area, item),
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

/** Un valore da mostrare: non vuoto e non il trattino dei campi assenti. */
const pieno = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '—';

/** La griglia in alto: solo le celle con un valore. Senza luogo scritto la
 *  cella non c'è (meglio niente che un luogo dedotto), e così per data e
 *  importo: niente righe con il solo «—». */
function projectMeta(p) {
  const celle = [
    ['Committente', p.committente],
    ['Luogo', p.luogo],
    [p.cellaDataK, p.cellaDataV],
    ['Importo dei lavori', p.importo],
  ].filter(([, v]) => pieno(v));
  if (!celle.length) return '';
  // con una sola cella la griglia non si allarga a tutta la riga
  return `    <div class="project-meta${celle.length === 1 ? ' project-meta--sola' : ''} hero-in hero-in--late">
${celle.map(([k, v]) => `      <div class="project-meta__cell">
        <div class="project-meta__k">${esc(k)}</div>
        <div class="project-meta__v">${esc(v)}</div>
      </div>`).join('\n')}
    </div>
`;
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

/* Meta description dei progetti. Il primo periodo del testo del cliente va
   bene quando è una frase vera; non quando è un codice di gara («CIG …»,
   «CUP … – CIG …»), quando è troppo corto o quando è uguale su più pagine.
   Allora si usa un testo neutro col titolo del progetto, scritto
   esattamente come l'ha scritto il cliente: i testi del cliente qui non si
   correggono, né le maiuscole né altro. */
const DESC_MIN = 70;
const DESC_MAX = 160;
const soloCodici = (s) => {
  if (/\b(CIG|CUP|commessa|codice fiscale|partita iva|p\.\s?iva)\b/i.test(s)) return true;
  const lettere = (s.match(/\p{L}/gu) || []).length;
  const cifre = (s.match(/\d/g) || []).length;
  return cifre > lettere;
};
const descrizioneDiRipiego = (p) => tagliaParola(
  `${p.shortTitle} – progetto di CF Consulting, studio di ingegneria, architettura ed energia a Terni.`, DESC_MAX);
const candidataProgetto = new Map(projects.map((p) => [p.slug, firstSentence(p.lead, DESC_MAX)]));
const quanteVolte = new Map();
for (const d of candidataProgetto.values()) quanteVolte.set(d, (quanteVolte.get(d) || 0) + 1);
function descrizioneProgetto(p) {
  const d = candidataProgetto.get(p.slug);
  if (!d || d.length < DESC_MIN || soloCodici(d) || quanteVolte.get(d) > 1) return descrizioneDiRipiego(p);
  return d;
}

for (const p of projects) {
  const others =projects.filter((o) => o.slug !== p.slug && o.img).slice(0, 3);

  const figure = p.img
    ? `<img src="${p.img}" ${srcset(p.img)} sizes="(max-width: 1240px) 100vw, 1184px"
             data-zoom="progetto" alt="${esc(p.shortTitle)} — foto 1" width="1600" height="800" />`
    : '<div class="gallery__empty"><span>Immagine di progetto<br />da caricare</span></div>';

  let content = tplProgetto
    .replace('{{FIGURE}}', figure)
    .replace('{{BLOCCHI}}', projectBlocks(p))
    .replace('{{SCHEDA}}', sheetRows(p))
    .replace('{{GALLERIA}}', gallery(p))
    .replace('{{OTHERS}}', projectCards(others))
    .replace('{{LEAD}}', pieno(p.lead) ? `      <p class="page-hero__lead">${esc(p.lead)}</p>\n` : '')
    .replace('{{PROJECT_META}}', projectMeta(p))
    .replace(/\{\{shortTitle\}\}/g, esc(p.shortTitle || '—'));

  await emit({
    out: projectHref(p),
    nav: 'progetti',
    title: `${p.shortTitle} — CF Consulting`,
    description: descrizioneProgetto(p),
    canonical: SITE + projectHref(p),
    ogImage: ogImmagine(p),
    ogImageAlt: condivisione.has(p.slug) ? `${p.shortTitle} — foto del progetto` : undefined
  }, content);
}

/* --- 4. sitemap e robots ------------------------------------ */

const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + written.filter((u) => u !== '404.html')   // la pagina d'errore non va indicizzata
    .map((u) => `  <url><loc>${SITE}${u === 'index.html' ? '' : u}</loc></url>`).join('\n')
  + '\n</urlset>\n';
await writeFile(join(ROOT, 'sitemap.xml'), sitemap, 'utf8');

/* --- feed dei progetti -------------------------------------- */
// L'immagine allegata è il JPEG di condivisione del progetto (vedi sopra),
// o la predefinita se non s'è potuto crearlo: Zapier la passa a LinkedIn e
// Facebook, che il WebP non lo prendono sempre. RSS vuole il peso in byte.
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
  const predefinita = { file: OG_PREDEFINITA, byte: (await stat(join(ROOT, OG_PREDEFINITA))).size };

  // Il guid NON contiene l'indirizzo: e' con lui che Zapier riconosce i
  // progetti gia' visti. Se dipendesse dal dominio, il giorno del lancio
  // tutti i progetti sembrerebbero nuovi e verrebbero ripubblicati sui
  // social in blocco. Lo slug invece non cambia mai.
  const voci = projects.slice(0, 30).map((p) => {
    const url = base + projectHref(p);
    const foto = p.img ? condivisione.get(p.slug) || predefinita : null;
    return `    <item>
      <title>${esc(p.shortTitle)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="false">cf-consulting-progetto-${esc(p.slug)}</guid>
      <description>${esc(p.lead || p.title)}</description>
      <category>${esc(p.cat)}</category>${foto ? `
      <enclosure url="${esc(base + foto.file)}" type="image/jpeg" length="${foto.byte}" />` : ''}
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
  // quelle dei progetti non pubblicati portano all'archivio
  for (const p of tuttiProgetti) {
    const fonte = provenienza[p.slug]?.fonte;
    const m = fonte && fonte.match(/\/portfolio-lavori\/([^/]+)\//);
    const meta = haContenuto(p) ? `/${projectHref(p)}` : '/progetti.html';
    if (m) schede.push([`/portfolio-lavori/${m[1]}/`, meta]);
  }
  schede.sort((a, b) => a[0].localeCompare(b[0]));

  righe.push('# Reindirizzamenti dal vecchio sito WordPress al nuovo.');
  righe.push('# Generato da build.mjs: non modificare a mano, si riscrive a ogni build.');
  righe.push('# Le voci da cambiare stanno in src/data/redirect.json.');
  righe.push('');
  // Netlify pubblica tutta la cartella: i file di lavoro (dati grezzi, progetti
  // in attesa, script, note) li nascondiamo. Il «!» serve perché i file esistono.
  // L'indirizzo provvisorio di Netlify porta al dominio vero: niente doppioni
  // per Google, e i vecchi link (pannello, feed di Zapier) continuano a funzionare.
  righe.push('# Indirizzo provvisorio → dominio');
  // destinazione scritta per esteso: SITE su Netlify viene da URL e non deve mai
  // poter tornare all'indirizzo provvisorio (sarebbe un giro infinito)
  righe.push(`${'https://cf-consulting.netlify.app/*'.padEnd(larghezza)} https://www.cieffeconsulting.eu/:splat  301!`);
  righe.push('');
  righe.push('# File di lavoro: non si aprono dal sito');
  for (const da of ['/src/*', '/strumenti/*', '/mockup/*', '/node_modules/*', '/build.mjs',
    '/package.json', '/package-lock.json', '/anteprima.py', '/HANDOFF.md'])
    righe.push(`${da.padEnd(larghezza)} /404.html  404!`);
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
  if (/for\s*=\s*"\/\*"\s*\[headers\.values\][^\[]*X-Robots-Tag\s*=\s*"noindex/.test(toml)) {   // solo il blocco su tutto il sito, non quello di /admin/
    console.log('\nNOTA: il sito è escluso dai motori di ricerca (X-Robots-Tag in');
    console.log('netlify.toml). Giusto adesso, da togliere il giorno del lancio.');
  }
} catch { /* in locale netlify.toml puo' non esserci */ }

if (conservazioneMancante) {
  console.log('\nATTENZIONE: nella privacy policy manca il periodo di conservazione dei');
  console.log('messaggi del modulo contatti. Da chiedere al cliente e scrivere in');
  console.log('src/data/azienda.json -> privacy.conservazioneForm (es. "24 mesi").');
}
