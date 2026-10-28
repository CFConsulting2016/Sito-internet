// Controllo settimanale delle scadenze delle certificazioni.
//
// Il sito toglie da solo una certificazione scaduta, ma solo quando si
// ricostruisce: se per mesi nessuno pubblica nulla, resterebbe online.
// Questo controllo gira su GitHub ogni lunedì e, da 60 giorni prima della
// scadenza, apre una segnalazione (Issue) che arriva per email.
//
//   node strumenti/scadenze-certificati.mjs            solo stampa
//   node strumenti/scadenze-certificati.mjs --github   apre le segnalazioni

import { readFile } from 'node:fs/promises';

const AVVISARE = '@FrancescoF23';
const GIORNI_PRIMA = 60;

const azienda = JSON.parse(await readFile(new URL('../src/data/azienda.json', import.meta.url), 'utf8'));
const oggi = new Date().toISOString().slice(0, 10);
const limite = new Date(Date.now() + GIORNI_PRIMA * 864e5).toISOString().slice(0, 10);

const voci = [...(azienda.certificazioni || []), ...(azienda.certificazioniPersonali || [])]
  .filter((c) => c.scadenza && c.scadenza < limite)
  .map((c) => ({
    nome: `${c.nome || c.titolo}${c.persona ? ` (${c.persona})` : ''}, n. ${c.numero}`,
    scadenza: c.scadenza,
    scaduta: c.scadenza < oggi,
  }));

if (!voci.length) {
  console.log(`Nessuna certificazione in scadenza nei prossimi ${GIORNI_PRIMA} giorni.`);
  process.exit(0);
}
for (const v of voci) console.log(`${v.scaduta ? 'SCADUTA' : 'in scadenza'} il ${v.scadenza}: ${v.nome}`);
if (!process.argv.includes('--github')) process.exit(0);

const api = (percorso, opzioni = {}) => fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${percorso}`, {
  ...opzioni,
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cf-consulting-scadenze',
    'Content-Type': 'application/json',
  },
});

// una segnalazione per certificazione: se è ancora aperta non se ne apre un'altra
const aperte = await (await api('/issues?state=open&per_page=100')).json();
const titoli = new Set((Array.isArray(aperte) ? aperte : []).map((i) => i.title));

for (const v of voci) {
  const titolo = `Certificazione ${v.scaduta ? 'scaduta' : 'in scadenza'}: ${v.nome}`;
  if (titoli.has(titolo)) continue;
  const corpo = v.scaduta
    ? `${AVVISARE} la certificazione è scaduta il ${v.scadenza}. Alla prossima pubblicazione il sito la toglie da solo; `
      + 'per rimetterla serve il certificato rinnovato: nuovo PDF in `documenti/` e nuova scadenza in `src/data/azienda.json`.'
    : `${AVVISARE} la certificazione scade il ${v.scadenza}. Appena arriva il rinnovo: nuovo PDF in \`documenti/\` `
      + 'e nuova scadenza in `src/data/azienda.json`. Se non viene rinnovata, il sito la toglie da solo dopo la scadenza.';
  const r = await api('/issues', { method: 'POST', body: JSON.stringify({ title: titolo, body: corpo }) });
  console.log(r.ok ? `Segnalazione aperta: ${titolo}` : `Segnalazione non aperta (${r.status}).`);
}
