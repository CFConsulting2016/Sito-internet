/**
 * Comando «ignore» di Netlify: decide se un salvataggio ricostruisce il sito.
 * Uscita 0 = Netlify salta la costruzione, uscita 1 = costruisce.
 *
 * Nel dubbio si costruisce sempre: un errore qui non deve mai lasciare il
 * sito vecchio. Le regole stanno in pubblicazione.mjs.
 */
import { execFileSync } from 'node:child_process';
import { cambiaIlSito } from './pubblicazione.mjs';

const costruisci = (motivo) => { console.log(`Si costruisce: ${motivo}`); process.exit(1); };
const salta = (motivo) => { console.log(`Costruzione saltata: ${motivo}`); process.exit(0); };

try {
  // avvio dal pulsante di Netlify (lo spostamento delle news): sempre
  if (process.env.INCOMING_HOOK_TITLE) costruisci(`avvio «${process.env.INCOMING_HOOK_TITLE}»`);

  const prima = process.env.CACHED_COMMIT_REF;
  const ora = process.env.COMMIT_REF;
  if (!prima || !ora || prima === ora) costruisci('nessun confronto possibile con la versione precedente');

  const file = execFileSync('git', ['diff', '--name-only', prima, ora], { encoding: 'utf8' })
    .split('\n').map((f) => f.trim()).filter(Boolean);

  if (cambiaIlSito(file)) costruisci('modifiche al sito');
  salta('nessun file del sito cambiato (news in attesa, automazioni o immagini non ancora usate)');
} catch (e) {
  costruisci(`controllo non riuscito (${e.message})`);
}
