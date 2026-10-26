// Page d'atterrissage : filtres par famille et panneau de détail. Sans bibliothèque, sans requête réseau.
(function () {
  "use strict";
  var donnees = JSON.parse(document.getElementById("donnees-articles").textContent);
  var parId = {};
  donnees.forEach(function (a) { parId[a.id] = a; });

  // ---- filtres : boutons à bascule, utilisables au clavier (Tab, Entrée, Espace)
  var filtres = document.querySelectorAll(".filtre");
  var items = document.querySelectorAll(".carte-item");
  function appliquerFiltre(f) {
    filtres.forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-filtre") === f ? "true" : "false"); });
    items.forEach(function (it) {
      it.hidden = !(f === "tous" || it.getAttribute("data-famille") === f);
    });
    document.querySelectorAll(".chapitre-web").forEach(function (c) {
      c.hidden = !(f === "tous" || c.getAttribute("data-famille") === f);
    });
  }
  filtres.forEach(function (b) {
    b.addEventListener("click", function () { appliquerFiltre(b.getAttribute("data-filtre")); });
  });
  // un lien d'ancre vers un chapitre masqué par le filtre actif remet « Tous » : la cible s'affiche avant le défilement
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#chap-"]');
    if (!a) return;
    var cible = document.getElementById(a.getAttribute("href").slice(1));
    if (cible && cible.hidden) appliquerFiltre("tous");
  });

  // ---- panneau de détail : <dialog> natif (piège de focus, Échap, retour du focus)
  var dlg = document.getElementById("detail");
  var declencheur = null;
  function ouvrir(id, bouton) {
    var a = parId[id];
    if (!a) return;
    declencheur = bouton;
    document.getElementById("detail-famille").textContent = a.famille;
    document.getElementById("detail-titre").textContent = a.nom;
    document.getElementById("detail-description").textContent = a.description;
    document.getElementById("detail-matiere").textContent = a.matiere || "";
    document.getElementById("detail-origine").textContent = a.origine;
    document.getElementById("detail-perso").textContent = a.personnalisation;
    var vis = document.getElementById("detail-vis");
    vis.className = "detail-vis " + a.classe + " vis-" + a.type;
    vis.textContent = "";
    if (a.visuel) {
      var img = document.createElement("img");
      img.src = a.visuel;
      img.alt = a.nom;
      if (!a.detoure) img.className = "photo";
      vis.appendChild(img);
      if (a.intention) {
        var tag = document.createElement("span");
        tag.className = "etiquette-intention";
        tag.textContent = a.intention;
        vis.appendChild(tag);
      }
    }
    var nuancier = document.getElementById("detail-nuancier");
    nuancier.textContent = "";
    a.couleurs.forEach(function (c) {
      var s = document.createElement("span");
      s.style.background = c.hex;
      s.title = c.nom;
      s.setAttribute("role", "img");
      s.setAttribute("aria-label", c.nom);
      nuancier.appendChild(s);
    });
    document.getElementById("detail-mention").textContent = a.mention || "";
    // masquer les lignes vides
    ["matiere", "mention"].forEach(function (k) {
      var dd = document.getElementById("detail-" + k);
      dd.hidden = dd.previousElementSibling.hidden = !dd.textContent;
    });
    dlg.showModal();
    document.getElementById("detail-fermer").focus();
  }
  document.querySelectorAll(".carte").forEach(function (b) {
    b.addEventListener("click", function () { ouvrir(b.getAttribute("data-id"), b); });
  });
  document.getElementById("detail-fermer").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", function () { if (declencheur) declencheur.focus(); });

  // ---- descriptions courtes : 2 lignes ou moins = alignées à gauche (classe "court"), mesure au rendu
  // au chargement, au redimensionnement et quand les polices sont prêtes
  function courtes() {
    document.querySelectorAll(".voile > span:first-child, .cartes-vip li > p:not(.sel-note)").forEach(function (p) {
      var h = p.getBoundingClientRect().height;
      if (!h) return; // non rendu (ex. voile masqué sur écran tactile)
      var lh = parseFloat(getComputedStyle(p).lineHeight);
      p.classList.toggle("court", h <= 2 * lh + 1);
    });
  }
  var attente = 0;
  window.addEventListener("resize", function () {
    cancelAnimationFrame(attente);
    attente = requestAnimationFrame(courtes);
  });
  window.addEventListener("load", courtes);
  courtes();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(courtes);

  // ---- sélection et demande d'offre : tout en mémoire (aucun stockage, aucune requête), perdue au rechargement
  var cfg = JSON.parse(document.getElementById("donnees-selection").textContent);
  var noms = {};
  donnees.forEach(function (a) { noms[a.id] = { nom: a.nom, famille: a.famille, concept: false }; });
  cfg.concepts.forEach(function (c) { noms[c.id] = { nom: c.nom, famille: cfg.famille_concept, concept: true }; });
  var choix = []; // { id, qte } dans l'ordre d'ajout
  var qteDefaut = null;

  var indicateur = document.getElementById("sel-indicateur");
  var compteur = document.getElementById("sel-n");
  var live = document.getElementById("sel-live");
  var panneau = document.getElementById("selection");
  var liste = document.getElementById("sel-liste");
  var remarque = document.getElementById("sel-remarque");
  var envoyer = document.getElementById("sel-envoyer");
  var zoneCopie = document.getElementById("sel-copie");
  var texteCopie = document.getElementById("sel-texte");
  var msgCopie = document.getElementById("sel-copie-msg");

  function trouver(id) {
    for (var i = 0; i < choix.length; i++) if (choix[i].id === id) return i;
    return -1;
  }
  function boutonDe(id) { return document.querySelector('.sel-btn[data-sel-id="' + id + '"]'); }
  function qteDe(id) { return document.querySelector('select[data-sel-qte="' + id + '"]'); }
  function libelleQte(c) { return noms[c.id].concept ? cfg.sans_quantite : c.qte; }

  // Corps du message. Niveau 0 : une ligne complète par article (nom, famille, quantité). Si le lien dépasse le seuil, le corps se raccourcit
  // sans perdre aucun article : niveau 1 = nom et quantité, niveau 2 = noms regroupés par quantité.
  function lignesChoix(niveau) {
    if (niveau === 0) {
      return choix.map(function (c) { return "- " + noms[c.id].nom + " (" + noms[c.id].famille + ") : " + libelleQte(c); });
    }
    if (niveau === 1) {
      return choix.map(function (c) { return "- " + noms[c.id].nom + (noms[c.id].concept ? " (" + cfg.concept_court + ")" : " : " + c.qte); });
    }
    var groupes = [], cles = {};
    choix.forEach(function (c) {
      var k = noms[c.id].concept ? cfg.concept_court : c.qte;
      if (!(k in cles)) { cles[k] = groupes.length; groupes.push({ k: k, noms: [] }); }
      groupes[cles[k]].noms.push(noms[c.id].nom);
    });
    return groupes.map(function (g) { return g.k + " : " + g.noms.join(", "); });
  }
  function corps(niveau) {
    var lignes = [cfg.corps_intro].concat(lignesChoix(niveau || 0));
    lignes.push("");
    var r = remarque.value.replace(/\s+$/, "");
    if (r) { lignes.push(r.replace(/\r?\n/g, "\r\n")); lignes.push(""); }
    lignes.push(cfg.signature);
    return lignes.join("\r\n");
  }
  function lien(niveau) {
    return "mailto:" + cfg.courriel + "?subject=" + encodeURIComponent(cfg.objet) + "&body=" + encodeURIComponent(corps(niveau));
  }
  // premier niveau dont le lien tient sous le seuil ; -1 = même le plus court est trop long (repli : copie du texte complet)
  function niveauRetenu() {
    for (var n = 0; n <= 2; n++) if (lien(n).length <= cfg.seuil) return n;
    return -1;
  }
  function majEnvoi() {
    if (!choix.length) return;
    var n = niveauRetenu();
    var long = n < 0;
    envoyer.hidden = long;
    zoneCopie.hidden = !long;
    msgCopie.textContent = "";
    if (long) {
      document.getElementById("sel-adresse").textContent = cfg.courriel;
      texteCopie.value = corps(0);
    } else {
      envoyer.setAttribute("href", lien(n));
      envoyer.setAttribute("data-niveau", n);
    }
  }
  function majListe() {
    liste.textContent = "";
    choix.forEach(function (c) {
      var li = document.createElement("li");
      var t = document.createElement("span");
      t.className = "sel-ligne";
      var n = document.createElement("strong");
      n.textContent = noms[c.id].nom;
      var f = document.createElement("span");
      f.className = "sel-famille";
      f.textContent = noms[c.id].famille;
      var q = document.createElement("span");
      q.className = "sel-quantite";
      q.textContent = cfg.quantite_label + " : " + libelleQte(c);
      if (noms[c.id].concept) q.textContent = libelleQte(c);
      t.appendChild(n); t.appendChild(f); t.appendChild(q);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sel-retirer";
      b.textContent = cfg.retirer_court;
      var sr = document.createElement("span");
      sr.className = "sr";
      sr.textContent = " : " + noms[c.id].nom;
      b.appendChild(sr);
      b.addEventListener("click", function () { basculer(c.id, false, true); });
      li.appendChild(t); li.appendChild(b);
      liste.appendChild(li);
    });
  }
  function majTout() {
    compteur.textContent = choix.length;
    indicateur.hidden = choix.length === 0;
    live.textContent = indicateur.textContent.replace(/\s+/g, " ").trim();
    if (panneau.open) { majListe(); majEnvoi(); }
  }

  // ajoute (ajout = true) ou retire un article ou concept ; depuis le panneau, le focus passe au bouton suivant
  function basculer(id, ajout, depuisPanneau) {
    var i = trouver(id);
    var btn = boutonDe(id);
    var sel = qteDe(id);
    if (ajout && i < 0) {
      choix.push({ id: id, qte: sel ? sel.value : "" });
    } else if (!ajout && i >= 0) {
      choix.splice(i, 1);
    }
    btn.setAttribute("aria-pressed", ajout ? "true" : "false");
    btn.querySelector(".sel-txt").textContent = ajout ? cfg.retirer : cfg.ajouter;
    if (sel) {
      sel.parentNode.hidden = !ajout;
      if (!ajout) sel.value = qteDefaut;
    }
    majTout();
    if (depuisPanneau) {
      if (!choix.length) panneau.close();
      else { var b = liste.querySelector(".sel-retirer"); if (b) b.focus(); }
    }
  }
  var premier = document.querySelector("select[data-sel-qte]");
  if (premier) qteDefaut = premier.value;

  document.querySelectorAll(".sel-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      basculer(b.getAttribute("data-sel-id"), b.getAttribute("aria-pressed") !== "true", false);
    });
  });
  document.querySelectorAll("select[data-sel-qte]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var i = trouver(sel.getAttribute("data-sel-qte"));
      if (i >= 0) choix[i].qte = sel.value;
    });
  });

  function ouvrirPanneau() {
    if (!choix.length) return;
    majListe();
    majEnvoi();
    panneau.showModal();
    document.getElementById("sel-fermer").focus();
  }
  indicateur.addEventListener("click", ouvrirPanneau);
  document.getElementById("sel-fermer").addEventListener("click", function () { panneau.close(); });
  panneau.addEventListener("click", function (e) { if (e.target === panneau) panneau.close(); });
  panneau.addEventListener("close", function () {
    var cible = choix.length ? indicateur : document.getElementById("articles");
    if (!choix.length) cible.setAttribute("tabindex", "-1");
    cible.focus();
  });
  remarque.addEventListener("input", majEnvoi);

  document.getElementById("sel-copier").addEventListener("click", function () {
    var texte = corps(0);
    function repli() {
      texteCopie.value = texte;
      texteCopie.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      msgCopie.textContent = ok ? cfg.copie_ok : cfg.copie_echec;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(function () { msgCopie.textContent = cfg.copie_ok; }, repli);
    } else repli();
  });
})();
