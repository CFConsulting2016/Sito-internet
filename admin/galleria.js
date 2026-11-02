/**
 * CF Consulting — widget «galleria» per Decap CMS 3.16.3.
 *
 * Perché esiste: la libreria immagini di Decap carica un file per volta,
 * e un progetto può avere 60 foto. Qui si scelgono (o si trascinano) tutte
 * insieme, il browser le rimpicciolisce e le converte in WebP, e il campo
 * salva lo stesso formato del vecchio `list` di `image`: un array di
 * percorsi, la prima è la copertina. build.mjs e i progetti esistenti non
 * si accorgono di nulla.
 *
 * COME FINISCONO NEL REPOSITORY (il punto delicato)
 * Usiamo la prop `onPersistMedia(file, { field })` che Decap passa a ogni
 * widget di controllo: è la stessa azione (`persistMedia`) che usa la sua
 * libreria immagini quando si carica una foto dentro un'immagine o un file.
 * In Decap 3.16.3, se c'è una voce aperta nell'editor (`selectEditingDraft`
 * = voce non vuota), `persistMedia` NON scrive subito nel repository:
 *   1. crea un AssetProxy e lo registra (`addAsset`), così `getAsset` lo trova;
 *   2. aggiunge il file a `entry.mediaFiles` con `draft: true`
 *      (`ADD_DRAFT_ENTRY_MEDIA_FILE`) e segna la voce come modificata;
 *   3. alla pressione di «Pubblica», `persistEntry` raccoglie i mediaFiles
 *      in bozza (`getMediaAssets`) e il backend li scrive nello STESSO
 *      salvataggio del JSON (con git-gateway: un solo commit).
 * Se si chiude la voce senza pubblicare, le foto non vengono caricate.
 * Non serve toccare lo store di Decap né API interne: solo props pubbliche.
 *
 * Per ogni foto oltre i 640 px carichiamo anche «nome-sm.webp» (640 px), che
 * build.mjs usa per schede e srcset; nel valore del campo va solo la grande.
 * Le foto doppie (stesso contenuto dopo la conversione) vengono scartate:
 * Decap ne terrebbe un solo file in bozza e un percorso resterebbe vuoto.
 *
 * Limite noto: Decap non dà ai widget un modo per togliere un file dai
 * mediaFiles in bozza. Una foto aggiunta e poi tolta PRIMA di pubblicare
 * sparisce dal progetto, ma il file (e la sua -sm) viene comunque caricato
 * in img/caricate (resta orfano, il sito non lo usa).
 *
 * Niente librerie esterne: Decap espone `window.h` (React.createElement) e
 * `window.createClass` (create-react-class).
 */
(function () {
  'use strict';

  var LATO_MAX = 1600;        // lato lungo massimo in pixel
  var LATO_PICCOLO = 640;     // variante -sm per schede e srcset (vedi build.mjs)
  var QUALITA_WEBP = 0.8;
  var QUALITA_JPEG = 0.82;    // ripiego per i browser che non scrivono WebP
  var h = window.h;
  var createClass = window.createClass;
  var CMS = window.CMS;

  if (!CMS || !h || !createClass) {
    console.error('galleria.js: Decap CMS non è caricato, il widget non è registrato.');
    return;
  }

  /* ---------- utilità ---------- */

  // Il valore arriva da Decap come Immutable.List (voce caricata), array o niente.
  function comeArray(valore) {
    if (!valore) return [];
    if (typeof valore.toJS === 'function') valore = valore.toJS();
    if (!Array.isArray(valore)) valore = [valore];
    return valore.filter(function (p) { return typeof p === 'string' && p; });
  }

  // Restituiamo a Decap una Immutable.List, come faceva il widget `list`:
  // Immutable non è esposto, ma ne ricaviamo una vuota dal valore attuale
  // o dalla configurazione del campo (una Map: toList() dà una List).
  function comeLista(arr, valorePrecedente, field) {
    var vuota = null;
    if (valorePrecedente && typeof valorePrecedente.clear === 'function' && typeof valorePrecedente.push === 'function') {
      vuota = valorePrecedente.clear();
    } else if (field && typeof field.toList === 'function') {
      vuota = field.toList().clear();
    }
    return vuota ? vuota.push.apply(vuota, arr) : arr.slice();
  }

  // Nome file sicuro: minuscole, senza accenti, solo lettere/cifre/trattini.
  function slugSicuro(testo) {
    return String(testo || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
  }

  function due(n) { return n < 10 ? '0' + n : String(n); }

  function unisciPercorso(cartella, nome) {
    // Come fa Decap con public_folder: la barra iniziale, se c'è, resta.
    return String(cartella || '').replace(/\/+$/, '') + '/' + nome;
  }

  function leggiImmagine(file) {
    // createImageBitmap rispetta l'orientamento EXIF delle foto da telefono.
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(file); })
        .catch(function () { return leggiConImg(file); });
    }
    return leggiConImg(file);
  }

  function leggiConImg(file) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('illeggibile')); };
      img.src = url;
    });
  }

  function aBlob(canvas, tipo, qualita) {
    return new Promise(function (ok) { canvas.toBlob(ok, tipo, qualita); });
  }

  function disegna(sorgente, w, hh, lato) {
    var scala = Math.min(1, lato / Math.max(w, hh));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scala));
    canvas.height = Math.max(1, Math.round(hh * scala));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sorgente, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Safari su iOS tiene la memoria dei canvas finché non li si azzera: con
  // 60 foto da 1600 px si arriva al limite e la pagina si ricarica.
  function svuota(canvas) { canvas.width = 0; canvas.height = 0; }

  /** Rimpicciolisce al lato lungo LATO_MAX e converte in WebP (o JPEG).
   *  Prepara anche la variante -sm da LATO_PICCOLO per le schede del sito. */
  function alleggerisci(file) {
    return leggiImmagine(file).then(function (img) {
      var w = img.width, hh = img.height;
      var grande = disegna(img, w, hh, LATO_MAX);
      if (typeof img.close === 'function') img.close();
      var ridotta = grande.width !== w || grande.height !== hh;
      return aBlob(grande, 'image/webp', QUALITA_WEBP).then(function (blob) {
        // Safari vecchi ignorano image/webp e restituiscono un PNG: lo scartiamo.
        if (blob && blob.type === 'image/webp') return { blob: blob, est: 'webp' };
        return aBlob(grande, 'image/jpeg', QUALITA_JPEG).then(function (j) {
          if (!j) throw new Error('conversione non riuscita');
          return { blob: j, est: 'jpg' };
        });
      }).then(function (esito) {
        // Una foto già piccola e già WebP non va ricompressa per niente.
        if (!ridotta && file.type === 'image/webp' && file.size <= esito.blob.size) {
          esito = { blob: file, est: 'webp' };
        }
        // build.mjs cerca accanto a ogni foto «nome-sm.webp» (small() e
        // censisci()): solo WebP, e solo se la foto supera i 640 px, perché
        // altrimenti il sito usa già la grande.
        if (esito.est !== 'webp' || Math.max(grande.width, grande.height) <= LATO_PICCOLO) {
          svuota(grande);
          return esito;
        }
        var piccola = disegna(grande, grande.width, grande.height, LATO_PICCOLO);
        svuota(grande);
        return aBlob(piccola, 'image/webp', QUALITA_WEBP).then(function (b) {
          svuota(piccola);
          if (b && b.type === 'image/webp') esito.piccola = b;
          return esito;
        });
      }, function (err) { svuota(grande); throw err; });
    });
  }

  // Impronta del contenuto: Decap tiene un solo file in bozza per contenuto
  // identico, quindi una foto scelta due volte lascerebbe un percorso senza file.
  function impronta(blob) {
    if (!window.crypto || !crypto.subtle || typeof blob.arrayBuffer !== 'function') {
      return Promise.resolve(null); // senza crypto.subtle (http non locale) non controlliamo
    }
    return blob.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest('SHA-256', buf);
    }).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (x) {
        return (x < 16 ? '0' : '') + x.toString(16);
      }).join('');
    });
  }

  function kb(byte) {
    return byte >= 1048576 ? (byte / 1048576).toFixed(1).replace('.', ',') + ' MB'
      : Math.max(1, Math.round(byte / 1024)) + ' KB';
  }

  /* ---------- stile (una volta sola) ---------- */

  var CSS = [
    '.cfg-zona{border:2px dashed #b9c2cf;border-radius:8px;padding:18px;text-align:center;background:#f7f9fb;transition:background .15s,border-color .15s}',
    '.cfg-zona.cfg-sopra{background:#e8f1fd;border-color:#3a69c7}',
    '.cfg-zona p{margin:0 0 10px;color:#4a5462;font-size:14px}',
    '.cfg-bottone{display:inline-block;background:#3a69c7;color:#fff;border:0;border-radius:5px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}',
    '.cfg-bottone[disabled]{background:#9aa6b5;cursor:default}',
    '.cfg-stato{margin-top:10px;font-size:14px;color:#2b3440}',
    '.cfg-barra{height:6px;background:#dde3ea;border-radius:3px;overflow:hidden;margin-top:6px}',
    '.cfg-barra span{display:block;height:100%;background:#3a69c7;transition:width .2s}',
    '.cfg-errore{color:#b42318}',
    '.cfg-griglia{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:14px}',
    '.cfg-foto{position:relative;border:2px solid transparent;border-radius:6px;overflow:hidden;background:#e9edf2;aspect-ratio:4/3;cursor:grab}',
    '.cfg-foto img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}',
    '.cfg-foto.cfg-copertina{border-color:#3a69c7}',
    '.cfg-foto.cfg-presa{opacity:.4}',
    '.cfg-foto.cfg-bersaglio{outline:3px solid #f2a33a;outline-offset:-3px}',
    '.cfg-etichetta{position:absolute;left:0;top:0;background:#3a69c7;color:#fff;font-size:11px;font-weight:700;padding:3px 7px;border-bottom-right-radius:5px}',
    '.cfg-numero{position:absolute;left:5px;bottom:5px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 6px;border-radius:9px}',
    '.cfg-azioni{position:absolute;right:4px;top:4px;display:flex;gap:4px}',
    '.cfg-azioni button{border:0;border-radius:4px;background:rgba(255,255,255,.92);color:#2b3440;font-size:12px;line-height:1;padding:5px 7px;cursor:pointer}',
    '.cfg-azioni button:hover{background:#fff;color:#b42318}',
    '.cfg-nota{margin-top:8px;font-size:13px;color:#5d6876}'
  ].join('\n');

  function iniettaStile() {
    if (document.getElementById('cfg-stile')) return;
    var s = document.createElement('style');
    s.id = 'cfg-stile';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function occupatoOra(c) { return !!c.state.lavoro || !!c.props.isDisabled; }

  /* ---------- controllo ---------- */

  var GalleriaControl = createClass({
    getInitialState: function () {
      return { lavoro: null, messaggio: null, errore: false, sopra: false, presa: null, bersaglio: null };
    },

    componentDidMount: function () {
      iniettaStile();
      // Anteprime locali delle foto appena aggiunte, per percorso.
      this.anteprime = {};
    },

    componentWillUnmount: function () {
      var a = this.anteprime || {};
      Object.keys(a).forEach(function (k) { URL.revokeObjectURL(a[k]); });
      this.smontato = true;
      clearTimeout(this.timerAsset);
    },

    percorsi: function () { return comeArray(this.props.value); },

    // Decap 3.16.3 chiama isValid() del widget quando si preme Pubblica
    // (Widget.validateWrappedControl): un {error} blocca il salvataggio.
    // Durante la conversione le foto non sono ancora tutte nella bozza.
    isValid: function () {
      if (!this.state.lavoro) return true;
      this.bloccatoPubblica = true;
      // L'errore di Decap sotto il campo sparisce alla foto successiva (ogni
      // onChange lo azzera): lo ripetiamo noi, in rosso, fino alla fine.
      if (!this.state.pubblicaBloccata) this.setState({ pubblicaBloccata: true });
      return { error: { type: 'CUSTOM', message: 'Attendete che finisca il caricamento delle foto prima di pubblicare.' } };
    },

    salva: function (arr) {
      this.props.onChange(comeLista(arr, this.props.value, this.props.field));
    },

    cartellaPubblica: function () {
      // In Decap 3 `config` arriva come oggetto semplice, `field` come Immutable.Map.
      var f = this.props.field, c = this.props.config || {};
      var daCampo = f && f.get && f.get('public_folder');
      var daConfig = typeof c.get === 'function' ? c.get('public_folder') : c.public_folder;
      return daCampo || daConfig || 'img/caricate';
    },

    baseNome: function () {
      // getEntry() legge la bozza attuale: `entry` può essere vecchia, perché
      // Decap ridisegna il widget solo quando cambia il suo valore.
      var e = (typeof this.props.getEntry === 'function' && this.props.getEntry()) || this.props.entry;
      var titolo = e && e.getIn && (e.getIn(['data', 'shortTitle']) || e.getIn(['data', 'title']) || e.get('slug'));
      return slugSicuro(titolo) || 'progetto';
    },

    aggiungi: function (lista) {
      var self = this;
      if (this.state.lavoro) return;
      var file = Array.prototype.filter.call(lista || [], function (f) {
        return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?)$/i.test(f.name);
      });
      if (!file.length) {
        this.setState({ messaggio: 'Nessuna immagine tra i file scelti.', errore: true });
        return;
      }
      // Ordine naturale dei nomi: IMG_2 prima di IMG_10, come nella cartella.
      file.sort(function (a, b) { return a.name.localeCompare(b.name, 'it', { numeric: true }); });

      var base = this.baseNome();
      var timbro = Date.now().toString(36); // rende unici i nomi tra un caricamento e l'altro
      var iniziali = this.percorsi();
      var nuovi = [];
      var illeggibili = [], nonSalvate = [], doppie = 0;
      var pesoPrima = 0, pesoDopo = 0;
      var totali = file.length;
      if (!this.impronte) this.impronte = {}; // foto già aggiunte in questa sessione
      var field = this.props.field;
      var persisti = this.props.onPersistMedia;

      // persistMedia non lancia errori: in caso di problema mostra già il suo
      // avviso e restituisce MEDIA_PERSIST_FAILURE (o niente).
      function metti(blob, nome) {
        var pronto = new File([blob], nome, { type: blob.type });
        return Promise.resolve(persisti(pronto, { field: field })).then(function (azione) {
          if (!azione || /FAILURE/.test(azione.type || '')) {
            var e = new Error('salvataggio non riuscito'); e.salvataggio = true; throw e;
          }
          return pronto.size;
        });
      }

      this.setState({ lavoro: { fatte: 0, totali: totali }, messaggio: null, errore: false });

      var catena = Promise.resolve();
      file.forEach(function (f, i) {
        catena = catena.then(function () {
          // Se il cliente ha cambiato voce, le foto finirebbero nella bozza
          // di un'altra voce: ci si ferma.
          if (self.smontato) return;
          return alleggerisci(f).then(function (esito) {
            return impronta(esito.blob).then(function (sha) {
              if (self.smontato) return;
              // Doppia solo se la gemella è ancora nella galleria: una foto tolta
              // e poi riaggiunta va bene (Decap sposta il file sul nome nuovo).
              var gemella = sha && self.impronte[sha];
              if (gemella && self.percorsi().concat(nuovi).indexOf(gemella) !== -1) { doppie++; return; }
              var radice = base + '-' + timbro + '-' + due(i + 1);
              var nome = radice + '.' + esito.est;
              return metti(esito.blob, nome).then(function (peso) {
                var percorso = unisciPercorso(self.cartellaPubblica(), nome);
                if (sha) self.impronte[sha] = percorso;
                if (self.anteprime) self.anteprime[percorso] = URL.createObjectURL(esito.blob);
                nuovi.push(percorso);
                pesoPrima += f.size;
                pesoDopo += peso;
                // Il campo si aggiorna foto per foto: si vede crescere la galleria.
                // Nel valore va solo la grande; la -sm la trova build.mjs.
                if (!self.smontato) self.salva(iniziali.concat(nuovi));
                if (esito.piccola && !self.smontato) {
                  return metti(esito.piccola, radice + '-sm.webp').then(function (p2) {
                    pesoDopo += p2;
                  }, function (err) {
                    // Senza -sm il sito usa la grande: si vede, solo più lenta.
                    console.warn('galleria: variante piccola non salvata', nome, err);
                  });
                }
              });
            });
          }).catch(function (err) {
            console.warn('galleria: scartata', f.name, err);
            (err && err.salvataggio ? nonSalvate : illeggibili).push(f.name);
          }).then(function () {
            if (!self.smontato) self.setState({ lavoro: { fatte: i + 1, totali: totali } });
          });
        });
      });

      catena.then(function () {
        if (self.smontato) return;
        var parti = [];
        if (nuovi.length) {
          parti.push((nuovi.length === 1 ? 'Aggiunta 1 foto' : 'Aggiunte ' + nuovi.length + ' foto')
            + ' (' + kb(pesoPrima) + ' → ' + kb(pesoDopo) + '). Verranno caricate quando premete «Pubblica».');
        }
        if (doppie) {
          parti.push(doppie === 1 ? '1 foto era doppia e non è stata aggiunta.'
            : doppie + ' foto erano doppie e non sono state aggiunte.');
        }
        if (illeggibili.length) {
          parti.push('File non leggibili: ' + illeggibili.join(', ')
            + '. Se sono foto iPhone (HEIC), salvatele in JPG e riprovate.');
        }
        if (nonSalvate.length) {
          parti.push('Il pannello non è riuscito a preparare: ' + nonSalvate.join(', ')
            + '. Riprovate con queste foto.');
        }
        // Rosso se qualcosa non è andato, anche quando le altre sono entrate.
        var problemi = illeggibili.length + nonSalvate.length + doppie > 0;
        self.setState({ lavoro: null, pubblicaBloccata: false, messaggio: parti.join(' '), errore: problemi });
        // Se Pubblica era stato bloccato e non è cambiato nulla, l'errore di
        // Decap resterebbe: lo toglie solo un onChange.
        if (self.bloccatoPubblica && !nuovi.length) self.salva(self.percorsi());
        self.bloccatoPubblica = false;
      });
    },

    togli: function (indice) {
      var arr = this.percorsi();
      arr.splice(indice, 1);
      this.salva(arr);
    },

    sposta: function (da, a) {
      if (da === a || da == null || a == null) return;
      var arr = this.percorsi();
      var preso = arr.splice(da, 1)[0];
      arr.splice(a, 0, preso);
      this.salva(arr);
    },

    urlAnteprima: function (percorso) {
      if (this.anteprime && this.anteprime[percorso]) return this.anteprime[percorso];
      if (/^(https?:|data:|blob:)/.test(percorso)) return percorso;
      // Le foto già nel repository sono anche sul sito, che serve /admin/:
      // le prendiamo da lì, come le vede il visitatore. Con getAsset Decap le
      // scaricherebbe una per una dalle API di GitHub (lento, e con 60 foto
      // si consuma il limite di richieste).
      if (!this.ripieghi || !this.ripieghi[percorso]) return '/' + percorso.replace(/^\/+/, '');
      // Ripiego per le foto appena pubblicate e non ancora sul sito (Netlify
      // sta ancora costruendo): getAsset le legge dal repository. Mentre
      // scarica restituisce un segnaposto vuoto, e Decap non ridisegna il
      // widget quando ha finito: ricontrolliamo noi tra poco.
      try {
        var asset = this.props.getAsset && this.props.getAsset(percorso, this.props.field);
        if (!asset || asset.path === 'empty.svg') { this.ricontrollaTraPoco(); return null; }
        var url = asset.toString();
        if (url) return /^(blob:|data:|https?:|\/)/.test(url) ? url : '/' + url;
      } catch (e) { /* niente anteprima: resta il riquadro grigio */ }
      return null;
    },

    ricontrollaTraPoco: function () {
      var self = this;
      if (this.timerAsset || (this.tentativi = (this.tentativi || 0) + 1) > 40) return;
      this.timerAsset = setTimeout(function () {
        self.timerAsset = null;
        if (!self.smontato) self.forceUpdate();
      }, 800);
    },

    anteprimaNonTrovata: function (percorso) {
      if (!this.ripieghi) this.ripieghi = {};
      if (this.ripieghi[percorso] || (this.anteprime && this.anteprime[percorso])) return;
      this.ripieghi[percorso] = true;
      this.forceUpdate();
    },

    eTrascinamentoFile: function (e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      return !!t && Array.prototype.indexOf.call(t, 'Files') !== -1;
    },

    /* zona di caricamento */
    suZonaOver: function (e) {
      if (!this.eTrascinamentoFile(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!this.state.sopra) this.setState({ sopra: true });
    },
    suZonaLeave: function (e) {
      // dragleave scatta anche passando da un figlio all'altro: conta solo l'uscita vera.
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      if (this.state.sopra) this.setState({ sopra: false });
    },
    suZonaDrop: function (e) {
      if (!this.eTrascinamentoFile(e)) return;
      e.preventDefault();
      if (occupatoOra(this)) { this.setState({ sopra: false }); return; }
      this.setState({ sopra: false });
      this.aggiungi(e.dataTransfer.files);
    },

    render: function () {
      var self = this;
      var p = this.props;
      var s = this.state;
      var percorsi = this.percorsi();
      var occupato = !!s.lavoro || p.isDisabled;
      var idInput = (p.forID || 'galleria') + '-file';

      var zona = h('div', { className: 'cfg-zona' + (s.sopra ? ' cfg-sopra' : '') },
        h('p', null, 'Trascinate qui le foto, anche tutte insieme, oppure'),
        h('button', {
          type: 'button',
          className: 'cfg-bottone',
          disabled: occupato,
          onClick: function () { if (self.input) self.input.click(); }
        }, s.lavoro ? 'Sto preparando le foto…' : 'Scegli le foto'),
        h('input', {
          id: idInput,
          type: 'file',
          multiple: true,
          accept: 'image/*',
          style: { display: 'none' },
          ref: function (el) { self.input = el; },
          onChange: function (e) {
            var f = e.target.files;
            self.aggiungi(f);
            e.target.value = ''; // permette di riscegliere gli stessi file
          }
        }),
        s.lavoro ? h('div', { className: 'cfg-stato' },
          'Preparo le foto: ' + s.lavoro.fatte + ' di ' + s.lavoro.totali
            + '. Attendete la fine prima di pubblicare.',
          h('div', { className: 'cfg-barra' },
            h('span', { style: { width: Math.round(100 * s.lavoro.fatte / s.lavoro.totali) + '%' } })),
          s.pubblicaBloccata ? h('div', { className: 'cfg-errore' },
            'Attendete che finisca il caricamento delle foto prima di pubblicare: la voce non è stata salvata.') : null
        ) : null,
        !s.lavoro && s.messaggio ? h('div', { className: 'cfg-stato' + (s.errore ? ' cfg-errore' : '') }, s.messaggio) : null
      );

      var griglia = percorsi.length ? h('div', { className: 'cfg-griglia' },
        percorsi.map(function (percorso, i) {
          var classi = 'cfg-foto' + (i === 0 ? ' cfg-copertina' : '')
            + (s.presa === i ? ' cfg-presa' : '') + (s.bersaglio === i && s.presa !== i ? ' cfg-bersaglio' : '');
          return h('div', {
            key: percorso, // i percorsi sono unici: la chiave segue la foto nel riordino
            className: classi,
            draggable: !occupato,
            title: percorso.split('/').pop(),
            onDragStart: function (e) {
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* IE */ }
              self.setState({ presa: i });
            },
            onDragOver: function (e) {
              if (self.state.presa == null) return; // file dall'esterno: li gestisce la zona
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (self.state.bersaglio !== i) self.setState({ bersaglio: i });
            },
            onDrop: function (e) {
              if (self.state.presa == null) return;
              e.preventDefault();
              self.sposta(self.state.presa, i);
              self.setState({ presa: null, bersaglio: null });
            },
            onDragEnd: function () { self.setState({ presa: null, bersaglio: null }); }
          },
            (function () {
              var src = self.urlAnteprima(percorso);
              return src ? h('img', {
                src: src, alt: '', loading: 'lazy',
                onError: function () { self.anteprimaNonTrovata(percorso); }
              }) : null;
            })(),
            i === 0 ? h('span', { className: 'cfg-etichetta' }, 'Copertina') : null,
            h('span', { className: 'cfg-numero' }, String(i + 1)),
            h('div', { className: 'cfg-azioni' },
              i > 0 ? h('button', {
                type: 'button', title: 'Usa come copertina', disabled: occupato,
                onClick: function () { self.sposta(i, 0); }
              }, '★') : null,
              h('button', {
                type: 'button', title: 'Togli questa foto', disabled: occupato,
                onClick: function () { self.togli(i); }
              }, '✕')
            )
          );
        })
      ) : null;

      var nota = percorsi.length > 1
        ? h('div', { className: 'cfg-nota' }, percorsi.length + ' foto. Trascinatele per cambiare l\'ordine; ★ mette una foto come copertina.')
        : null;

      // I file si possono lasciare cadere su tutto il campo, miniature comprese:
      // altrimenti il browser aprirebbe la foto al posto del pannello.
      return h('div', {
        className: p.classNameWrapper,
        id: p.forID,
        onDragOver: this.suZonaOver,
        onDragEnter: this.suZonaOver,
        onDragLeave: this.suZonaLeave,
        onDrop: this.suZonaDrop
      }, zona, griglia, nota);
    }
  });

  /* ---------- anteprima (il pannello ha preview: false, ma serve registrarla) ---------- */

  var GalleriaPreview = createClass({
    render: function () {
      var self = this;
      var percorsi = comeArray(this.props.value);
      return h('div', null, percorsi.map(function (p) {
        var a = self.props.getAsset && self.props.getAsset(p, self.props.field);
        return h('img', { key: p, src: a ? a.toString() : p, style: { maxWidth: '160px', margin: '4px' } });
      }));
    }
  });

  CMS.registerWidget('galleria', GalleriaControl, GalleriaPreview);
})();
