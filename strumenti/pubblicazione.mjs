/**
 * Quando un salvataggio sul ramo principale deve ricostruire il sito.
 *
 * Ogni ricostruzione costa 15 crediti Netlify (300 al mese nel piano
 * gratuito). I progetti nuovi non vanno direttamente sul sito: si preparano
 * in src/progetti-in-attesa, che il sito non legge, e li sposta tutti
 * insieme in src/progetti strumenti/sposta-progetti.mjs, con una sola
 * ricostruzione. Tutto il resto (correzioni ai progetti, news, dati) esce
 * subito.
 */

/** File che non cambiano il sito: salvarli non deve costare crediti. */
const NON_TOCCANO_IL_SITO = [
  '.github/',
  'strumenti/',
  'src/progetti-in-attesa/',            // l'area di attesa, il sito non la legge
  'src/data/pubblica-progetti-ora.json', // la richiesta: costruisce lo spostamento
];

/** Le immagini caricate dal pannello, da sole, non cambiano il sito: lo
 *  cambiano quando le usa un progetto o una news, e allora arrivano insieme.
 *  Lo stesso per i PDF: un certificato caricato arriva insieme alla sua scheda. */
const SOLO_ALLEGATI = ['img/caricate/', 'documenti/'];

const inizia = (file, prefissi) => prefissi.some((p) => file.startsWith(p));

/** @param {string[]} file  percorsi cambiati nel salvataggio
 *  @returns {boolean} true se il sito va ricostruito */
export function cambiaIlSito(file) {
  return file
    .filter((f) => !inizia(f, NON_TOCCANO_IL_SITO))
    .some((f) => !inizia(f, SOLO_ALLEGATI));
}
