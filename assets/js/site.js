/* ============================================================
   CF Consulting — comportamenti di pagina
   Nessuna libreria. Tre blocchi indipendenti:
   1. rivelazioni allo scroll   2. pannello Servizi   3. drawer
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --- 1. Rivelazioni allo scroll --------------------------- */

  function initReveal() {
    var targets = document.querySelectorAll('[data-rv], [data-title], [data-line]');
    if (!targets.length) return;

    if (reduced.matches || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    // stagger: elementi [data-rv] vicini partono a ~70ms di distanza
    document.querySelectorAll('[data-rv]').forEach(function (el) {
      var sibs = Array.prototype.filter.call(el.parentNode.children, function (c) {
        return c.hasAttribute && c.hasAttribute('data-rv');
      });
      var i = sibs.indexOf(el);
      if (sibs.length > 1 && i > 0) el.setAttribute('data-rv-i', Math.min(i, 6));
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    targets.forEach(function (el) {
      // quello che è già visibile al caricamento entra subito
      if (el.getBoundingClientRect().top < (window.innerHeight || 800) * 0.94) {
        el.classList.add('is-in');
      } else {
        io.observe(el);
      }
    });
  }

  /* --- 2. Pannello Servizi (desktop) ------------------------ */

  function initServicesPanel() {
    var toggle = document.querySelector('[data-panel-toggle]');
    var panel = document.getElementById('cf-services-panel');
    if (!toggle || !panel) return;

    var tabs = panel.querySelectorAll('[data-area]');
    var header = toggle.closest('header');

    function open(state) {
      panel.classList.toggle('is-open', state);
      toggle.setAttribute('aria-expanded', state ? 'true' : 'false');
    }

    function selectArea(id) {
      tabs.forEach(function (t) {
        var on = t.dataset.area === id;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      panel.querySelectorAll('[data-area-panel]').forEach(function (p) {
        p.hidden = p.dataset.areaPanel !== id;
      });
    }

    toggle.addEventListener('click', function () {
      open(!panel.classList.contains('is-open'));
    });

    tabs.forEach(function (tab) {
      tab.addEventListener('mouseenter', function () { selectArea(tab.dataset.area); });
      tab.addEventListener('focus', function () { selectArea(tab.dataset.area); });
      tab.addEventListener('click', function () { selectArea(tab.dataset.area); });
    });

    // chiusura: clic fuori dall'header, o su un link dentro l'header
    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('is-open')) return;
      if (!header.contains(e.target)) { open(false); return; }
      if (e.target.closest('a')) open(false);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) {
        open(false);
        toggle.focus();
      }
    });
  }

  /* --- 3. Drawer (mobile) ----------------------------------- */

  function initDrawer() {
    var toggle = document.querySelector('[data-drawer-toggle]');
    var drawer = document.getElementById('cf-drawer');
    var backdrop = document.querySelector('.drawer-backdrop');
    if (!toggle || !drawer || !backdrop) return;

    backdrop.hidden = false;

    function setOpen(state) {
      drawer.classList.toggle('is-open', state);
      backdrop.classList.toggle('is-open', state);
      toggle.setAttribute('aria-expanded', state ? 'true' : 'false');
      document.body.style.overflow = state ? 'hidden' : '';
      if (!state) {
        drawer.querySelectorAll('[data-acc-toggle]').forEach(function (b) {
          b.setAttribute('aria-expanded', 'false');
        });
      }
    }

    toggle.addEventListener('click', function () {
      setOpen(!drawer.classList.contains('is-open'));
    });

    document.querySelectorAll('[data-drawer-close]').forEach(function (el) {
      el.addEventListener('click', function () { setOpen(false); });
    });

    // una voce selezionata chiude il drawer
    drawer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });

    // fisarmonica delle aree
    drawer.querySelectorAll('[data-acc-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var wasOpen = btn.getAttribute('aria-expanded') === 'true';
        drawer.querySelectorAll('[data-acc-toggle]').forEach(function (b) {
          b.setAttribute('aria-expanded', 'false');
        });
        btn.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    // tornando a desktop il drawer non deve restare aperto
    window.matchMedia('(min-width: 981px)').addEventListener('change', function (e) {
      if (e.matches) setOpen(false);
    });
  }

  initReveal();
  initServicesPanel();
  initDrawer();
})();

/* ============================================================
   CF Consulting — comportamenti delle singole pagine
   Caricato su tutte le pagine: ogni blocco esce subito se i
   propri elementi non ci sono.
   ============================================================ */
(function () {
  'use strict';

  var CONSENT_KEY = 'cf-cookie-consent';

  // la scelta vale 6 mesi, poi si richiede (linee guida del Garante, 2021).
  // Si salva come «valore;data»: un valore senza data è vecchio e si richiede.
  var CONSENT_DURATA = 182 * 24 * 60 * 60 * 1000;

  function readConsent() {
    try {
      var parti = String(localStorage.getItem(CONSENT_KEY) || '').split(';');
      var quando = Number(parti[1]);
      if (!quando || Date.now() - quando > CONSENT_DURATA) return null;
      return parti[0];
    } catch (e) { return null; }
  }
  function writeConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v + ';' + Date.now()); } catch (e) {}
  }

  /* --- 4. Banner cookie (tutte le pagine) ------------------- */

  function initCookies() {
    var bar = document.querySelector('.cookiebar');
    if (!bar) return;

    var consent = readConsent();
    if (!consent) bar.hidden = false;

    function decide(value) {
      writeConsent(value);
      bar.hidden = true;
      if (value === 'all') loadAllMaps();
    }

    bar.querySelector('.cookiebar__accept').addEventListener('click', function () { decide('all'); });
    bar.querySelector('.cookiebar__decline').addEventListener('click', function () { decide('necessary'); });
    // chiudere con la X senza scegliere vale come rifiuto
    var chiudi = bar.querySelector('.cookiebar__close');
    if (chiudi) chiudi.addEventListener('click', function () { decide('necessary'); });

    // la scelta si deve poter cambiare in qualsiasi momento: è un obbligo,
    // non una cortesia. Il collegamento sta nel footer di ogni pagina.
    document.querySelectorAll('[data-cookie-prefs]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        bar.hidden = false;
        bar.scrollIntoView({ block: 'end' });
      });
    });
  }

  /* --- 5. Mappa Google, solo con consenso «all» ------------- */

  function loadMap(frame) {
    if (!frame || frame.querySelector('iframe')) return;

    var iframe = document.createElement('iframe');
    iframe.title = 'Sede CF Consulting — Via Aldo Bartocci 7/T, Terni';
    iframe.src = frame.dataset.map;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    frame.textContent = '';
    frame.appendChild(iframe);
  }

  function loadAllMaps() {
    document.querySelectorAll('[data-map]').forEach(loadMap);
  }

  function initMap() {
    var frames = document.querySelectorAll('[data-map]');
    if (!frames.length) return;

    if (readConsent() === 'all') { loadAllMaps(); return; }

    frames.forEach(function (frame) {
      var btn = frame.querySelector('[data-map-load]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        writeConsent('all');
        var bar = document.querySelector('.cookiebar');
        if (bar) bar.hidden = true;
        loadAllMaps();
      });
    });
  }

  /* --- 6. Archivio progetti: filtri e «carica altri» -------- */

  function initArchive() {
    var grid = document.querySelector('[data-archive]');
    if (!grid) return;

    var STEP = 9;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-cat]'));
    var filters = document.querySelectorAll('[data-filter]');
    var moreBtn = document.querySelector('[data-archive-more]');
    var counter = document.querySelector('[data-archive-counter]');

    var current = 'Tutti';
    var shown = STEP;

    function matching() {
      return cards.filter(function (c) {
        return current === 'Tutti' || c.dataset.cat === current;
      });
    }

    function render() {
      var visible = matching();
      cards.forEach(function (c) { c.hidden = true; });
      visible.slice(0, shown).forEach(function (c) { c.hidden = false; });

      if (moreBtn) moreBtn.parentNode.hidden = visible.length <= shown;
      if (counter) {
        counter.textContent = Math.min(shown, visible.length) + ' di ' + visible.length + ' progetti';
      }
    }

    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        current = btn.dataset.filter;
        shown = STEP;
        filters.forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        render();
        // le schede appena mostrate devono comparire, non restare trasparenti
        matching().slice(0, shown).forEach(function (c) { c.classList.add('is-in'); });
      });
    });

    if (moreBtn) moreBtn.addEventListener('click', function () {
      shown += STEP;
      render();
      matching().slice(0, shown).forEach(function (c) { c.classList.add('is-in'); });
    });

    render();
  }

  /* --- 7. Pagina progetto: blocchi a fisarmonica ------------ */

  function initAccordions() {
    var btns = document.querySelectorAll('.accordion__btn');
    if (!btns.length) return;

    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btns.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
  }

  /* --- 8. Pagina progetto: galleria ------------------------- */

  function initGallery() {
    var gallery = document.querySelector('[data-gallery]');
    if (!gallery) return;

    var STEP = 4;
    var items = Array.prototype.slice.call(gallery.querySelectorAll('.gallery__item'));
    var btn = document.querySelector('[data-gallery-more]');
    var counter = document.querySelector('[data-gallery-counter]');

    function render(shown) {
      items.forEach(function (it, i) { it.hidden = i >= shown; });
      if (counter) counter.textContent = Math.min(shown, items.length) + ' di ' + items.length + ' immagini';
      if (btn) btn.parentNode.hidden = shown >= items.length;
    }

    if (btn) btn.addEventListener('click', function () { render(items.length); });
    render(STEP);
  }

  /* --- 9. Form contatti ------------------------------------- */

  function initForm() {
    var form = document.querySelector('[data-contact-form]');
    if (!form) return;

    var status = form.querySelector('.form__status');
    var submit = form.querySelector('.form__submit');

    function fieldError(input, message) {
      var box = input.closest('.form__field');
      var slot = box && box.querySelector('.form__error');
      if (slot) slot.textContent = message || '';
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      return !message;
    }

    function validate() {
      var ok = true;
      var name = form.elements.nome;
      var email = form.elements.email;
      var message = form.elements.messaggio;
      var consent = form.elements.privacy;

      ok = fieldError(name, name.value.trim() ? '' : 'Inserisci il tuo nome.') && ok;
      ok = fieldError(email, /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.value.trim())
        ? '' : 'Inserisci un indirizzo email valido.') && ok;
      ok = fieldError(message, message.value.trim().length >= 10
        ? '' : 'Scrivi almeno una riga sulla tua richiesta.') && ok;
      ok = fieldError(consent, consent.checked ? '' : 'Conferma di aver letto l’informativa privacy.') && ok;
      return ok;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.hidden = true;
      status.classList.remove('form__status--ok');

      // trappola anti-spam: i bot compilano anche i campi nascosti
      if (form.elements.azienda && form.elements.azienda.value) return;

      if (!validate()) {
        var first = form.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
        return;
      }

      var endpoint = form.getAttribute('action');
      if (!endpoint || endpoint === '#') {
        status.hidden = false;
        status.textContent = 'Il form non è ancora collegato a un indirizzo di invio. '
          + 'Scrivici intanto a info@cieffeconsulting.eu o allo 0744 196 3005.';
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Invio in corso…';

      // Netlify Forms vuole i campi codificati come una querystring,
      // non come multipart: con FormData l'invio verrebbe rifiutato.
      fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(new FormData(form)).toString()
      }).then(function (res) {
        if (!res.ok) throw new Error('invio non riuscito');
        form.reset();
        status.hidden = false;
        status.classList.add('form__status--ok');
        status.textContent = 'Richiesta inviata. Ti rispondiamo al più presto.';
      }).catch(function () {
        status.hidden = false;
        status.textContent = 'Invio non riuscito. Riprova più tardi oppure scrivici a info@cieffeconsulting.eu.';
      }).finally(function () {
        submit.disabled = false;
        submit.textContent = 'Invia la tua richiesta';
      });
    });

    form.addEventListener('input', function (e) {
      if (e.target.getAttribute('aria-invalid') === 'true') validate();
    });
  }

  initCookies();
  initMap();
  initArchive();
  initAccordions();
  initGallery();
  initForm();
})();

/* ============================================================
   CF Consulting — carosello e visore a schermo intero
   ============================================================ */
(function () {
  'use strict';

  /* --- 10. Carosello ---------------------------------------- */

  function initCarousels() {
    document.querySelectorAll('[data-carousel]').forEach(function (car) {
      var pista = car.querySelector('[data-carousel-track]');
      var voci = Array.prototype.slice.call(pista.children);
      var prec = car.querySelector('[data-carousel-prev]');
      var succ = car.querySelector('[data-carousel-next]');
      var conta = car.querySelector('[data-carousel-count]');
      var tastoPausa = car.querySelector('[data-carousel-pause]');
      if (voci.length < 2) return;

      function indiceCorrente() {
        // la voce più vicina al bordo sinistro della pista
        var x = pista.scrollLeft;
        var vicino = 0;
        var minimo = Infinity;
        voci.forEach(function (v, i) {
          var d = Math.abs(v.offsetLeft - pista.offsetLeft - x);
          if (d < minimo) { minimo = d; vicino = i; }
        });
        return vicino;
      }

      // la destinazione si tiene a parte: leggere la posizione mentre
      // l'animazione è in corso faceva annullare i clic ravvicinati
      var indiceTarget = 0;

      function aggiorna() {
        if (conta) conta.textContent = (indiceTarget + 1) + ' / ' + voci.length;
      }

      /** Indice successivo o precedente, in tondo: dopo l'ultima si
       *  torna alla prima e viceversa. */
      function inTondo(i) {
        return (i + voci.length) % voci.length;
      }

      // lo scorrimento è animato a mano: `scrollTo({behavior:'smooth'})`
      // viene ignorato quando la pista ha lo scroll-snap obbligatorio
      var animazione = null;

      function vaiA(i, immediato) {
        i = Math.max(0, Math.min(voci.length - 1, i));
        indiceTarget = i;
        aggiorna();
        var arrivo = voci[i].offsetLeft - pista.offsetLeft;
        var partenza = pista.scrollLeft;
        var tratto = arrivo - partenza;

        if (animazione) cancelAnimationFrame(animazione);
        // a scheda nascosta requestAnimationFrame non scatta: si salta
        if (reduced.matches || document.hidden || immediato || !tratto) {
          pista.scrollLeft = arrivo;
          return;
        }

        var durata = 420;
        var inizio = null;

        function passo(ora) {
          if (inizio === null) inizio = ora;
          var t = Math.min(1, (ora - inizio) / durata);
          var morbido = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          pista.scrollLeft = partenza + tratto * morbido;
          if (t < 1) animazione = requestAnimationFrame(passo);
          else animazione = null;
        }
        animazione = requestAnimationFrame(passo);
      }

      function scorri(verso) {
        var da = indiceTarget;
        var a = inTondo(da + verso);
        // il rientro dall'ultima alla prima è istantaneo: animarlo
        // significherebbe far sfilare tutte le foto di colpo
        var rientro = (da === voci.length - 1 && a === 0) || (da === 0 && a === voci.length - 1);
        vaiA(a, rientro);
      }

      if (prec) prec.addEventListener('click', function () { scorri(-1); });
      if (succ) succ.addEventListener('click', function () { scorri(1); });

      car.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { scorri(-1); e.preventDefault(); }
        if (e.key === 'ArrowRight') { scorri(1); e.preventDefault(); }
      });

      // scorrimento a mano (dito o barra): la destinazione si riallinea
      var attesa;
      pista.addEventListener('scroll', function () {
        clearTimeout(attesa);
        attesa = setTimeout(function () {
          if (animazione) return;
          // ci si riallinea solo se la pista è finita altrove rispetto
          // alla destinazione: altrimenti si annullerebbero i clic rapidi
          var atteso = voci[indiceTarget].offsetLeft - pista.offsetLeft;
          if (Math.abs(pista.scrollLeft - atteso) < 5) return;
          indiceTarget = indiceCorrente();
          aggiorna();
        }, 90);
      }, { passive: true });

      window.addEventListener('resize', aggiorna);
      window.addEventListener('load', aggiorna);
      aggiorna();

      /* --- avanzamento automatico ---------------------------- */

      var attesaAuto = parseInt(car.dataset.carouselAuto || '0', 10);
      if (!attesaAuto || reduced.matches) {
        // senza scorrimento automatico il pulsante non avrebbe senso
        if (tastoPausa) tastoPausa.hidden = true;
        return;
      }

      var battito = null;
      var inPausa = false;         // mouse sopra, fuoco dentro, scheda nascosta
      var fermatoDaUtente = false; // pausa chiesta col pulsante
      var inVista = true;

      function avanza() { scorri(1); }

      function riavvia() {
        clearInterval(battito);
        battito = null;
        if (inPausa || fermatoDaUtente || !inVista) return;
        battito = setInterval(avanza, attesaAuto);
      }

      function sospendi(stato) { inPausa = stato; riavvia(); }

      // Niente pausa col mouse sopra: il puntatore resta spesso fermo
      // a metà schermo mentre si scorre la pagina, e il carosello non
      // sarebbe mai ripartito.
      // La pausa col fuoco vale solo per chi naviga da tastiera: dopo un
      // clic col mouse il fuoco resta sulla freccia, e prima restava
      // fermo per sempre.
      car.addEventListener('focusin', function () {
        var a = document.activeElement;
        var daTastiera = a && a.matches && a.matches(':focus-visible');
        if (daTastiera) sospendi(true);
      });
      car.addEventListener('focusout', function () {
        if (!car.contains(document.activeElement)) sospendi(false);
      });
      document.addEventListener('visibilitychange', function () { sospendi(document.hidden); });

      // fuori dallo schermo non ha senso far girare niente
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (voci) {
          inVista = voci[0].isIntersecting;
          riavvia();
        }, { threshold: 0.2 }).observe(car);
      }

      // obbligo di accessibilità: ciò che si muove da solo per più di
      // cinque secondi deve potersi fermare, e in modo dichiarato
      if (tastoPausa) {
        tastoPausa.addEventListener('click', function () {
          fermatoDaUtente = !fermatoDaUtente;
          tastoPausa.setAttribute('aria-pressed', fermatoDaUtente ? 'true' : 'false');
          tastoPausa.setAttribute('aria-label', fermatoDaUtente
            ? 'Riprendi lo scorrimento automatico'
            : 'Ferma lo scorrimento automatico');
          tastoPausa.textContent = fermatoDaUtente ? '▶' : '‖';
          riavvia();
        });
      }

      riavvia();
    });
  }

  /* --- 11. Visore a schermo intero --------------------------- */

  function initLightbox() {
    var gruppi = {};
    document.querySelectorAll('[data-zoom]').forEach(function (img) {
      var nome = img.dataset.zoom || 'predefinito';
      (gruppi[nome] = gruppi[nome] || []).push(img);
    });
    if (!Object.keys(gruppi).length) return;

    var visore = document.createElement('div');
    visore.className = 'visore';
    visore.setAttribute('role', 'dialog');
    visore.setAttribute('aria-modal', 'true');
    visore.setAttribute('aria-label', 'Immagine a schermo intero');
    visore.hidden = true;
    visore.innerHTML =
      '<button type="button" class="visore__chiudi" aria-label="Chiudi">&times;</button>' +
      '<button type="button" class="visore__prec" aria-label="Immagine precedente">&#8249;</button>' +
      '<figure class="visore__corpo"><img alt="" /><figcaption></figcaption></figure>' +
      '<button type="button" class="visore__succ" aria-label="Immagine successiva">&#8250;</button>' +
      '<div class="visore__conta"></div>';
    document.body.appendChild(visore);

    var figura = visore.querySelector('.visore__corpo img');
    var didascalia = visore.querySelector('figcaption');
    var conta = visore.querySelector('.visore__conta');
    var gruppoAttivo = [];
    var indice = 0;
    var sorgente = null;

    function grande(img) {
      // nel srcset c'è già la versione a piena risoluzione
      var set = img.getAttribute('srcset');
      if (set) {
        var ultima = set.split(',').pop().trim().split(/\s+/)[0];
        if (ultima) return ultima;
      }
      return img.currentSrc || img.src;
    }

    function mostra(i) {
      indice = (i + gruppoAttivo.length) % gruppoAttivo.length;
      var img = gruppoAttivo[indice];
      figura.src = grande(img);
      figura.alt = img.alt || '';
      didascalia.textContent = img.alt || '';
      conta.textContent = (indice + 1) + ' / ' + gruppoAttivo.length;
      visore.querySelector('.visore__prec').hidden = gruppoAttivo.length < 2;
      visore.querySelector('.visore__succ').hidden = gruppoAttivo.length < 2;
    }

    function apri(gruppo, i, origine) {
      gruppoAttivo = gruppo;
      sorgente = origine;
      mostra(i);
      visore.hidden = false;
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () { visore.classList.add('is-open'); });
      visore.querySelector('.visore__chiudi').focus();
    }

    function chiudi() {
      visore.classList.remove('is-open');
      visore.hidden = true;
      document.body.style.overflow = '';
      if (sorgente) sorgente.focus();
    }

    Object.keys(gruppi).forEach(function (nome) {
      var gruppo = gruppi[nome];
      gruppo.forEach(function (img, i) {
        var bersaglio = img.closest('button, a') ? img : img.parentNode;
        bersaglio.classList.add('zoomabile');
        if (!bersaglio.hasAttribute('tabindex')) bersaglio.tabIndex = 0;
        bersaglio.setAttribute('role', 'button');
        bersaglio.setAttribute('aria-label', 'Ingrandisci: ' + (img.alt || 'immagine'));

        bersaglio.addEventListener('click', function () { apri(gruppo, i, bersaglio); });
        bersaglio.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(gruppo, i, bersaglio); }
        });
      });
    });

    visore.querySelector('.visore__chiudi').addEventListener('click', chiudi);
    visore.querySelector('.visore__prec').addEventListener('click', function () { mostra(indice - 1); });
    visore.querySelector('.visore__succ').addEventListener('click', function () { mostra(indice + 1); });
    visore.addEventListener('click', function (e) {
      if (e.target === visore || e.target.classList.contains('visore__corpo')) chiudi();
    });

    document.addEventListener('keydown', function (e) {
      if (visore.hidden) return;
      if (e.key === 'Escape') chiudi();
      if (e.key === 'ArrowLeft') mostra(indice - 1);
      if (e.key === 'ArrowRight') mostra(indice + 1);
    });
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  initCarousels();
  initLightbox();
})();

/* --- barra di lavorazione -----------------------------------
   Compare solo quando il sito gira in locale. Non esiste nel
   codice delle pagine: la costruisce questo script, così non
   finisce nemmeno per sbaglio nel pacchetto pubblicato. */
(function () {
  var locale = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)$/.test(location.hostname);
  if (!locale) return;

  var barra = document.createElement('div');
  barra.className = 'devbar';
  barra.innerHTML =
    '<span class="devbar__tag">Locale</span>' +
    '<a class="devbar__link" href="/admin/">Pannello CMS</a>' +
    '<a class="devbar__link" href="/">Sito</a>' +
    '<button type="button" class="devbar__close" aria-label="Nascondi la barra">&times;</button>';

  barra.querySelector('.devbar__close').addEventListener('click', function () {
    barra.remove();
    try { sessionStorage.setItem('devbar', 'chiusa'); } catch (e) {}
  });

  try {
    if (sessionStorage.getItem('devbar') === 'chiusa') return;
  } catch (e) {}

  document.body.appendChild(barra);
})();
