"use strict";

/* ============ Erreurs visibles à l'écran (jamais silencieuses) ============ */
const errBox = document.getElementById("err");
function showError(ctx, e) {
  const msg = String((e && (e.stack || e.message)) || e).slice(0, 900);
  errBox.textContent = "";
  const t = document.createElement("strong"); t.textContent = ctx;
  const p = document.createElement("pre"); p.textContent = msg;
  const s = document.createElement("small"); s.textContent = "Touche pour fermer";
  errBox.append(t, p, s);
  errBox.hidden = false;
}
errBox.addEventListener("click", () => { errBox.hidden = true; });
window.addEventListener("error", (e) =>
  showError("Erreur JS", e.error || (e.message + " (" + e.filename + ":" + e.lineno + ")")));
window.addEventListener("unhandledrejection", (e) => showError("Erreur (promesse)", e.reason));

const $ = (id) => document.getElementById(id);
let toastT = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}
function busy(msg) {
  if (!msg) { $("busy").hidden = true; return; }
  $("busy-t").textContent = msg; $("busy").hidden = false;
}

/* ============ Base de données (IndexedDB) ============ */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("IndexedDB indisponible (navigation privée ?)"));
      const r = indexedDB.open("lecture-epub", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("books", { keyPath: "id" }); // métadonnées + progression
        d.createObjectStore("files");                     // le fichier epub lui-même
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("Ouverture de la base impossible"));
    });
  }
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq ? rq.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Écriture annulée (stockage plein ?)"));
  }));
}
const getBook = (id) => tx("books", "readonly", (s) => s.get(id));
const allBooks = () => tx("books", "readonly", (s) => s.getAll());
const putBook = (b) => tx("books", "readwrite", (s) => s.put(b));
const getFile = (id) => tx("files", "readonly", (s) => s.get(id));
const putFile = (id, buf) => tx("files", "readwrite", (s) => s.put(buf, id));
async function delBook(id) {
  await tx("books", "readwrite", (s) => s.delete(id));
  await tx("files", "readwrite", (s) => s.delete(id));
}
async function patchBook(id, patch) {
  const b = await getBook(id);
  if (!b) return;
  Object.assign(b, patch);
  await putBook(b);
}

/* ============ Réglages ============ */
const THEMES = {
  dark:  { bg: "#0f0f12", fg: "#d9d9de", link: "#8fb0ff" },
  sepia: { bg: "#f3e9d2", fg: "#4a3a28", link: "#a0522d" },
  light: { bg: "#fafaf7", fg: "#1b1b1f", link: "#3b5bdb" },
};
const FONTS = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
let S = { theme: "dark", size: 100, font: "serif" };
try { Object.assign(S, JSON.parse(localStorage.getItem("epub.settings") || "{}")); }
catch (e) { showError("Lecture des réglages", e); }
// Valeurs invalides (ex. réglages d'une autre appli du même site) : retour aux défauts
if (!THEMES[S.theme]) S.theme = "dark";
if (!FONTS[S.font]) S.font = "serif";
if (typeof S.size !== "number" || isNaN(S.size)) S.size = 100;
S.size = Math.min(220, Math.max(70, S.size));
function saveSettings() {
  try { localStorage.setItem("epub.settings", JSON.stringify(S)); }
  catch (e) { showError("Sauvegarde des réglages", e); }
}
function applyUiTheme() {
  document.body.dataset.theme = S.theme;
  document.querySelector('meta[name="theme-color"]').content = THEMES[S.theme].bg;
  document.querySelectorAll("#seg-theme button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.theme));
  document.querySelectorAll("#seg-font button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.font));
  $("size-val").textContent = S.size + " %";
}
applyUiTheme();

/* ============ Bibliothèque ============ */
let coverUrls = [];
function gradient(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return "linear-gradient(145deg,hsl(" + h + ",45%,38%),hsl(" + ((h + 40) % 360) + ",50%,22%))";
}
async function renderLibrary() {
  coverUrls.forEach((u) => URL.revokeObjectURL(u)); coverUrls = [];
  const list = (await allBooks()).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0) || b.addedAt - a.addedAt);
  const grid = $("grid");
  grid.textContent = "";
  $("empty").hidden = list.length > 0;
  for (const b of list) {
    const card = document.createElement("article"); card.className = "card";
    const cover = document.createElement("div"); cover.className = "cover";
    if (b.cover) {
      const img = new Image(); img.alt = "";
      const u = URL.createObjectURL(b.cover); coverUrls.push(u); img.src = u;
      cover.append(img);
    } else {
      cover.style.background = gradient(b.title);
      const s = document.createElement("span"); s.textContent = b.title; cover.append(s);
    }
    const more = document.createElement("button"); more.className = "more"; more.textContent = "×";
    more.setAttribute("aria-label", "Supprimer");
    more.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm("Supprimer « " + b.title + " » de l'appli ?")) return;
      try { await delBook(b.id); await renderLibrary(); } catch (e) { showError("Suppression impossible", e); }
    });
    cover.append(more);
    const meta = document.createElement("div"); meta.className = "meta";
    const t = document.createElement("div"); t.className = "t"; t.textContent = b.title;
    const a = document.createElement("div"); a.className = "a"; a.textContent = b.author || "";
    const bar = document.createElement("div"); bar.className = "bar";
    const i = document.createElement("i"); i.style.width = Math.round((b.percent || 0) * 100) + "%";
    bar.append(i);
    meta.append(t, a, bar);
    card.append(cover, meta);
    card.addEventListener("click", () => openBook(b.id));
    grid.append(card);
  }
}

async function importFile(f) {
  if (typeof ePub === "undefined") throw new Error("epub.js non chargé (connexion nécessaire au premier lancement)");
  const buf = await f.arrayBuffer();
  const id = f.name + "|" + f.size;
  if (await getBook(id)) { toast("Déjà dans la bibliothèque : " + f.name); return; }
  const book = ePub(buf.slice(0));
  let meta, cover = null;
  try {
    meta = await book.loaded.metadata;
    try {
      const u = await book.coverUrl();
      if (u) cover = await (await fetch(u)).blob();
    } catch (e) { toast("Couverture introuvable (non bloquant) : " + (e.message || e)); }
  } finally { try { book.destroy(); } catch (_) {} }
  await putFile(id, buf);
  await putBook({
    id, title: (meta && meta.title) || f.name.replace(/\.epub$/i, ""),
    author: (meta && meta.creator) || "", cover, addedAt: Date.now(),
    lastRead: 0, cfi: null, percent: 0, locations: null,
  });
}
$("file").addEventListener("change", async (ev) => {
  const files = [...ev.target.files]; ev.target.value = "";
  for (const f of files) {
    busy("Import de " + f.name + "…");
    try { await importFile(f); }
    catch (e) { showError("Import impossible : " + f.name, e); }
  }
  busy(false);
  try { await renderLibrary(); } catch (e) { showError("Affichage bibliothèque", e); }
});

/* ============ Lecteur ============ */
let book = null, rendition = null, cur = null, locReady = false;
let saveT = null, pendingSave = null, swipeUntil = 0, dragging = false;

function flushSave() {
  clearTimeout(saveT); saveT = null;
  if (!pendingSave || !cur) { pendingSave = null; return Promise.resolve(); }
  const p = pendingSave, id = cur.id; pendingSave = null;
  return patchBook(id, p).catch((e) => showError("Sauvegarde de la progression", e));
}
function scheduleSave(p) {
  pendingSave = Object.assign(pendingSave || {}, p);
  clearTimeout(saveT); saveT = setTimeout(flushSave, 500);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
window.addEventListener("pagehide", flushSave);

function setUi(show) { $("reader").classList.toggle("ui", show); }
function closeSheets() { $("backdrop").hidden = true; $("toc").hidden = true; $("settings").hidden = true; }
function openSheet(id) { setUi(false); $("backdrop").hidden = false; $(id).hidden = false; }

function applyReaderStyle() {
  if (!rendition) return;
  rendition.themes.select(S.theme);
  rendition.themes.fontSize(S.size + "%");
  rendition.themes.font(FONTS[S.font]);
}

function onRelocated(loc) {
  if (!cur || !loc || !loc.start) return;
  const cfi = loc.start.cfi;
  let pct = cur.percent || 0;
  if (locReady && book.locations.length()) {
    const p = book.locations.percentageFromCfi(cfi);
    if (typeof p === "number" && !isNaN(p)) pct = p;
  }
  cur.percent = pct; cur.cfi = cfi;
  $("pct").textContent = Math.round(pct * 100) + " %";
  $("slider-val").textContent = Math.round(pct * 100) + " %";
  if (!dragging) $("slider").value = Math.round(pct * 1000);
  scheduleSave({ cfi, percent: pct, lastRead: Date.now() });
}

function next() { setUi(false); if (rendition) rendition.next().catch((e) => showError("Page suivante", e)); }
function prev() { setUi(false); if (rendition) rendition.prev().catch((e) => showError("Page précédente", e)); }

function onTap(e) {
  if (Date.now() < swipeUntil) return;
  if (e.target && e.target.closest && e.target.closest("a")) return;
  try { if (e.view && e.view.getSelection && e.view.getSelection().toString()) return; } catch (_) {}
  const fr = e.view && e.view.frameElement;
  const off = fr ? fr.getBoundingClientRect().left : 0;
  const x = (e.clientX + off) / window.innerWidth;
  if ($("backdrop").hidden === false) { closeSheets(); return; }
  if (x < 0.28) prev();
  else if (x > 0.72) next();
  else setUi(!$("reader").classList.contains("ui"));
}

let tStart = null;
function onTouchStart(e) { const t = e.changedTouches[0]; tStart = { x: t.screenX, y: t.screenY }; }
function onTouchEnd(e) {
  if (!tStart) return;
  const t = e.changedTouches[0];
  const dx = t.screenX - tStart.x, dy = t.screenY - tStart.y; tStart = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    swipeUntil = Date.now() + 450;
    if (dx < 0) next(); else prev();
  }
}
function onKey(e) {
  if (!rendition) return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") next();
  else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
}
document.addEventListener("keydown", onKey);

function flatToc(items, depth, out) {
  for (const it of items) {
    out.push({ label: (it.label || "").trim() || "(sans titre)", href: it.href, depth });
    if (it.subitems && it.subitems.length) flatToc(it.subitems, depth + 1, out);
  }
  return out;
}

async function openBook(id) {
  busy("Ouverture…");
  try {
    if (typeof ePub === "undefined") throw new Error("epub.js non chargé (connexion nécessaire au premier lancement)");
    const rec = await getBook(id);
    if (!rec) throw new Error("Livre introuvable dans la base");
    const buf = await getFile(id);
    if (!buf) throw new Error("Fichier introuvable (le navigateur a vidé le stockage ?). Réimporte l'epub.");

    await teardown();
    cur = rec; locReady = false;
    $("title").textContent = rec.title;
    $("pct").textContent = Math.round((rec.percent || 0) * 100) + " %";
    $("slider").value = Math.round((rec.percent || 0) * 1000);
    $("slider").disabled = true;
    $("slider-val").textContent = Math.round((rec.percent || 0) * 100) + " %";
    $("library").hidden = true; $("reader").hidden = false; setUi(false); closeSheets();
    try { history.pushState({ r: 1 }, ""); } catch (_) {}
    try { localStorage.setItem("epub.lastOpen", id); } catch (_) {}

    const myBook = ePub(buf);
    book = myBook;
    rendition = book.renderTo("viewer", { width: "100%", height: "100%", spread: "none", flow: "paginated" });
    for (const [name, c] of Object.entries(THEMES)) {
      rendition.themes.register(name, {
        "html": { background: c.bg + " !important" },
        "body": { background: c.bg + " !important", color: c.fg + " !important", "line-height": "1.6 !important", "text-align": "left !important" },
        "body *": { color: "inherit !important" },
        "a, a *": { color: c.link + " !important" },
        "img": { "max-width": "100% !important" },
      });
    }
    applyReaderStyle();
    rendition.on("relocated", onRelocated);
    rendition.on("click", onTap);
    rendition.on("touchstart", onTouchStart);
    rendition.on("touchend", onTouchEnd);
    rendition.on("keyup", onKey);

    try { await rendition.display(rec.cfi || undefined); }
    catch (e) {
      showError("Reprise à la dernière position impossible, ouverture au début", e);
      await rendition.display();
    }
    busy(false);

    myBook.loaded.navigation.then((nav) => {
      if (book !== myBook) return;
      const box = $("toc-list"); box.textContent = "";
      for (const it of flatToc(nav.toc, 0, [])) {
        const b = document.createElement("button");
        b.textContent = it.label; b.style.paddingLeft = (6 + it.depth * 16) + "px";
        b.addEventListener("click", () => {
          closeSheets();
          rendition.display(it.href).catch((e) => showError("Aller au chapitre", e));
        });
        box.append(b);
      }
    }).catch((e) => showError("Table des matières", e));

    myBook.ready.then(async () => {
      if (book !== myBook) return;
      if (rec.locations) myBook.locations.load(rec.locations);
      else {
        await myBook.locations.generate(1500);
        if (book !== myBook) return;
        await patchBook(id, { locations: myBook.locations.save() });
      }
      if (book !== myBook) return;
      locReady = true;
      $("slider").disabled = false;
      if (cur && cur.cfi) {
        const p = myBook.locations.percentageFromCfi(cur.cfi);
        if (typeof p === "number" && !isNaN(p)) {
          cur.percent = p;
          $("pct").textContent = Math.round(p * 100) + " %";
          $("slider-val").textContent = Math.round(p * 100) + " %";
          $("slider").value = Math.round(p * 1000);
          scheduleSave({ percent: p });
        }
      }
    }).catch((e) => showError("Calcul de la progression", e));
  } catch (e) {
    busy(false);
    showError("Ouverture impossible", e);
    await teardown();
    $("reader").hidden = true; $("library").hidden = false;
    try { localStorage.removeItem("epub.lastOpen"); } catch (_) {}
  }
}

async function teardown() {
  await flushSave();
  try { if (rendition) rendition.destroy(); } catch (_) {}
  try { if (book) book.destroy(); } catch (_) {}
  rendition = null; book = null; cur = null; locReady = false;
  $("viewer").textContent = "";
}

async function closeReader() {
  if (!cur && !book) return;
  await teardown();
  closeSheets();
  $("reader").hidden = true; $("library").hidden = false;
  try { localStorage.removeItem("epub.lastOpen"); } catch (_) {}
  try { await renderLibrary(); } catch (e) { showError("Affichage bibliothèque", e); }
}
window.addEventListener("popstate", () => { closeReader(); });
$("back").addEventListener("click", () => {
  if (history.state && history.state.r) history.back(); else closeReader();
});

/* ============ Boutons du lecteur ============ */
$("btn-toc").addEventListener("click", () => openSheet("toc"));
$("btn-set").addEventListener("click", () => openSheet("settings"));
$("backdrop").addEventListener("click", closeSheets);

document.querySelectorAll("#seg-theme button").forEach((b) => b.addEventListener("click", () => {
  S.theme = b.dataset.v; saveSettings(); applyUiTheme(); applyReaderStyle();
}));
document.querySelectorAll("#seg-font button").forEach((b) => b.addEventListener("click", () => {
  S.font = b.dataset.v; saveSettings(); applyUiTheme(); applyReaderStyle();
}));
$("size-up").addEventListener("click", () => { S.size = Math.min(220, S.size + 10); saveSettings(); applyUiTheme(); applyReaderStyle(); });
$("size-down").addEventListener("click", () => { S.size = Math.max(70, S.size - 10); saveSettings(); applyUiTheme(); applyReaderStyle(); });

$("slider").addEventListener("input", (e) => {
  dragging = true; $("slider-val").textContent = Math.round(e.target.value / 10) + " %";
});
$("slider").addEventListener("change", (e) => {
  dragging = false;
  if (!locReady || !book) return;
  try {
    const cfi = book.locations.cfiFromPercentage(e.target.value / 1000);
    rendition.display(cfi).catch((err) => showError("Aller à la position", err));
  } catch (err) { showError("Aller à la position", err); }
});

/* ============ Démarrage ============ */
(async function start() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await renderLibrary();
    if (typeof ePub === "undefined") showError("Chargement", new Error("epub.js n'a pas pu être téléchargé. Connecte-toi une première fois."));
    const last = localStorage.getItem("epub.lastOpen");
    if (last && typeof ePub !== "undefined") await openBook(last); // reprise automatique
  } catch (e) { showError("Démarrage", e); }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => showError("Mode hors-ligne indisponible (service worker)", e));
}
