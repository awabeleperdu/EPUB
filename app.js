"use strict";
const VERSION = "6";

/* ============ Erreurs visibles à l'écran (jamais silencieuses) ============ */
const errBox = document.getElementById("err");
function showError(ctx, e) {
  const msg = String((e && (e.stack || e.message)) || e).slice(0, 900);
  errBox.textContent = "";
  const t = document.createElement("strong"); t.textContent = ctx + " (v" + VERSION + ")";
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
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT = null;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800);
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { showError("Lecture du stockage (" + k + ")", e); return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { showError("Écriture du stockage (" + k + ")", e); } };

const I = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dots: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  up: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>',
  logo: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

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
        d.createObjectStore("files");                     // le fichier lui-même
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
const putFile = (id, data) => tx("files", "readwrite", (s) => s.put(data, id));
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

/* ============ Réglages, catégories, statistiques ============ */
const ACCENTS = {
  violet:    { a: "#6A5BFF", b: "#9AA8FF", on: "#ffffff", n: "Violet électrique" },
  bleu:      { a: "#2563EB", b: "#8EC1FF", on: "#ffffff", n: "Bleu" },
  turquoise: { a: "#14B8A6", b: "#8FEDE1", on: "#04201C", n: "Turquoise" },
  rose:      { a: "#D6336C", b: "#FFA6C4", on: "#ffffff", n: "Rose" },
};
const THEMES = {
  dark:  { bg: "#0E0E13", fg: "#D9D9DE", link: "#8fb0ff", name: "Sombre" },
  sepia: { bg: "#F3E9D2", fg: "#4A3A28", link: "#a0522d", name: "Sépia" },
  light: { bg: "#FAFAF7", fg: "#1B1B1F", link: "#3b5bdb", name: "Clair" },
};
const FONTS = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const S = Object.assign({ ui: "dark", accent: "violet", theme: "dark", size: 100, font: "serif", manga: true, awake: false, smode: "vertical" }, lsGet("epub.settings", {}));
if (!THEMES[S.theme]) S.theme = "dark";
if (!THEMES[S.ui]) S.ui = "dark";
if (!FONTS[S.font]) S.font = "serif";
if (!ACCENTS[S.accent]) S.accent = "violet";
if (S.smode !== "pages") S.smode = "vertical";
S.size = Math.min(220, Math.max(70, Number(S.size) || 100));
const saveSettings = () => lsSet("epub.settings", S);

function applyUi() {
  document.body.dataset.ui = S.ui;
  const a = ACCENTS[S.accent], r = document.documentElement.style;
  r.setProperty("--acc", a.a); r.setProperty("--acc2", a.b); r.setProperty("--onacc", a.on);
  const bg = { dark: "#08080C", light: "#F6F6F2", sepia: "#F3E9D2" }[S.ui];
  document.querySelector('meta[name="theme-color"]').content = bg;
}
applyUi();

let CATS = lsGet("epub.cats", null);
if (!Array.isArray(CATS)) CATS = ["Fantasy", "Science-fiction", "Manga", "Essais"];
const saveCats = () => lsSet("epub.cats", CATS);

let ST = lsGet("epub.stats", null);
if (!ST || typeof ST !== "object") ST = {};
ST.days = ST.days && typeof ST.days === "object" ? ST.days : {};
ST.chars = Number(ST.chars) || 0;
ST.pages = Number(ST.pages) || 0;
const saveStats = () => lsSet("epub.stats", ST);
const dayKey = (d) => (d || new Date()).toLocaleDateString("sv-SE");
function addTime(sec) { const k = dayKey(); ST.days[k] = (ST.days[k] || 0) + sec; saveStats(); }
function calcStreak() {
  let n = 0; const d = new Date();
  if ((ST.days[dayKey(d)] || 0) < 60) d.setDate(d.getDate() - 1); // la journée n'est pas encore perdue
  while ((ST.days[dayKey(d)] || 0) >= 60) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const totalSeconds = () => Object.values(ST.days).reduce((a, b) => a + b, 0);
const fmtN = (n) => Math.round(n).toLocaleString("fr-FR");
function fmtChars(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " M";
  if (n >= 1e3) return Math.round(n / 1e3) + " k";
  return String(Math.round(n));
}
function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "");
}
function fmtBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(".", ",") + " Go";
  if (n >= 1e6) return Math.round(n / 1e6) + " Mo";
  return Math.round(n / 1e3) + " Ko";
}

/* ============ Bibliothèque : données ============ */
let LIB = [];
const STL = { toread: "À lire", reading: "En cours", done: "Terminé" };
function statusOf(b) { return b.status || (b.percent >= 0.98 ? "done" : b.percent > 0 ? "reading" : "toread"); }
const kindOf = (b) => b.kind || "epub";
const isWish = (b) => kindOf(b) === "wish";
const kindLabel = (b) => (kindOf(b) === "cbz" ? "Scans" : kindOf(b) === "wish" ? "Sans fichier" : "Epub");
async function loadLib() { LIB = await allBooks(); }

let coverUrls = [];
function cv(b) {
  if (!b.cover) return null;
  const u = URL.createObjectURL(b.cover); coverUrls.push(u); return u;
}
function grad(title) {
  let h = 0;
  for (const c of String(title)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return "linear-gradient(160deg,hsl(" + h + ",45%,36%),hsl(" + ((h + 40) % 360) + ",50%,16%))";
}
function coverBox(b, cls, extra) {
  const u = cv(b);
  return '<div class="' + cls + '" style="' + (u ? "" : "background:" + grad(b.title)) + '">' +
    (u ? '<img src="' + u + '" alt="">' : '<span class="ct">' + esc(b.title) + "</span>") + (extra || "") + "</div>";
}

/* ============ Rendu des onglets ============ */
let TAB = "home";
let TL = { cat: "", st: "toread" };
function renderAll() {
  coverUrls.forEach((u) => URL.revokeObjectURL(u)); coverUrls = [];
  renderHome(); renderToRead(); renderStats(); renderSettings();
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === TAB));
}
function showTab(t) {
  TAB = t;
  ["home", "toread", "stats", "settings"].forEach((v) => { $("v-" + v).hidden = v !== t; });
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === t));
  window.scrollTo(0, 0);
}

function bookCard(b) {
  const pct = Math.round((b.percent || 0) * 100);
  const done = statusOf(b) === "done";
  const extra = done ? '<span class="ok">' + I.check + "</span>" : pct > 0 ? '<div class="cp"><i style="width:' + pct + '%"></i></div>' : "";
  return '<div class="bk" role="button" tabindex="0" data-act="open" data-id="' + esc(b.id) + '">' +
    coverBox(b, "cover", extra) +
    '<button class="more" data-act="menu" data-id="' + esc(b.id) + '" aria-label="Options"><i>' + I.dots + "</i></button>" +
    '<div class="t">' + esc(b.title) + '</div><div class="a">' + esc(b.author || kindLabel(b)) + "</div></div>";
}

function renderHome() {
  const el = $("v-home");
  const files = LIB.filter((b) => !isWish(b));
  if (!files.length) {
    el.innerHTML =
      '<div class="hdr"><div class="logo"><i>' + I.logo + "</i>Lecture</div></div>" +
      '<div class="empty"><div class="stack"><div class="g g1"></div><div class="g g2"></div><div class="f"><b>' + I.plus.replace('width="16" height="16"', 'width="26" height="26"') + "</b>.epub · .cbz</div></div>" +
      "<h1 class=\"serif\">Ta bibliothèque t'attend</h1>" +
      "<p>Ajoute un epub ou des scans depuis ton téléphone. Le fichier est copié dans l'appli : tu reprends toujours exactement où tu t'es arrêté.</p>" +
      '<button class="btn-primary" data-act="add" data-v="epub">' + I.up + " Choisir un epub</button>" +
      '<button class="btn-ghost" data-act="add" data-v="cbz">Ajouter des scans (.cbz)</button></div>';
    return;
  }
  const active = files.filter((b) => statusOf(b) !== "done").sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0) || b.addedAt - a.addedAt);
  const dones = files.filter((b) => statusOf(b) === "done").sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
  const hero = active[0] || dones[0];
  const hu = cv(hero);
  const pct = Math.round((hero.percent || 0) * 100);
  const sub = [hero.author, kindOf(hero) === "cbz" ? (hero.pages || "?") + " pages" : ""].filter(Boolean).join(" · ");
  let h =
    '<div class="hero"><div class="hero-bg" style="' + (hu ? "background-image:url(" + hu + ")" : "background:" + grad(hero.title)) + '"></div><div class="hero-fade"></div>' +
    '<div class="hero-in"><div class="hdr" style="text-align:left"><div class="logo"><i>' + I.logo + "</i>Lecture</div>" +
    '<button class="pill" data-act="addmenu">' + I.plus + " Ajouter</button></div>" +
    coverBox(hero, "cover hero-cover") +
    '<div class="eyebrow">' + (pct > 0 && statusOf(hero) !== "done" ? "CONTINUER LA LECTURE" : statusOf(hero) === "done" ? "À RELIRE" : "À COMMENCER") + "</div>" +
    '<h1 class="hero-t serif">' + esc(hero.title) + "</h1>" +
    (sub ? '<div class="hero-a">' + esc(sub) + "</div>" : "") +
    '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
    '<button class="btn-primary" data-act="open" data-id="' + esc(hero.id) + '">' + I.play + (pct > 0 && pct < 98 ? "Reprendre · " + pct + " %" : pct >= 98 ? "Relire" : "Commencer") + "</button></div></div>";
  h += '<div class="rowh"><h2>Mes livres</h2><span>' + active.length + "</span></div><div class=\"row\">" + (active.length ? active.map(bookCard).join("") : '<div class="none" style="padding:20px 0">Tout est terminé 🎉</div>') + "</div>";
  if (dones.length) h += '<div class="rowh"><h2>Terminés</h2><span>' + dones.length + " livre" + (dones.length > 1 ? "s" : "") + '</span></div><div class="row">' + dones.map(bookCard).join("") + "</div>";
  el.innerHTML = h;
}

function renderToRead() {
  const el = $("v-toread");
  const cats = [""].concat(CATS);
  const inCat = LIB.filter((b) => !TL.cat || b.category === TL.cat);
  const cnt = (s) => inCat.filter((b) => statusOf(b) === s).length;
  const list = inCat.filter((b) => statusOf(b) === TL.st).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0) || b.addedAt - a.addedAt);
  let h = '<div class="hdr"><h1 class="h1">À lire</h1><button class="pill" data-act="addwish">' + I.plus + " Livre</button></div>" +
    '<div class="chips" style="margin-top:12px">' +
    cats.map((c) => '<button class="chip' + (TL.cat === c ? " on" : "") + '" data-act="fcat" data-v="' + esc(c) + '">' + (c ? esc(c) : "Tous") + "</button>").join("") +
    '<button class="chip add" data-act="addcat">' + I.plus + " Catégorie</button></div>" +
    '<div class="pad" style="margin-top:14px"><div class="seg soft">' +
    ["toread", "reading", "done"].map((s) => '<button class="' + (TL.st === s ? "on" : "") + '" data-act="fst" data-v="' + s + '">' + STL[s] + " · " + cnt(s) + "</button>").join("") + "</div></div>" +
    '<div class="list" style="margin-top:16px">';
  if (!list.length) h += '<div class="none">Rien ici pour l\'instant.<br>Ajoute un livre avec le bouton « Livre » : tu peux le noter sans avoir le fichier.</div>';
  for (const b of list) {
    const pct = Math.round((b.percent || 0) * 100);
    h += '<div class="it" role="button" tabindex="0" data-act="menu" data-id="' + esc(b.id) + '">' +
      '<div class="th" style="' + (b.cover ? "" : "background:" + grad(b.title)) + '">' + (b.cover ? '<img src="' + cv(b) + '" alt="">' : "") + "</div>" +
      '<div class="bd"><div class="tt">' + esc(b.title) + '</div><div class="au">' + esc(b.author || kindLabel(b)) + "</div>" +
      '<div class="tags">' + (b.category ? '<span class="tag a">' + esc(b.category) + "</span>" : "") +
      '<span class="tag">' + kindLabel(b) + "</span>" + (pct > 0 && statusOf(b) === "reading" ? '<span class="tag">' + pct + " %</span>" : "") + "</div></div>" +
      (isWish(b) ? "" : '<button class="round" data-act="open" data-id="' + esc(b.id) + '" aria-label="Lire">' + I.play + "</button>") + "</div>";
  }
  el.innerHTML = h + "</div>";
}

const BADGE_BG = ["linear-gradient(135deg,#1F6B4D,#0E2E22)", "linear-gradient(135deg,#2B4FB0,#121E4A)", "linear-gradient(135deg,#8A3A5C,#2E1020)", "linear-gradient(135deg,#7A5A1E,#2A1E08)", "linear-gradient(135deg,#5B3FA8,#1C1240)"];
function badges() {
  const done = LIB.filter((b) => statusOf(b) === "done").length, streak = calcStreak();
  const L = [
    { t: "Premier livre", d: "Terminer un livre", v: done, g: 1, f: (v) => v + " / 1" },
    { t: "Lecteur assidu", d: "7 jours de lecture d'affilée", v: streak, g: 7, f: (v) => v + " / 7" },
    { t: "Marathon", d: "1 million de caractères lus", v: ST.chars, g: 1e6, f: (v) => fmtChars(v) + " / 1 M" },
    { t: "Lecteur de scans", d: "2 000 pages de scans lues", v: ST.pages, g: 2000, f: (v) => fmtN(v) + " / 2 000" },
    { t: "Bibliothécaire", d: "Terminer 25 livres", v: done, g: 25, f: (v) => v + " / 25" },
  ].map((b, i) => Object.assign(b, { ok: b.v >= b.g, p: Math.min(1, b.v / b.g), bg: BADGE_BG[i] }));
  return L.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || b.p - a.p);
}
let walletOpen = false;
function renderStats() {
  const done = LIB.filter((b) => statusOf(b) === "done").length;
  const wk = []; const d = new Date(); d.setDate(d.getDate() - 6);
  for (let i = 0; i < 7; i++) { wk.push((ST.days[dayKey(d)] || 0) >= 60); d.setDate(d.getDate() + 1); }
  const B = badges(), nOk = B.filter((b) => b.ok).length, s = calcStreak();
  $("v-stats").innerHTML =
    '<div class="hdr"><h1 class="h1">Accomplissements</h1></div>' +
    '<div class="streak" style="margin-top:14px"><small>SÉRIE EN COURS</small><div class="n"><b>' + s + "</b><span>jour" + (s > 1 ? "s" : "") + ' de lecture</span></div><div class="wk">' + wk.map((o) => "<i" + (o ? ' class="on"' : "") + "></i>").join("") + "</div></div>" +
    '<div class="tiles"><div class="tile"><b>' + done + "</b><span>Livres lus</span></div>" +
    '<div class="tile"><b>' + fmtChars(ST.chars) + "</b><span>Caractères lus</span></div>" +
    '<div class="tile"><b>' + fmtN(ST.pages) + "</b><span>Pages de scans lues</span></div>" +
    '<div class="tile"><b>' + fmtTime(totalSeconds()) + "</b><span>Temps de lecture</span></div></div>" +
    '<div class="rowh"><h2>Badges</h2><span>' + nOk + " sur " + B.length + " débloqués</span></div>" +
    '<div class="wallet' + (walletOpen ? " open" : "") + '" data-act="wallet">' +
    B.map((b) => '<div class="wc' + (b.ok ? "" : " lock") + '" style="background:' + b.bg + '"><div class="r">' + esc(b.t) + "<span>" + (b.ok ? "Débloqué ✓" : b.f(b.v)) + "</span></div><p>" + esc(b.d) + '</p><div class="pbar"><i style="width:' + Math.round(b.p * 100) + '%"></i></div></div>').join("") + "</div>" +
    '<div class="none" style="padding-top:18px;font-size:12px">Touche les badges pour les déplier.</div>';
}

function renderSettings() {
  const tg = (k, label) => '<div class="rw"><span>' + label + '</span><button class="tgl' + (S[k] ? " on" : "") + '" role="switch" aria-checked="' + !!S[k] + '" aria-label="' + esc(label) + '" data-act="tgl" data-k="' + k + '"></button></div>';
  $("v-settings").innerHTML =
    '<div class="hdr"><h1 class="h1">Réglages</h1></div>' +
    '<div class="lbl pad">Installation</div><div class="grp" id="inst"><span class="sub">Vérification…</span></div>' +
    '<div class="lbl pad">Apparence</div><div class="grp"><div class="seg">' +
    Object.keys(THEMES).map((k) => '<button class="' + (S.ui === k ? "on" : "") + '" data-act="ui" data-v="' + k + '">' + THEMES[k].name + "</button>").join("") + "</div>" +
    '<div class="rw" style="padding:14px 0 0;min-height:0"><span>Couleur d\'accent</span><div class="sw">' +
    Object.keys(ACCENTS).map((k) => '<button class="' + (S.accent === k ? "on" : "") + '" style="color:' + ACCENTS[k].a + '" data-act="accent" data-v="' + k + '" aria-label="' + ACCENTS[k].n + '"><i style="background:' + ACCENTS[k].a + '"></i></button>').join("") + "</div></div></div>" +
    '<div class="lbl pad">Lecture</div><div class="grp rows">' + tg("manga", "Sens manga par défaut") + tg("awake", "Écran toujours allumé") + "</div>" +
    '<div class="lbl pad">Catégories</div><div class="grp"><div class="chips wrap">' +
    (CATS.length ? CATS.map((c) => '<span class="chip">' + esc(c) + ' <button class="cx" data-act="delcat" data-v="' + esc(c) + '" aria-label="Supprimer ' + esc(c) + '">' + I.x + "</button></span>").join("") : '<span style="color:var(--mute);font-size:14px">Aucune catégorie</span>') +
    '<button class="chip add" data-act="addcat">' + I.plus + " Ajouter</button></div></div>" +
    '<div class="lbl pad">Stockage</div><div class="grp sto" id="sto"><span class="sub">Calcul…</span></div>' +
    '<div class="lbl pad">Sauvegarde</div><div class="two"><button class="btn-ghost" data-act="export">' + I.down + ' Exporter</button><button class="btn-ghost" data-act="importjson">' + I.up + ' Importer</button></div>' +
    '<div class="none" style="padding:12px 32px 0;font-size:12px">La sauvegarde contient ta liste, ta progression, tes stats et tes réglages. Les fichiers des livres ne sont pas inclus : garde-les de ton côté.</div>' +
    '<div class="ver">Lecture v' + VERSION + "</div>";
  fillStorage(); fillInstall();
}

/* ============ Installation de l'appli (PWA) ============ */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; fillInstall(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; toast("Appli installée ✓"); fillInstall(); });
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
// Liste les fichiers réellement présents à la racine du repo GitHub (API publique) pour comprendre un 404
async function repoListing(owner, repo) {
  owner = owner || location.hostname.split(".")[0]; repo = repo || location.pathname.split("/")[1];
  if (!repo) throw new Error("adresse sans nom de repo");
  const r = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/", { cache: "no-store" });
  if (!r.ok) throw new Error("GitHub HTTP " + r.status);
  return (await r.json()).map((f) => f.name + (f.type === "dir" ? "/" : ""));
}
function listingHint(names) {
  const need = ["index.html", "style.css", "app.js", "sw.js", "manifest.json", "icon-192.png", "icon-512.png"];
  const missing = need.filter((n) => !names.includes(n));
  const imgs = names.filter((n) => /\.(png|jpe?g|webp|ico)$/i.test(n)), dirs = names.filter((n) => n.endsWith("/"));
  return (missing.length ? "Absents à la racine du repo : " + missing.join(", ") + ". " : "Tous les fichiers sont à la racine. ") +
    (imgs.length ? "Images présentes : " + imgs.join(", ") + ". " : "Aucune image à la racine. ") + (dirs.length ? "Dossiers : " + dirs.join(", ") + "." : "");
}
async function fillInstall() {
  const el = $("inst"); if (!el) return;
  const row = (ok, t, d) => '<div class="chk"><b class="' + (ok === true ? "y" : ok === false ? "n" : "u") + '">' + (ok === true ? "✓" : ok === false ? "✕" : "•") + "</b><span>" + esc(t) + (d ? "<small>" + esc(d) + "</small>" : "") + "</span></div>";
  if (isStandalone()) { el.innerHTML = row(true, "Tu utilises l'appli installée"); return; }
  const rows = [];
  rows.push(row(window.isSecureContext, "Connexion sécurisée (https)", window.isSecureContext ? "" : "Adresse : " + location.origin));
  try {
    const link = document.querySelector('link[rel="manifest"]');
    const r = await fetch(link.href, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status + " sur " + link.getAttribute("href") + " : le fichier manifest.json est absent ou mal nommé");
    const m = await r.json(), srcs = [...new Set((m.icons || []).map((ic) => ic.src))], bad = [];
    for (const s of srcs) { const u = new URL(s, link.href); const ri = await fetch(u, { cache: "no-store" }); if (!ri.ok) bad.push(u.href + " (HTTP " + ri.status + ")"); }
    let more = "";
    if (bad.length) { try { more = listingHint(await repoListing()); } catch (e) { more = "(liste du repo indisponible : " + (e.message || e) + ")"; } }
    rows.push(row(!bad.length && srcs.length >= 2, "Manifest et icônes", bad.length ? "Introuvable à : " + bad.join(" ; ") + (more ? " — " + more : "") : srcs.length + " icônes trouvées"));
  } catch (e) { rows.push(row(false, "Manifest", e.message || String(e))); }
  try {
    if (!("serviceWorker" in navigator)) throw new Error("Ce navigateur ne gère pas le mode hors-ligne");
    const reg = await navigator.serviceWorker.getRegistration();
    const busyInstall = !!(reg && !reg.active && (reg.installing || reg.waiting));
    rows.push(row(reg && reg.active ? true : busyInstall ? null : false, "Mode hors-ligne (service worker)", reg ? (reg.active ? "actif" : busyInstall ? "en cours d'installation : rouvre cette page dans un instant" : "pas actif") : "non enregistré : vérifie que sw.js est à la racine du repo, avec ce nom exact"));
  } catch (e) { rows.push(row(false, "Mode hors-ligne", e.message || String(e))); }
  rows.push(row(deferredInstall ? true : null, deferredInstall ? "Chrome propose l'installation" : "Chrome ne propose pas (encore) l'installation"));
  const ua = navigator.userAgent;
  let hint = "";
  if (/iPhone|iPad/.test(ua)) hint = "Sur iPhone : Partager → « Sur l'écran d'accueil ». iOS n'a pas d'installation d'appli web plus poussée.";
  else if (/SamsungBrowser|Firefox|FxiOS|EdgA|OPR\//.test(ua)) hint = "Ce navigateur n'est pas Chrome : ouvre l'adresse dans Chrome pour pouvoir installer l'appli.";
  else if (!deferredInstall) hint = "Si tu as déjà ajouté un raccourci avant, supprime-le puis ferme et rouvre cette page. Ensuite menu ⋮ de Chrome → « Installer l'application ». S'il y a un ✕ ci-dessus, c'est la cause.";
  el.innerHTML = rows.join("") + (deferredInstall ? '<button class="btn-primary" data-act="install" style="margin-top:12px">' + I.down.replace('width="18" height="18"', 'width="20" height="20"') + " Installer l'application</button>" : "") + (hint ? '<div class="sub" style="margin-top:10px;line-height:18px;font-size:12px">' + esc(hint) + "</div>" : "");
}
async function fillStorage() {
  const el = $("sto"); if (!el) return;
  const sz = { epub: 0, cbz: 0 }, n = { epub: 0, cbz: 0 };
  LIB.forEach((b) => { const k = kindOf(b); if (k !== "wish") { sz[k] += b.size || 0; n[k]++; } });
  let used = sz.epub + sz.cbz, quota = 0;
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); used = e.usage || used; quota = e.quota || 0; } }
  catch (e) { toast("Estimation du stockage impossible : " + (e.message || e)); }
  const base = Math.max(quota, used, 1);
  el.innerHTML = '<div style="display:flex;align-items:baseline;justify-content:space-between"><b>' + fmtBytes(used) + '</b><span class="sub">' + (quota ? "sur " + fmtBytes(quota) + " disponibles" : "sur l'appareil") + "</span></div>" +
    '<div class="sbar"><i style="width:' + (sz.epub / base * 100) + '%;background:var(--acc)"></i><i style="width:' + (sz.cbz / base * 100) + '%;background:var(--acc2)"></i></div>' +
    '<div class="legend"><span>' + n.epub + " epub" + (n.epub > 1 ? "s" : "") + " · " + fmtBytes(sz.epub) + "</span><span>" + n.cbz + " scan" + (n.cbz > 1 ? "s" : "") + " · " + fmtBytes(sz.cbz) + "</span></div>";
}

/* ============ Feuilles (bottom sheets) ============ */
function openSheet(html, cls) {
  const s = $("sheet"); s.className = "sheet " + (cls || ""); s.innerHTML = html;
  $("backdrop").hidden = false; s.hidden = false; s.scrollTop = 0;
}
let SB = null; // livre dont la feuille d'options est ouverte
function closeSheet() { SB = null; $("backdrop").hidden = true; $("sheet").hidden = true; $("sheet").innerHTML = ""; }
const shHead = (t, s) => '<div class="grab"></div><div class="sh-head"><div><div class="sh-t">' + esc(t) + "</div>" + (s ? '<div class="sh-s">' + esc(s) + "</div>" : "") + '</div><button class="x" data-act="close" aria-label="Fermer">' + I.close + "</button></div>";
const catChips = (cur, act, id) => '<div class="chips wrap">' + [""].concat(CATS).map((c) => '<button class="chip' + (cur === c ? " on" : "") + '" data-act="' + act + '" data-id="' + esc(id || "") + '" data-v="' + esc(c) + '">' + (c ? esc(c) : "Aucune") + "</button>").join("") + '<button class="chip add" data-act="addcat">' + I.plus + " Nouvelle</button></div>";

function sheetBook(id) {
  const b = LIB.find((x) => x.id === id); if (!b) return;
  const st = statusOf(b);
  const keepSB = id;
  openSheet(shHead(b.title, b.author || kindLabel(b)) +
    '<div class="lbl">Statut</div><div class="seg">' + ["toread", "reading", "done"].map((s) => '<button class="' + (st === s ? "on" : "") + '" data-act="setstatus" data-id="' + esc(id) + '" data-v="' + s + '">' + STL[s] + "</button>").join("") + "</div>" +
    '<div class="lbl">Catégorie</div>' + catChips(b.category || "", "setcat", id) +
    (isWish(b) ? '<button class="btn-primary" data-act="attach" data-id="' + esc(id) + '">' + I.up + " Attacher le fichier</button>" : '<button class="btn-primary" data-act="open" data-id="' + esc(id) + '">' + I.play + " Lire</button>") +
    '<button class="btn-ghost danger" data-act="del" data-id="' + esc(id) + '">Supprimer</button>');
  SB = keepSB;
}
let WD = { cat: "" };
function sheetAddWish(keep) {
  const t = keep ? ($("w-title") || {}).value || "" : "", a = keep ? ($("w-author") || {}).value || "" : "";
  openSheet(shHead("Ajouter à ma liste", "Sans fichier : tu pourras l'attacher plus tard") +
    '<input id="w-title" class="fld" placeholder="Titre" maxlength="120" value="' + esc(t) + '"><input id="w-author" class="fld" placeholder="Auteur (facultatif)" maxlength="80" value="' + esc(a) + '">' +
    '<div class="lbl">Catégorie</div>' + catChips(WD.cat, "wcat") +
    '<button class="btn-primary" data-act="savewish">Ajouter à ma liste</button>');
}
function sheetAdd() {
  openSheet(shHead("Ajouter") +
    '<button class="btn-primary" data-act="add" data-v="epub">' + I.up + " Un epub</button>" +
    '<button class="btn-ghost" data-act="add" data-v="cbz">Des scans (.cbz)</button>' +
    '<button class="btn-ghost" data-act="addwish">À ma liste « À lire » (sans fichier)</button>');
}

/* ============ Import ============ */
let ADD = { attach: null };
let busyDepth = 0;
function busyUI(show, name, i, n, frac) {
  $("busy").hidden = !show; if (!show) return;
  const p = Math.round(((i - 1 + (frac || 0)) / n) * 100);
  $("busy-n").textContent = name; $("busy-c").textContent = "Livre " + i + " sur " + n; $("busy-p").textContent = p + " %"; $("busy-bar").style.width = p + "%";
}
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp" };
const extOf = (n) => (String(n).split(".").pop() || "").toLowerCase();
const mimeOf = (n) => MIME[extOf(n)] || "image/jpeg";
async function thumb(blob, w) {
  try {
    const bmp = await createImageBitmap(blob);
    const r = Math.min(1, w / bmp.width), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * r)); c.height = Math.max(1, Math.round(bmp.height * r));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return await new Promise((res) => c.toBlob((b) => res(b || blob), "image/jpeg", 0.82));
  } catch (e) { toast("Miniature non réduite (non bloquant) : " + (e.message || e)); return blob; }
}
function zipImages(zip) {
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
async function importFile(f, stage) {
  const ext = extOf(f.name);
  if (ext === "cbr" || ext === "rar") throw new Error("Les .cbr (rar) ne sont pas lus. Convertis-le en .cbz (zip d'images) puis réajoute-le.");
  if (ext === "epub") {
    if (typeof ePub === "undefined") throw new Error("epub.js non chargé (connexion nécessaire au premier lancement)");
    const id = f.name + "|" + f.size; // même format d'id qu'avant : les anciens livres restent valides
    if (await getBook(id)) { toast("Déjà dans la bibliothèque : " + f.name); return id; }
    stage(0.15);
    const buf = await f.arrayBuffer();
    const book = ePub(buf.slice(0));
    let meta, cover = null;
    try {
      meta = await book.loaded.metadata;
      try { const u = await book.coverUrl(); if (u) cover = await thumb(await (await fetch(u)).blob(), 420); }
      catch (e) { toast("Couverture introuvable (non bloquant) : " + (e.message || e)); }
    } finally { try { book.destroy(); } catch (_) {} }
    stage(0.7);
    await putFile(id, buf);
    await putBook({ id, kind: "epub", title: (meta && meta.title) || f.name.replace(/\.epub$/i, ""), author: (meta && meta.creator) || "", cover, size: f.size, addedAt: Date.now(), lastRead: 0, cfi: null, percent: 0, maxPercent: 0, locations: null, chars: 0, category: "" });
    return id;
  }
  if (ext === "cbz" || ext === "zip") {
    if (typeof JSZip === "undefined") throw new Error("JSZip non chargé (connexion nécessaire au premier lancement)");
    const id = "cbz|" + f.name + "|" + f.size;
    if (await getBook(id)) { toast("Déjà dans la bibliothèque : " + f.name); return id; }
    stage(0.1);
    const zip = await JSZip.loadAsync(f);
    const names = zipImages(zip);
    if (!names.length) throw new Error("Aucune image trouvée dans " + f.name + ". Un .cbz doit contenir des images (jpg, png, webp).");
    stage(0.5);
    const first = await zip.file(names[0]).async("blob");
    const cover = await thumb(new Blob([first], { type: mimeOf(names[0]) }), 420);
    stage(0.8);
    await putFile(id, f.slice(0, f.size, f.type));
    await putBook({ id, kind: "cbz", title: f.name.replace(/\.(cbz|zip)$/i, ""), author: "", cover, size: f.size, pages: names.length, addedAt: Date.now(), lastRead: 0, page: 0, maxPage: 0, percent: 0, category: "" });
    return id;
  }
  throw new Error("Format non pris en charge : ." + ext + " (epub, cbz)");
}
$("file").addEventListener("change", async (ev) => {
  const files = [...ev.target.files]; ev.target.value = "";
  const attach = ADD.attach; ADD.attach = null;
  if (!files.length) return;
  closeSheet();
  let lastId = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    busyUI(true, f.name, i + 1, files.length, 0.02);
    try {
      lastId = await importFile(f, (fr) => busyUI(true, f.name, i + 1, files.length, fr));
      if (attach && lastId) {
        const w = await getBook(attach);
        if (w) { await patchBook(lastId, { category: w.category || "", status: w.status === "done" ? "done" : null }); if (attach !== lastId) await delBook(attach); }
      }
    } catch (e) { showError("Import impossible : " + f.name, e); }
  }
  busyUI(false);
  try { await loadLib(); renderAll(); } catch (e) { showError("Affichage bibliothèque", e); }
  if (files.length === 1 && lastId && errBox.hidden) await openBook(lastId); // un seul livre ajouté : on l'ouvre
});

/* ============ Lecteurs : état commun ============ */
let viewer = null; // "epub" | "scan" | null
let cur = null, saveT = null, pendingSave = null, wakeLock = null;
function flushSave() {
  clearTimeout(saveT); saveT = null;
  if (!pendingSave || !cur) { pendingSave = null; return Promise.resolve(); }
  const p = pendingSave, id = cur.id; pendingSave = null;
  return patchBook(id, p).catch((e) => showError("Sauvegarde de la progression", e));
}
function scheduleSave(p) { pendingSave = Object.assign(pendingSave || {}, p); clearTimeout(saveT); saveT = setTimeout(flushSave, 500); }
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); else if (viewer && S.awake) acquireWake(); });
window.addEventListener("pagehide", flushSave);
setInterval(() => { if (viewer && !document.hidden) addTime(5); }, 5000);

async function acquireWake() {
  try { if (S.awake && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); }
  catch (e) { toast("Écran toujours allumé indisponible : " + (e.message || e)); }
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (_) {} wakeLock = null; }

function setUi(show, root) { (root || $(viewer === "scan" ? "scan" : "reader")).classList.toggle("ui", show); }
const uiShown = () => $(viewer === "scan" ? "scan" : "reader").classList.contains("ui");

async function openBook(id) {
  closeSheet();
  const rec = LIB.find((b) => b.id === id) || (await getBook(id));
  if (!rec || isWish(rec)) { toast("Ce livre n'a pas de fichier : attache-le d'abord."); return; }
  if (kindOf(rec) === "cbz") return openScan(id); // eslint-disable-line
  return openEpub(id);
}

async function closeViewer() {
  if (!viewer) return;
  await teardown();
  viewer = null; releaseWake();
  $("reader").hidden = true; $("scan").hidden = true; document.body.classList.remove("hidenav");
  lsSet("epub.last", null);
  try { await loadLib(); renderAll(); } catch (e) { showError("Affichage bibliothèque", e); }
}
async function teardown() {
  await flushSave();
  try { if (rendition) rendition.destroy(); } catch (_) {}
  try { if (book) book.destroy(); } catch (_) {}
  rendition = null; book = null; locReady = false; tocFlat = [];
  $("viewer").textContent = "";
  if (sc) { try { sc.io && sc.io.disconnect(); } catch (_) {} Object.values(sc.urls).forEach((u) => URL.revokeObjectURL(u)); sc = null; }
  $("strip").textContent = ""; $("single").removeAttribute("src");
  cur = null;
}
window.addEventListener("popstate", () => { if (!$("sheet").hidden) closeSheet(); if (viewer) closeViewer(); });
function pushView() { try { history.pushState({ r: 1 }, ""); } catch (_) {} }
function backFromViewer() { if (history.state && history.state.r) history.back(); else closeViewer(); }

/* ============ Lecteur epub ============ */
let book = null, rendition = null, locReady = false, tocFlat = [], dragging = false, swipeUntil = 0;
const RT = (t) => "rt-" + t;

function applyReaderStyle() {
  $("reader").className = RT(S.theme) + ($("reader").classList.contains("ui") ? " ui" : "");
  $("reader").style.background = THEMES[S.theme].bg; // même fond que la page du livre, sans cadre visible
  if (!rendition) return;
  rendition.themes.select(S.theme);
  rendition.themes.fontSize(S.size + "%");
  rendition.themes.font(FONTS[S.font]);
}
function curTocIndex() {
  if (!cur || cur.sidx == null) return -1;
  let r = -1;
  tocFlat.forEach((t, i) => { if (t.sidx >= 0 && t.sidx <= cur.sidx) r = i; });
  return r;
}
function remainText() {
  if (!cur || !cur.chars || !locReady) return "";
  const m = Math.round((1 - (cur.percent || 0)) * cur.chars / 1500);
  if (m < 1) return "Presque terminé";
  return "≈ " + (m >= 60 ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") : m + " min") + " de lecture restantes";
}
function updateReaderUI() {
  if (!cur) return;
  const p = Math.round((cur.percent || 0) * 100);
  $("pct").textContent = p + " %"; $("slider-val").textContent = p + " %";
  if (!dragging) $("slider").value = Math.round((cur.percent || 0) * 1000);
  const i = curTocIndex();
  $("chap").textContent = i >= 0 ? tocFlat[i].label : "";
  $("remain").textContent = remainText();
}
function onRelocated(loc) {
  if (!cur || !loc || !loc.start) return;
  cur.sidx = loc.start.index;
  const cfi = loc.start.cfi;
  let pct = cur.percent || 0;
  if (locReady && book.locations.length()) {
    const p = book.locations.percentageFromCfi(cfi);
    if (typeof p === "number" && !isNaN(p)) pct = p;
  }
  if (locReady && cur.chars) { // caractères lus : seulement la progression au-delà du point le plus loin atteint
    const mp = cur.maxPercent || 0;
    if (pct > mp) { const d = pct - mp; if (d < 0.05) { ST.chars += Math.round(d * cur.chars); saveStats(); } cur.maxPercent = pct; }
  }
  cur.percent = pct; cur.cfi = cfi;
  updateReaderUI();
  scheduleSave({ cfi, percent: pct, maxPercent: cur.maxPercent || 0, lastRead: Date.now(), status: pct >= 0.98 ? "done" : "reading" });
}
const nextP = () => { setUi(false); if (rendition) rendition.next().catch((e) => showError("Page suivante", e)); };
const prevP = () => { setUi(false); if (rendition) rendition.prev().catch((e) => showError("Page précédente", e)); };
function onTap(e) {
  if (Date.now() < swipeUntil) return;
  if (e.target && e.target.closest && e.target.closest("a")) return;
  try { if (e.view && e.view.getSelection && e.view.getSelection().toString()) return; } catch (_) {}
  const fr = e.view && e.view.frameElement;
  const off = fr ? fr.getBoundingClientRect().left : 0;
  tapAt((e.clientX + off) / window.innerWidth);
}
function tapAt(x) { if (x < 0.28) prevP(); else if (x > 0.72) nextP(); else setUi(!uiShown()); }
// Les marges autour du texte (hors iframe) comptent aussi comme zones de tap
$("reader").addEventListener("click", (e) => {
  if (viewer === "epub" && (e.target.id === "reader" || e.target.id === "viewer")) tapAt(e.clientX / window.innerWidth);
});
let tStart = null;
function onTouchStart(e) { const t = e.changedTouches[0]; tStart = { x: t.screenX, y: t.screenY }; }
function onTouchEnd(e) {
  if (!tStart) return;
  const t = e.changedTouches[0], dx = t.screenX - tStart.x, dy = t.screenY - tStart.y; tStart = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipeUntil = Date.now() + 450; if (dx < 0) nextP(); else prevP(); }
}
document.addEventListener("keydown", (e) => {
  if (viewer === "epub" && rendition) {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") nextP(); else if (e.key === "ArrowLeft" || e.key === "PageUp") prevP();
  } else if (viewer === "scan" && sc && sc.mode === "pages") {
    if (e.key === "ArrowRight") scGo(sc.idx + (S.manga ? -1 : 1)); else if (e.key === "ArrowLeft") scGo(sc.idx + (S.manga ? 1 : -1));
  }
});
function flatToc(items, depth, out) {
  for (const it of items) {
    out.push({ label: (it.label || "").trim() || "(sans titre)", href: it.href, depth });
    if (it.subitems && it.subitems.length) flatToc(it.subitems, depth + 1, out);
  }
  return out;
}
async function countChars(myBook, id) {
  let total = 0, fails = 0;
  for (const it of myBook.spine.spineItems) {
    if (book !== myBook) return;
    try { const el = await it.load(myBook.load.bind(myBook)); total += (el.textContent || "").length; it.unload(); }
    catch (e) { fails++; }
  }
  if (book !== myBook) return;
  if (total > 0) { cur.chars = total; await patchBook(id, { chars: total }); updateReaderUI(); }
  else toast("Impossible de compter les caractères de ce livre (stats de caractères indisponibles)");
  if (fails) toast(fails + " section(s) du livre illisible(s) pour le comptage des caractères");
}

async function openEpub(id) {
  busyUI(true, "Ouverture…", 1, 1, 0.3);
  try {
    if (typeof ePub === "undefined") throw new Error("epub.js non chargé (connexion nécessaire au premier lancement)");
    const rec = await getBook(id);
    if (!rec) throw new Error("Livre introuvable dans la base");
    const data = await getFile(id);
    if (!data) throw new Error("Fichier introuvable (le navigateur a vidé le stockage ?). Réimporte l'epub.");
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;

    await teardown();
    cur = rec; locReady = false; viewer = "epub";
    cur.maxPercent = cur.maxPercent == null ? (cur.percent || 0) : cur.maxPercent;
    $("title").textContent = rec.title;
    $("slider").disabled = true;
    $("reader").hidden = false; $("scan").hidden = true; document.body.classList.add("hidenav");
    $("reader").className = RT(S.theme);
    updateReaderUI(); pushView(); lsSet("epub.last", id); acquireWake();

    const myBook = ePub(buf);
    book = myBook;
    rendition = book.renderTo("viewer", { width: "100%", height: "100%", spread: "none", flow: "paginated" });
    for (const [name, c] of Object.entries(THEMES)) {
      rendition.themes.register(name, {
        "html": { background: c.bg + " !important" },
        "body": { background: c.bg + " !important", color: c.fg + " !important", "line-height": "1.65 !important", "text-align": "left !important" },
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
    rendition.on("keyup", (e) => { if (e.key === "ArrowRight") nextP(); else if (e.key === "ArrowLeft") prevP(); });

    try { await rendition.display(rec.cfi || undefined); }
    catch (e) { showError("Reprise à la dernière position impossible, ouverture au début", e); await rendition.display(); }
    busyUI(false);

    myBook.loaded.navigation.then((nav) => {
      if (book !== myBook) return;
      tocFlat = flatToc(nav.toc, 0, []);
      tocFlat.forEach((t) => { const s = myBook.spine.get(String(t.href).split("#")[0]); t.sidx = s ? s.index : -1; });
      updateReaderUI();
    }).catch((e) => showError("Table des matières", e));

    myBook.ready.then(async () => {
      if (book !== myBook) return;
      if (rec.locations) myBook.locations.load(rec.locations);
      else { await myBook.locations.generate(1500); if (book !== myBook) return; await patchBook(id, { locations: myBook.locations.save() }); }
      if (book !== myBook) return;
      locReady = true; $("slider").disabled = false;
      if (cur && cur.cfi) {
        const p = myBook.locations.percentageFromCfi(cur.cfi);
        if (typeof p === "number" && !isNaN(p)) { cur.percent = p; cur.maxPercent = Math.max(cur.maxPercent || 0, p); scheduleSave({ percent: p, maxPercent: cur.maxPercent }); }
      }
      updateReaderUI();
      if (!cur.chars) await countChars(myBook, id);
    }).catch((e) => showError("Calcul de la progression", e));
  } catch (e) {
    busyUI(false); showError("Ouverture impossible", e);
    await teardown(); viewer = null; releaseWake();
    $("reader").hidden = true; document.body.classList.remove("hidenav");
    lsSet("epub.last", null);
  }
}
$("slider").addEventListener("input", (e) => { dragging = true; $("slider-val").textContent = Math.round(e.target.value / 10) + " %"; });
$("slider").addEventListener("change", (e) => {
  dragging = false;
  if (!locReady || !book) return;
  try { rendition.display(book.locations.cfiFromPercentage(e.target.value / 1000)).catch((err) => showError("Aller à la position", err)); }
  catch (err) { showError("Aller à la position", err); }
});

function sheetToc() {
  setUi(false);
  const ci = curTocIndex();
  openSheet(shHead("Chapitres", tocFlat.length + " chapitres · " + Math.round((cur.percent || 0) * 100) + " % lus") +
    '<div style="margin-top:12px">' + (tocFlat.length ? tocFlat.map((t, i) =>
      '<button class="tc' + (i === ci ? " cur" : i < ci ? " done" : "") + '" data-act="gochap" data-i="' + i + '" style="padding-left:' + (12 + t.depth * 14) + 'px"><span class="n">' + (i < ci ? I.check : i + 1) + '</span><span class="tx"><b>' + esc(t.label) + "</b><span>" + (i < ci ? "Terminé" : i === ci ? "En cours" : "") + "</span></span>" + (i === ci ? '<span class="now">En cours</span>' : "") + "</button>").join("") : '<div class="none">Pas de table des matières dans ce livre.</div>') + "</div>", RT(S.theme));
  const c = $("sheet").querySelector(".tc.cur"); if (c) c.scrollIntoView({ block: "center" });
}
function sheetRead() {
  setUi(false);
  const lines = (c) => '<i class="ln" style="top:46px;right:12px;background:' + c + '"></i><i class="ln" style="top:56px;right:28px;background:' + c + '"></i><i class="ln" style="top:66px;right:20px;background:' + c + '"></i>';
  openSheet(shHead("Lecture") +
    '<div class="lbl">Thème</div><div class="themes">' + Object.keys(THEMES).map((k) => { const t = THEMES[k]; return '<button class="th-c' + (S.theme === k ? " on" : "") + '" data-act="rtheme" data-v="' + k + '" style="background:' + t.bg + ";color:" + t.fg + '"><span class="aa">Aa</span>' + lines(t.fg) + '<span class="nm">' + t.name + "</span>" + (S.theme === k ? '<span class="ck">' + I.check + "</span>" : "") + "</button>"; }).join("") + "</div>" +
    '<div class="lbl">Taille du texte</div><div class="stp"><button data-act="size" data-v="-10" aria-label="Réduire le texte">A−</button><b>' + S.size + ' %</b><button data-act="size" data-v="10" aria-label="Agrandir le texte">A+</button></div>' +
    '<div class="lbl">Police</div><div class="seg"><button class="' + (S.font === "serif" ? "on" : "") + '" data-act="rfont" data-v="serif" style="font-family:Georgia,serif;font-size:16px">Serif</button><button class="' + (S.font === "sans" ? "on" : "") + '" data-act="rfont" data-v="sans">Sans</button></div>', RT(S.theme));
}

/* ============ Lecteur de scans (.cbz) ============ */
let sc = null;
async function scUrl(i) {
  if (sc.urls[i]) return sc.urls[i];
  if (!sc.pend[i]) {
    const s = sc;
    sc.pend[i] = (async () => {
      const n = s.names[i], b = await s.zip.file(n).async("blob");
      const u = URL.createObjectURL(new Blob([b], { type: mimeOf(n) })); s.urls[i] = u; return u;
    })();
  }
  return sc.pend[i];
}
function scLoad(pg) {
  if (pg.dataset.l) return Promise.resolve();
  pg.dataset.l = "1"; const i = +pg.dataset.i, s = sc;
  return scUrl(i).then((u) => {
    if (sc !== s) return;
    const im = pg.firstChild; im.onload = () => pg.classList.add("ok"); im.onerror = () => showError("Image illisible : page " + (i + 1), new Error(s.names[i])); im.src = u;
  }).catch((e) => showError("Chargement de la page " + (i + 1), e));
}
function scProgress(idx) {
  if (!sc) return;
  idx = Math.max(0, Math.min(sc.n - 1, idx)); sc.idx = idx;
  $("sc-page").textContent = "Page " + (idx + 1) + " / " + sc.n;
  $("sc-rail-i").style.height = ((idx + 1) / sc.n * 100) + "%";
  const reached = idx + 1, mp = cur.maxPage || 0;
  if (reached > mp) { const d = reached - mp; if (d <= 40) { ST.pages += d; saveStats(); } cur.maxPage = reached; }
  cur.percent = reached / sc.n; cur.page = idx;
  scheduleSave({ page: idx, percent: cur.percent, maxPage: cur.maxPage, lastRead: Date.now(), status: idx >= sc.n - 1 ? "done" : "reading" });
}
function scGo(i) {
  if (!sc || sc.mode !== "pages") return;
  i = Math.max(0, Math.min(sc.n - 1, i)); if (i === sc.idx && $("single").src) return;
  scProgress(i); scShow();
}
async function scShow() {
  const s = sc, i = sc.idx;
  try {
    const u = await scUrl(i); if (sc !== s || s.idx !== i) return;
    $("single").src = u;
    if (i + 1 < s.n) scUrl(i + 1).catch(() => {}); if (i > 0) scUrl(i - 1).catch(() => {});
  } catch (e) { showError("Affichage de la page " + (i + 1), e); }
}
function scSetMode(m, first) {
  S.smode = m; saveSettings();
  sc.mode = m;
  $("m-vertical").classList.toggle("on", m === "vertical"); $("m-pages").classList.toggle("on", m === "pages");
  $("m-manga").classList.toggle("on", !!S.manga); $("m-manga").disabled = m === "vertical";
  const strip = $("strip");
  if (m === "vertical") {
    $("single").hidden = true; strip.hidden = false;
    const pg = strip.children[sc.idx];
    if (pg) { scLoad(pg).then(() => { if (sc) strip.scrollTop = pg.offsetTop; }); }
  } else { strip.hidden = true; $("single").hidden = false; scShow(); }
  if (!first) setUi(false);
}
async function openScan(id) {
  busyUI(true, "Ouverture…", 1, 1, 0.3);
  try {
    if (typeof JSZip === "undefined") throw new Error("JSZip non chargé (connexion nécessaire au premier lancement)");
    const rec = await getBook(id); if (!rec) throw new Error("Livre introuvable dans la base");
    const data = await getFile(id); if (!data) throw new Error("Fichier introuvable (le navigateur a vidé le stockage ?). Réimporte le .cbz.");
    await teardown();
    const zip = await JSZip.loadAsync(data);
    const names = zipImages(zip); if (!names.length) throw new Error("Aucune image dans ce fichier");
    cur = rec; viewer = "scan"; cur.maxPage = cur.maxPage || 0;
    sc = { zip, names, n: names.length, urls: {}, pend: {}, idx: Math.min(rec.page || 0, names.length - 1), mode: S.smode, io: null };
    $("sc-title").textContent = rec.title;
    $("scan").hidden = false; $("reader").hidden = true; $("scan").className = "rt-dark"; document.body.classList.add("hidenav");
    pushView(); lsSet("epub.last", id); acquireWake();
    const strip = $("strip"); strip.textContent = "";
    names.forEach((_, i) => { const d = document.createElement("div"); d.className = "pg"; d.dataset.i = i; const im = document.createElement("img"); im.alt = "Page " + (i + 1); d.append(im); strip.append(d); });
    sc.io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) scLoad(e.target); }, { root: strip, rootMargin: "1600px 0px" });
    [...strip.children].forEach((p) => sc.io.observe(p));
    let ticking = false;
    strip.onscroll = () => {
      if (ticking || !sc || sc.mode !== "vertical") return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false; if (!sc) return;
        const y = strip.scrollTop + strip.clientHeight * 0.4; let k = 0;
        for (let i = 0; i < strip.children.length; i++) { if (strip.children[i].offsetTop <= y) k = i; else break; }
        if (k !== sc.idx) scProgress(k);
      });
    };
    strip.onclick = () => { if (sc && sc.mode === "vertical") setUi(!uiShown()); };
    $("single").onclick = (e) => {
      const x = e.clientX / window.innerWidth, dir = S.manga ? -1 : 1; // manga : on lit de droite à gauche, le bord gauche = page suivante
      if (x < 0.3) scGo(sc.idx - dir); else if (x > 0.7) scGo(sc.idx + dir); else setUi(!uiShown());
    };
    let t0 = null;
    $("single").ontouchstart = (e) => { const t = e.changedTouches[0]; t0 = { x: t.screenX, y: t.screenY }; };
    $("single").ontouchend = (e) => {
      if (!t0 || !sc) return; const t = e.changedTouches[0], dx = t.screenX - t0.x, dy = t.screenY - t0.y; t0 = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); const dir = S.manga ? -1 : 1; scGo(sc.idx + (dx < 0 ? dir : -dir)); }
    };
    scProgress(sc.idx);
    scSetMode(S.smode, true);
    busyUI(false);
    setUi(true); setTimeout(() => { if (viewer === "scan") setUi(false); }, 1800);
  } catch (e) {
    busyUI(false); showError("Ouverture impossible", e);
    await teardown(); viewer = null; releaseWake();
    $("scan").hidden = true; document.body.classList.remove("hidenav"); lsSet("epub.last", null);
  }
}

/* ============ Sauvegarde ============ */
async function exportBackup() {
  const books = LIB.map((b) => ({ id: b.id, kind: kindOf(b), title: b.title, author: b.author || "", category: b.category || "", status: b.status || null, percent: b.percent || 0, maxPercent: b.maxPercent || 0, cfi: b.cfi || null, page: b.page || 0, maxPage: b.maxPage || 0, pages: b.pages || 0, chars: b.chars || 0, lastRead: b.lastRead || 0, addedAt: b.addedAt || 0 }));
  const blob = new Blob([JSON.stringify({ app: "lecture", v: 1, at: new Date().toISOString(), settings: S, cats: CATS, stats: ST, books })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lecture-sauvegarde-" + dayKey() + ".json";
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Sauvegarde exportée (" + books.length + " livres)");
}
$("file-json").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.app !== "lecture" || !Array.isArray(d.books)) throw new Error("Ce fichier n'est pas une sauvegarde de Lecture");
    let added = 0, upd = 0;
    for (const b of d.books) {
      const ex = await getBook(b.id);
      if (ex) { if ((b.lastRead || 0) > (ex.lastRead || 0)) { Object.assign(ex, { percent: b.percent, maxPercent: b.maxPercent, cfi: b.cfi, page: b.page, maxPage: b.maxPage, lastRead: b.lastRead, status: b.status, category: b.category || ex.category }); await putBook(ex); upd++; } }
      else if (b.kind === "wish") { await putBook(Object.assign({}, b, { cover: null })); added++; }
    }
    if (d.cats) { CATS = [...new Set(CATS.concat(d.cats))]; saveCats(); }
    if (d.stats && d.stats.days) { for (const [k, v] of Object.entries(d.stats.days)) ST.days[k] = Math.max(ST.days[k] || 0, v); ST.chars = Math.max(ST.chars, d.stats.chars || 0); ST.pages = Math.max(ST.pages, d.stats.pages || 0); saveStats(); }
    if (d.settings) { Object.assign(S, d.settings); saveSettings(); applyUi(); }
    await loadLib(); renderAll();
    toast("Sauvegarde importée : " + added + " livre(s) ajouté(s), " + upd + " progression(s) mise(s) à jour. Les fichiers epub/cbz sont à réajouter.");
  } catch (e) { showError("Import de la sauvegarde", e); }
});

/* ============ Actions (délégation de clics) ============ */
async function refresh(reopen) { await loadLib(); renderAll(); if (reopen) reopen(); }
const ACT = {
  tab: (el) => showTab(el.dataset.v),
  close: () => closeSheet(),
  closeviewer: () => backFromViewer(),
  open: (el) => openBook(el.dataset.id),
  menu: (el) => sheetBook(el.dataset.id),
  addmenu: () => sheetAdd(),
  add: (el) => { closeSheet(); const f = $("file"); ADD.attach = null; f.accept = el.dataset.v === "cbz" ? ".cbz,.zip,.cbr,application/zip,application/vnd.comicbook+zip" : ".epub,application/epub+zip"; f.click(); },
  attach: (el) => { ADD.attach = el.dataset.id; const f = $("file"); f.accept = ".epub,.cbz,.zip,application/epub+zip"; f.multiple = false; f.click(); f.multiple = true; },
  addwish: () => { WD = { cat: TL.cat || "" }; sheetAddWish(false); },
  wcat: (el) => { WD.cat = el.dataset.v; sheetAddWish(true); },
  savewish: async () => {
    const t = ($("w-title").value || "").trim(); if (!t) { toast("Donne au moins un titre"); return; }
    const id = "wish|" + Date.now() + "|" + Math.random().toString(36).slice(2, 6);
    try { await putBook({ id, kind: "wish", title: t, author: ($("w-author").value || "").trim(), category: WD.cat, status: "toread", percent: 0, addedAt: Date.now(), lastRead: 0 }); closeSheet(); TL.st = "toread"; await refresh(); showTab("toread"); }
    catch (e) { showError("Ajout à la liste", e); }
  },
  fcat: (el) => { TL.cat = el.dataset.v; renderToRead(); },
  fst: (el) => { TL.st = el.dataset.v; renderToRead(); },
  addcat: async () => {
    const n = (prompt("Nom de la catégorie") || "").trim();
    if (!n) return;
    if (CATS.some((c) => c.toLowerCase() === n.toLowerCase())) { toast("Cette catégorie existe déjà"); return; }
    CATS.push(n); saveCats(); renderAll();
    if (!$("sheet").hidden && $("w-title")) sheetAddWish(true);
    else if (SB) sheetBook(SB);
  },
  delcat: async (el) => {
    const c = el.dataset.v; if (!confirm("Supprimer la catégorie « " + c + " » ? Les livres ne sont pas supprimés.")) return;
    try { CATS = CATS.filter((x) => x !== c); saveCats(); for (const b of LIB) if (b.category === c) await patchBook(b.id, { category: "" }); if (TL.cat === c) TL.cat = ""; await refresh(); } catch (e) { showError("Suppression de la catégorie", e); }
  },
  setstatus: async (el) => { try { await patchBook(el.dataset.id, { status: el.dataset.v }); await refresh(() => sheetBook(el.dataset.id)); } catch (e) { showError("Changement de statut", e); } },
  setcat: async (el) => { try { await patchBook(el.dataset.id, { category: el.dataset.v }); await refresh(() => sheetBook(el.dataset.id)); } catch (e) { showError("Changement de catégorie", e); } },
  del: async (el) => {
    const b = LIB.find((x) => x.id === el.dataset.id); if (!b || !confirm("Supprimer « " + b.title + " » de l'appli ?")) return;
    try { await delBook(b.id); closeSheet(); await refresh(); } catch (e) { showError("Suppression impossible", e); }
  },
  wallet: () => { walletOpen = !walletOpen; renderStats(); },
  ui: (el) => { S.ui = el.dataset.v; saveSettings(); applyUi(); renderSettings(); },
  accent: (el) => { S.accent = el.dataset.v; saveSettings(); applyUi(); renderSettings(); },
  tgl: (el) => { const k = el.dataset.k; S[k] = !S[k]; saveSettings(); renderSettings(); },
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const c = await deferredInstall.userChoice;
    toast(c.outcome === "accepted" ? "Installation lancée" : "Installation annulée");
    deferredInstall = null; fillInstall();
  },
  export: () => exportBackup().catch((e) => showError("Export de la sauvegarde", e)),
  importjson: () => $("file-json").click(),
  toc: () => sheetToc(),
  readset: () => sheetRead(),
  gochap: (el) => { const t = tocFlat[+el.dataset.i]; closeSheet(); if (t && rendition) rendition.display(t.href).catch((e) => showError("Aller au chapitre", e)); },
  rtheme: (el) => { S.theme = el.dataset.v; saveSettings(); applyReaderStyle(); sheetRead(); },
  rfont: (el) => { S.font = el.dataset.v; saveSettings(); applyReaderStyle(); sheetRead(); },
  size: (el) => { S.size = Math.min(220, Math.max(70, S.size + (+el.dataset.v))); saveSettings(); applyReaderStyle(); sheetRead(); },
  smode: (el) => { if (sc) scSetMode(el.dataset.v); },
  manga: () => { if (!sc || sc.mode === "vertical") return; S.manga = !S.manga; saveSettings(); $("m-manga").classList.toggle("on", !!S.manga); },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-act]");
  if (!el || !ACT[el.dataset.act]) return;
  if (el.id === "backdrop" && e.target !== el) return;
  try { const r = ACT[el.dataset.act](el, e); if (r && r.catch) r.catch((er) => showError("Action " + el.dataset.act, er)); }
  catch (er) { showError("Action " + el.dataset.act, er); }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});

/* ============ Démarrage ============ */
(async function start() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await loadLib(); renderAll();
    if (typeof ePub === "undefined" || typeof JSZip === "undefined") showError("Chargement", new Error("Les librairies de lecture n'ont pas pu être téléchargées. Connecte-toi une première fois."));
    const last = lsGet("epub.last", null);
    if (last && typeof ePub !== "undefined" && LIB.some((b) => b.id === last)) await openBook(last); // reprise automatique
  } catch (e) { showError("Démarrage", e); }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => showError("Mode hors-ligne indisponible (service worker)", e));
}
