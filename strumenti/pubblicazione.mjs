/**
 * Quando un salvataggio sul ramo principale deve ricostruire il sito.
 *
 * Ogni ricostruzione costa 15 crediti Netlify (300 al mese nel piano
 * gratuito). Le news approvate non vanno direttamente sul sito: finiscono
 * in src/news-in-attesa, che il sito non legge, e da lì le sposta in
 * src/news il giro del lunedì (strumenti/sposta-news.mjs), con una sola
 * ricostruzione per tutte. Tutto il resto (progetti, pagine, dati) esce
 * subito, come prima.
 */

/** File che non cambiano il sito: salvarli non deve costare crediti. */
const NON_TOCCANO_IL_SITO = [
  '.github/',
  'strumenti/',
  'src/news-in-attesa/',            // l'area di attesa, il sito non la legge
  'src/data/pubblica-news-ora.json', // la richiesta: costruisce lo spostamento
];

/** Le immagini caricate dal pannello, da sole, non cambiano il sito: lo
 *  cambiano quando le usa un progetto o una news, e allora arrivano insieme. */
const SOLO_IMMAGINI = 'img/caricate/';

const inizia = (file, prefissi) => prefissi.some((p) => file.startsWith(p));

/** @param {string[]} file  percorsi cambiati nel salvataggio
 *  @returns {boolean} true se il sito va ricostruito */
export function cambiaIlSito(file) {
  return file
    .filter((f) => !inizia(f, NON_TOCCANO_IL_SITO))
    .some((f) => !f.startsWith(SOLO_IMMAGINI));
}
