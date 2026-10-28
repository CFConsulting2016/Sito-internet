/**
 * Quando un salvataggio sul ramo principale deve ricostruire il sito.
 *
 * Ogni ricostruzione costa 15 crediti Netlify (300 al mese nel piano
 * gratuito). Le news, che il pannello propone due volte a settimana, si
 * accumulano e vanno online insieme il lunedì mattina; tutto il resto
 * (progetti, pagine, dati) esce subito, come prima.
 *
 * Le regole stanno qui una volta sola: le usano sia Netlify per decidere
 * se costruire (salta-build.mjs) sia il controllo del lunedì per capire se
 * ci sono news in attesa (news-settimanali.mjs).
 */

/** File che non toccano il sito: automazioni e strumenti di lavoro. */
const FUORI_DAL_SITO = ['.github/', 'strumenti/'];

/** File che possono aspettare il lunedì: le notizie e le immagini caricate
 *  dal pannello, che con il flusso di approvazione viaggiano insieme alla
 *  notizia. Se arrivano insieme a un progetto, il progetto fa costruire. */
const RIMANDABILI = ['src/news/', 'img/caricate/'];

const inizia = (file, elenco) => elenco.some((p) => file.startsWith(p));

/**
 * @param {string[]} file   percorsi cambiati nel salvataggio
 * @param {(percorso: string) => string|null} leggi   contenuto del file
 *        nella versione salvata, null se il file è stato cancellato
 * @returns {'subito'|'lunedi'|'niente'}
 */
export function quandoPubblicare(file, leggi) {
  const sito = file.filter((f) => !inizia(f, FUORI_DAL_SITO));
  if (!sito.length) return 'niente';
  if (sito.some((f) => !inizia(f, RIMANDABILI))) return 'subito';

  // solo news: escono subito quelle con «Pubblicazione immediata» accesa
  for (const f of sito) {
    if (!f.startsWith('src/news/') || !f.endsWith('.json')) continue;
    const testo = leggi(f);
    if (!testo) continue;
    try {
      if (JSON.parse(testo).pubblicaSubito === true) return 'subito';
    } catch {
      return 'subito'; // un file illeggibile meglio vederlo fallire subito
    }
  }
  return 'lunedi';
}
