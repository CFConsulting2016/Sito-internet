# CF Consulting — Handoff per Claude Code

Documento di consegna del restyling. Contiene lo stato del design, le convenzioni da rispettare e l'elenco di quello che resta da fare in fase di sviluppo.

---

## 1. Cosa c'è in questo progetto

Sette pagine, ognuna un file autonomo:

| File | Pagina |
|---|---|
| `CF Consulting - Home.dc.html` | Homepage |
| `CF Consulting - Chi siamo.dc.html` | Chi siamo / team |
| `CF Consulting - Servizi.dc.html` | Indice delle 7 aree di servizio |
| `CF Consulting - Servizio.dc.html` | **Template** pagina sotto-servizio (una sola compilata) |
| `CF Consulting - Progetti.dc.html` | Archivio progetti con filtri |
| `CF Consulting - Progetto.dc.html` | **Template** pagina progetto (una sola compilata) |
| `CF Consulting - Contatti.dc.html` | Contatti, form, mappa |

Immagini in `img/`. `img/favicon.png` è generata dal simbolo del logo.

I file sono mockup di design: la struttura, la tipografia, i colori, gli spazi e le animazioni sono decisi e vanno riprodotti fedelmente. Il codice invece va riscritto come HTML/CSS statico (vedi §5).

---

## 2. Sistema visivo

**Colori**

| Uso | Valore |
|---|---|
| Navy (hero, footer, drawer) | `#0F1A2B` |
| Navy footer | `#1A2229` |
| Rosso accent (CTA, filetti, hover) | `#8C1D2C` |
| Rosso hover CTA | `#A81F2D` |
| Rosso chiaro (su fondo navy) | `#C0505F` / `#D9737F` |
| Testo principale | `#1B2430` |
| Titoli | `#0F1A2B` |
| Testo secondario | `#46505C` |
| Etichette piccole | `#58616D` |
| Etichette barra in cima | `#5A6470` |
| Bordi | `#E2E5E8` / `#D5DADF` |
| Fondo alternato | `#F4F5F6` / `#FAFBFB` |

I grigi sono già stati alzati per rispettare 4,5:1. **Non schiarirli.**

**Tipografia** — un solo font: **Archivo** (400/500/600), da Google Fonts. Il monospace è stato rimosso dappertutto, non reintrodurlo. Titoli in `clamp()`, `letter-spacing` negativo (da `-.01em` a `-.025em`), `text-wrap: pretty` sui testi lunghi.

**Layout** — contenitore `max-width: 1240px`, padding orizzontale 28px. Griglie sempre con `repeat(auto-fit, minmax(…, 1fr))` e `gap`, mai larghezze fisse. Angoli vivi: **nessun border-radius** in tutto il sito.

**Animazioni** — tre linguaggi, coerenti su tutte le pagine:
1. *Fade-up allo scroll* — elementi con `data-rv`, `opacity 0 → 1` + `translateY(18px) → 0`, transizione 0,7s `cubic-bezier(.22,.61,.36,1)`, con stagger di ~70ms tra elementi vicini.
2. *Titoli mascherati* — `data-title`, `clip-path: inset(0 0 108% 0)` che si apre verso il basso.
3. *Linee tracciate* — `data-line`, `transform: scaleX(0) → 1` con origine a sinistra.

Tutto va dentro `@media (prefers-reduced-motion: reduce)` con le animazioni annullate (già presente nei mockup).

La griglia tecnica animata della hero della homepage è un SVG con `stroke-dasharray`/`stroke-dashoffset`: i disegni si tracciano e svaniscono in loop. Sulle altre pagine la stessa griglia è **statica** (nessuna animazione). Copiala così com'è.

---

## 3. Struttura della navigazione

**Desktop (>980px)** — barra contatti in cima, poi header bianco con logo a sinistra e menù a destra: Home · Chi siamo · Servizi ▾ · Progetti · Contatti. "Servizi" apre un pannello a due colonne: a sinistra le 7 aree, a destra i sotto-servizi dell'area attiva. L'area cambia al passaggio del mouse. **Il pannello non blocca lo scroll della pagina** e si chiude con Esc o con un clic fuori.

**Mobile (≤980px)** — hamburger che apre un drawer navy da destra, con le 7 aree come fisarmonica. Chiusura con ×, Esc, backdrop o selezione di una voce. Lo scroll del body è bloccato mentre è aperto. Sotto 620px l'indirizzo nella barra in cima viene nascosto.

L'altezza dei pannelli è misurata in JS nei mockup — in produzione si può fare con `max-height` e una transizione, senza misurazioni.

---

## 4. Le 7 aree di servizio

Prese dal sito attuale. Gli `id` sono gli ancoraggi usati nei link.

1. `ingegneria` — Servizi di ingegneria e progettazione
2. `energia` — Efficientamento energetico
3. `bonus` — Ecobonus & Sismabonus
4. `edilizia` — Pratiche edilizie
5. `sicurezza` — Sicurezza nei luoghi di lavoro
6. `eventi` — Eventi e manifestazioni
7. `qualita` — Organizzazione aziendale e qualità

Ogni area contiene da 2 a 6 sotto-servizi, per un totale di 22 pagine da generare dal template `Servizio`.

---

## 5. Conversione da mockup a sito statico

I file sono componenti con logica in JavaScript. Da fare in produzione:

- **Estrarre header, drawer e footer** in un unico partial condiviso. Ora sono duplicati identici in sette file: qualsiasi modifica va fatta sette volte.
- **Riscrivere le animazioni con `IntersectionObserver`.** I mockup usano un timer ogni 400ms che legge il layout: funziona per la demo, è sbagliato in produzione. Un solo observer con `threshold: 0.15` e `unobserve` dopo il primo trigger.
- **Convertire gli stili inline in CSS** con custom properties per i colori della tabella al §2. Negli originali sono inline per ragioni dell'ambiente di design, non per scelta.
- **Rimuovere gli attributi di lavoro** — `data-om-id`, `data-dc-tpl`, `data-comment-anchor`, `data-props`, `data-screen-label`.
- **Eliminare i file `Varianti`** se ancora presenti: erano esplorazioni, non pagine.
- I metadati nei mockup sono iniettati da JavaScript. In produzione vanno scritti direttamente nel `<head>` di ogni pagina — titolo, description, Open Graph, `lang="it"`, favicon. I testi sono già pronti dentro ogni file, nella chiamata `applyMeta(...)`.

---

## 6. Contenuti da migrare dal sito attuale

Fonte: <https://www.cieffeconsulting.eu>

- **Progetti** — il portfolio completo. Nei mockup ci sono 12 voci di esempio; il contatore dice 79 e va allineato al numero reale. Per ogni progetto: titolo, committente, luogo, anno, importo, categoria, immagini, e i cinque blocchi testuali (Descrizione progetto, Committente, Impresa appaltatrice, Progettisti, Servizi svolti).
- **Sotto-servizi** — i testi delle 22 pagine esistono già sul sito attuale, uno per pagina.
- **Team** — nomi, ruoli, qualifiche, foto. Nei mockup ci sono quattro schede vuote.
- **Numeri** — "Anni di attività" ed "Enti pubblici serviti" sono a `—` in attesa dei valori reali.
- **Certificazioni** — i loghi sono segnaposto.
- **Committenti pubblici citati nel brief**: Comune di Terni, Provincia di Terni, ATER Umbria, Guardia di Finanza.

---

## 7. Da realizzare ex novo

- **Form contatti funzionante** — campi obbligatori, validazione, endpoint, stato di successo/errore, protezione anti-spam. Nei mockup è solo l'aspetto grafico.
- **Cookie banner su tutte le pagine.** Ora è solo su Contatti. Deve regolare sia la mappa Google sia il form. Il consenso è salvato in `localStorage` con chiave `cf-cookie-consent` (`all` | `necessary`); la mappa si carica solo con `all`, altrimenti mostra un riquadro con pulsante "Carica la mappa".
- **Privacy Policy e Cookie Policy.** Tutti i link puntano a `#`. Con un form attivo sono obbligatorie.
- **Immagini** — conversione in WebP, `srcset` per le dimensioni reali, `width`/`height` su ogni `<img>` per evitare i salti di layout, `loading="lazy"` sotto la piega. Oggi sono 2,8 MB per sei foto, la più pesante 924 KB a 1920×2560: è il singolo intervento con più impatto sulla velocità.
- **Logo del footer** — `logo-cf-footer.png` ha il fondo scuro incorporato (`#161F2B`) mentre il footer è `#1A2229`. Serve una versione con sfondo trasparente, meglio in SVG.
- **Pagina 404**, `sitemap.xml`, `robots.txt`.
- **Verificare il numero di telefono**: mostrato come `0744 196 3005`, collegato a `tel:+3907441963005`.

---

## 8. Scelte già decise — da non rimettere in discussione

- Niente sezione News per ora. Verrà aggiunta più avanti.
- Niente sezioni Servizi e Chi siamo in homepage: sono pagine a sé.
- Niente sezione Committenti né Aggiornamenti.
- Niente breadcrumb.
- Niente etichette-occhiello sopra le sezioni (del tipo "Progetti", "Il team", "Dove siamo"): rimosse su richiesta.
- Niente committente/luogo sulle card progetto in homepage: solo il titolo.
- Mappa **Google Maps**, non OpenStreetMap.
- Menù dell'header su fondo bianco, perché il logo è scuro.
- Un solo font, Archivo. Nessun monospace.
- Nessun border-radius.
