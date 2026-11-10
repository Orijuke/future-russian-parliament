/* Будущий парламент России — Сенат и Дума
   Карта регионов, подкова Сената (3 места на регион), арка Думы (∛ населения). Без внешних библиотек. */
(() => {
  "use strict";
  const GEO = window.FRP_GEO;
  const NS = "http://www.w3.org/2000/svg";
  const SEATS_PER_REGION = 3;
  const FO_ORDER = ["ЦФО", "СЗФО", "ЮФО", "СКФО", "ПФО", "УФО", "СФО", "ДФО"];
  const FO_NAMES = {
    "ЦФО": "Центральный", "СЗФО": "Северо-Западный", "ЮФО": "Южный", "СКФО": "Северо-Кавказский",
    "ПФО": "Приволжский", "УФО": "Уральский", "СФО": "Сибирский", "ДФО": "Дальневосточный"
  };
  const CITY_MARKERS = [10, 19, 37]; // Москва, Санкт-Петербург, Севастополь — слишком малы на карте
  const LEVELS = [
    { crimea: false, new: false },
    { crimea: true, new: false },
    { crimea: true, new: true }
  ];

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (n, d = 0) => n == null || isNaN(n) ? "—" :
    n.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d });
  const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; if (m > 10 && m < 20) return c; if (d === 1) return a; if (d > 1 && d < 5) return b; return c; };
  const seatsWord = (n) => plural(n, "место", "места", "мест");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  /* ---------------- данные ---------------- */
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = ""; if (row.some(v => v.trim() !== "")) rows.push(row); row = [];
      } else cur += c;
    }
    row.push(cur); if (row.some(v => v.trim() !== "")) rows.push(row);
    const head = rows.shift().map(h => h.trim());
    return { head, rows: rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()]))) };
  }
  const key = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/[«»"()]/g, "")
    .replace(/[\s \-—–]+/g, " ").trim();
  const num = (s) => { if (!s) return null; const v = parseFloat(String(s).replace(/[^\d,.]/g, "").replace(",", ".")); return isNaN(v) ? null : v; };
  const findCol = (head, re) => head.find(h => re.test(h));

  async function loadCSV() {
    try {
      const r = await fetch("data.csv", { cache: "no-store" });
      if (!r.ok) throw 0;
      return await r.text();
    } catch { return window.FRP_CSV_FALLBACK || ""; }
  }

  /* ---------------- состояние ---------------- */
  const state = {
    level: Math.max(0, Math.min(2, store.get("frp.level", 1))),
    chamber: store.get("frp.chamber", "senate") === "duma" ? "duma" : "senate",
    mode: ["status", "pop"].includes(store.get("frp.mode", "enamel")) ? store.get("frp.mode", "enamel") : "enamel",
    hover: null, pinned: null, fo: null,
    view: { x: 0, y: 0, w: GEO.W, h: GEO.H }
  };
  const show = () => LEVELS[state.level];
  const regions = GEO.regions.map(r => ({ ...r }));
  const byId = new Map(regions.map(r => [r.id, r]));
  const visible = (r) => r.group === "core" || (r.group === "crimea" && show().crimea) || (r.group === "new" && show().new);

  let cols = {}; let extraCols = [];
  function attachData(csvText) {
    const { head, rows } = parseCSV(csvText);
    cols = {
      name: findCol(head, /территор|регион|субъект/i) || head[1],
      fo: findCol(head, /округ/i),
      status: findCol(head, /статус/i),
      pop: findCol(head, /населен/i),
      area: findCol(head, /площад/i),
      no: findCol(head, /^№|^n$|номер/i)
    };
    const known = new Set(Object.values(cols));
    extraCols = head.filter(h => !known.has(h));
    const idx = new Map(rows.map(r => [key(r[cols.name]), r]));
    for (const r of regions) {
      const row = idx.get(key(r.name));
      r.row = row || null;
      if (row) {
        r.pop = num(row[cols.pop]); r.area = num(row[cols.area]);
        r.status = row[cols.status] || ""; if (cols.fo && row[cols.fo]) r.fo = row[cols.fo];
        r.no = row[cols.no] || "";
      } else { r.pop = r.area = null; r.status = DEFAULT_STATUS[r.id] || ""; r.no = ""; }
      r.st = statusKey(r.status);
    }
  }

  /* ---------------- слои окраски: статус и население ---------------- */
  const STATUSES = [
    { k: "gfz",  name: "Города федерального значения", c: "#c8404d" },
    { k: "krai", name: "Края",                         c: "#dc7a2e" },
    { k: "obl",  name: "Области",                      c: "#d6b23e" },
    { k: "resp", name: "Республики",                   c: "#3a9a62" },
    { k: "ao",   name: "Автономные округа",            c: "#4aa8d2" },
    { k: "aobl", name: "Автономная область",           c: "#8d58c2" }
  ];
  // статусы для регионов, которых пока нет в data.csv
  const DEFAULT_STATUS = { 86: "республика", 87: "республика", 88: "область", 89: "область" };
  function statusKey(s) {
    s = String(s || "").toLowerCase();
    if (s.includes("город")) return "gfz";
    if (s.includes("автономная")) return "aobl";
    if (s.includes("автономный")) return "ao";
    if (s.includes("край")) return "krai";
    if (s.includes("республик")) return "resp";
    if (s.includes("област")) return "obl";
    return "";
  }
  // население: границы классов, млн чел.
  const POP_BREAKS = [0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 4];
  const POP_CLASSES = [
    { name: "до 400 тыс.", c: "#33408f" },
    { name: "400–600 тыс.", c: "#4053a6" },
    { name: "600–800 тыс.", c: "#5368b5" },
    { name: "0,8–1 млн", c: "#6e7dbc" },
    { name: "1–1,5 млн", c: "#9393b8" },
    { name: "1,5–2 млн", c: "#b6a385" },
    { name: "2–2,5 млн", c: "#d1b265" },
    { name: "2,5–4 млн", c: "#e6c360" },
    { name: "4 млн и более", c: "#f6da7e" }
  ];
  function popKey(pop) {
    if (pop == null) return "pp-na";
    const m = pop / 1e6; let i = 0;
    while (i < POP_BREAKS.length && m >= POP_BREAKS[i]) i++;
    return "pp-" + i;
  }
  const LAYERS = {
    status: { items: STATUSES.map(x => ({ k: "st-" + x.k, name: x.name, c: x.c })), of: r => r.st ? "st-" + r.st : "" },
    pop: {
      items: POP_CLASSES.map((x, i) => ({ k: "pp-" + i, name: x.name, c: x.c })).concat([{ k: "pp-na", name: "нет данных", c: "#5a5d72" }]),
      of: r => popKey(r.pop)
    }
  };
  const mix = (hex, to, t) => {
    const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
    const ch = (v, sh) => (v >> sh) & 255;
    const m = (sh) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
    return "#" + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1);
  };
  function buildLayerDefs() {
    const defs = document.querySelector("svg defs");
    let css = "";
    for (const [mode, L] of Object.entries(LAYERS)) for (const it of L.items) {
      // мягкая «эмаль»: светлый блик сверху-слева, лёгкое (не тёмное) затенение снизу-справа
      const g = el("linearGradient", { id: "g-" + it.k, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
      [[0, mix(it.c, "#ffffff", .38)], [.5, it.c], [1, mix(it.c, "#000000", .16)]].forEach(([o, c]) =>
        el("stop", { offset: o, "stop-color": c }, g));
      css += `.${it.k}{--c:${it.c}}.mode-${mode} .region.${it.k},.mode-${mode} .lift.${it.k}{fill:url(#g-${it.k})}\n`;
    }
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }
  const layerClass = (r) => LAYERS[state.mode] ? LAYERS[state.mode].of(r) : "";
  function applyMode() {
    document.body.classList.remove("mode-status", "mode-pop", "mode-layer");
    if (LAYERS[state.mode]) document.body.classList.add("mode-" + state.mode, "mode-layer");
    document.querySelectorAll("#modeSeg button").forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
    });
    store.set("frp.mode", state.mode);
    renderLegend();
    if (state.pinned) pinCard.innerHTML = cardHTML(byId.get(state.pinned), true);
  }
  function renderLegend() {
    const L = LAYERS[state.mode]; const ul = $("#legend");
    if (!L) return;
    const list = regions.filter(visible);
    ul.innerHTML = L.items.map(it => {
      const n = list.filter(r => L.of(r) === it.k).length;
      if (!n && it.k === "pp-na") return "";
      return `<li data-k="${it.k}" class="${it.k}${n ? "" : " empty"}"><i class="legend__gem"></i><span>${it.name}</span><b>${n}</b></li>`;
    }).join("");
  }
  function highlightLayer(k) {
    gRegions.classList.toggle("stdim", !!k);
    for (const r of regions) r.path.classList.toggle("stsel", !!k && r.path.classList.contains(k));
  }

  function totals() {
    const list = regions.filter(visible);
    const withPop = list.filter(r => r.pop != null);
    const withArea = list.filter(r => r.area != null);
    const pop = withPop.reduce((a, r) => a + r.pop, 0);
    const area = withArea.reduce((a, r) => a + r.area, 0);
    return { list, withPop, pop, area, seats: list.length * SEATS_PER_REGION, duma: pop ? Math.ceil(Math.cbrt(pop) - 1e-9) : 0 };
  }

  /* ---------------- раскладка мест: дуга с рядами ---------------- */
  function arcLayout(cfg, N) {
    const { cx, cy, Rout, Rin, rows, A } = cfg;
    const e = (A - Math.PI) / 2;
    const radii = Array.from({ length: rows }, (_, k) => Rin + (Rout - Rin) * k / (rows - 1));
    const sum = radii.reduce((a, b) => a + b, 0);
    const raw = radii.map(r => N * r / sum);
    const cnt = raw.map(Math.floor);
    const rest = N - cnt.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).slice(0, rest).forEach(([, i]) => cnt[i]++);
    const pts = [];
    radii.forEach((r, k) => {
      const n = cnt[k];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? .5 : i / (n - 1);
        const phi = Math.PI + e - t * A;
        pts.push({ x: cx + r * Math.cos(phi), y: cy - r * Math.sin(phi), phi, k });
      }
    });
    pts.sort((a, b) => (b.phi - a.phi) || (a.k - b.k));
    const dr = (Rout - Rin) / (rows - 1);
    const along = cnt[0] > 1 ? A * Rin / (cnt[0] - 1) : dr;
    pts.rr = (cfg.k || 0.43) * Math.min(dr, along);
    return pts;
  }

  /* ---------------- карта ---------------- */
  const svg = $("#map"), gRegions = $("#regions"), gBorders = $("#borders"),
        gHover = $("#hoverLayer"), gPin = $("#pinLayer"), gMarkers = $("#markers");
  const borders = {};

  function buildMap() {
    for (const r of regions) r.path = el("path", { d: r.d, class: ["region", r.st ? "st-" + r.st : "", popKey(r.pop)].join(" ").trim(), "data-id": r.id }, gRegions);
    const msk = byId.get(10); if (msk) gRegions.appendChild(msk.path); // Москва поверх области
    borders.fo = el("path", { d: GEO.meshes.fo, class: "fo-border" }, gBorders);
    if (GEO.meshes.foNew) borders.foNew = el("path", { d: GEO.meshes.foNew, class: "fo-border" }, gBorders);
    for (const id of CITY_MARKERS) {
      const r = byId.get(id); if (!r) continue;
      const g = el("g", { class: "marker", "data-id": id }, gMarkers);
      el("circle", { r: 5.2, class: "bez" }, g);
      el("circle", { r: 3.6, class: "gem" }, g);
      r.marker = g;
    }
    placeMarkers();
  }
  function placeMarkers() {
    const k = Math.max(0.35, state.view.w / GEO.W);
    for (const id of CITY_MARKERS) {
      const r = byId.get(id); if (!r || !r.marker) continue;
      r.marker.setAttribute("transform", `translate(${r.c[0]},${r.c[1]}) scale(${k})`);
    }
  }
  function applyVisibility() {
    for (const r of regions) {
      const v = visible(r);
      r.path.classList.toggle("off", !v);
      if (r.marker) r.marker.classList.toggle("off", !v);
    }
    if (borders.foNew) borders.foNew.classList.toggle("off", !show().new);
    if (state.pinned && !visible(byId.get(state.pinned))) unpin();
    if (state.hover && !visible(byId.get(state.hover))) setHover(null);
  }

  let liftEl = null;
  function makeLift(r, layer, extra) {
    const p = el("path", { d: r.d, class: ["lift", r.st ? "st-" + r.st : "", popKey(r.pop), extra || ""].join(" ").trim() }, layer);
    const rect = svg.getBoundingClientRect();
    const pxPerUnit = rect.width / state.view.w;
    const size = Math.max(r.b[2] - r.b[0], r.b[3] - r.b[1]) * pxPerUnit;
    const s = Math.min(3.2, Math.max(1.06, 1 + 7 / Math.max(size, 1), 16 / Math.max(size, 1)));
    p.style.setProperty("--s", s.toFixed(3));
    return p;
  }

  /* ---------------- Сенат (подкова) ---------------- */
  const sv = $("#senate");
  const SEN = { cx: 380, cy: 318, Rout: 266, Rin: 136, rows: 7, A: Math.PI * 1.3, rr: 8.2 };
  const gArcs = el("g", { class: "fo-arcs" }, sv);
  const gSeats = el("g", { class: "seats", filter: "url(#softShadow)" }, sv);
  const sCount = el("text", { x: SEN.cx, y: SEN.cy + 18, "text-anchor": "middle", class: "hall-count" }, sv);
  const sSub = el("text", { x: SEN.cx, y: SEN.cy + 56, "text-anchor": "middle", class: "hall-sub" }, sv);
  const sSub2 = el("text", { x: SEN.cx, y: SEN.cy + 84, "text-anchor": "middle", class: "hall-sub2" }, sv);
  const sSub3 = el("text", { x: SEN.cx, y: SEN.cy + 106, "text-anchor": "middle", class: "hall-sub2" }, sv);
  const sQ = qmark(sv, "senate");

  /* Рассадка по тройкам: места раскладываются по рядам подковы как обычно, затем жадным
     проходом слева направо собираются тройки соседних мест (каждая тройка — связная цепочка
     соседей). Тройки идут по углу, поэтому федеральный округ занимает сплошной сектор.
     Перебираем несколько настроек эвристики и берём лучшую; для известных размеров — сразу. */
  const TRIPLE_PARAMS = {
    249: { win: 0, wd: 0, wp: 50, wk: 0, cd: 0.2, cp: 1 },
    255: { win: 0.1, wd: 10, wp: 50, wk: -0.5, cd: 0, cp: 0 },
    261: { win: 0.03, wd: 0, wp: 50, wk: -0.5, cd: 0.2, cp: 0 },
    267: { win: 0.03, wd: 3, wp: 50, wk: 0.5, cd: 0.2, cp: 3 }
  };
  const tripleCache = new Map();
  function seatTriples(pts) {
    const n = pts.length;
    if (tripleCache.has(n)) return tripleCache.get(n);
    const d = (a, b) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
    const nnd = pts.map((_, i) => { let m = 1e9; for (let j = 0; j < n; j++) if (j !== i) m = Math.min(m, d(i, j)); return m; });
    const pitch = [...nnd].sort((a, b) => a - b)[n >> 1];
    const nb = pts.map((_, i) => { const a = []; for (let j = 0; j < n; j++) if (j !== i && d(i, j) <= 1.55 * pitch) a.push(j); return a; });
    const run = (P) => {
      const free = new Uint8Array(n).fill(1); let left = n;
      const deg = (i) => { let c = 0; for (const j of nb[i]) if (free[j]) c++; return c; };
      const out = [];
      while (left) {
        let maxphi = -1e9; for (let i = 0; i < n; i++) if (free[i] && pts[i].phi > maxphi) maxphi = pts[i].phi;
        let seed = -1, bs = 1e9;
        for (let i = 0; i < n; i++) if (free[i] && pts[i].phi >= maxphi - P.win) {
          const sc = deg(i) * P.wd - (pts[i].phi - maxphi) * P.wp + pts[i].k * P.wk; if (sc < bs) { bs = sc; seed = i; }
        }
        free[seed] = 0; left--; const g = [seed];
        while (g.length < SEATS_PER_REGION && left) {
          const cand = new Set(); for (const a of g) for (const j of nb[a]) if (free[j]) cand.add(j);
          const pool = cand.size ? [...cand] : [...Array(n).keys()].filter(j => free[j]);
          let best = -1, bv = 1e9;
          for (const j of pool) {
            free[j] = 0; const v = Math.max(...g.map(a => d(a, j))) / pitch + P.cd * deg(j) - P.cp * (pts[j].phi - maxphi); free[j] = 1;
            if (v < bv) { bv = v; best = j; }
          }
          free[best] = 0; left--; g.push(best);
        }
        out.push(g);
      }
      let worst = 0, sum = 0;
      for (const g of out) {
        if (g.length < 3) continue;
        const e = [d(g[0], g[1]), d(g[0], g[2]), d(g[1], g[2])].map(x => x / pitch);
        worst = Math.max(worst, Math.min(Math.max(e[0], e[1]), Math.max(e[0], e[2]), Math.max(e[1], e[2])));
        sum += Math.max(...e);
      }
      return { out, worst, sum };
    };
    let B = null;
    if (TRIPLE_PARAMS[n]) B = run(TRIPLE_PARAMS[n]);
    else {
      for (const win of [0, .03, .06, .1]) for (const wd of [0, 3, 10]) for (const wp of [50, 200]) for (const wk of [0, .5, -.5])
        for (const cd of [0, .2, .4]) for (const cp of [0, 1, 3]) {
          const r = run({ win, wd, wp, wk, cd, cp });
          if (!B || r.worst < B.worst - 1e-6 || (Math.abs(r.worst - B.worst) < 1e-6 && r.sum < B.sum)) B = r;
        }
    }
    tripleCache.set(n, B.out);
    return B.out;
  }

  function buildSeats() {
    for (const r of regions) {
      r.seats = [];
      for (let i = 0; i < SEATS_PER_REGION; i++) {
        const g = el("g", { class: "seat off", "data-id": r.id }, gSeats);
        g.style.transform = `translate(${SEN.cx}px,${SEN.cy}px)`;
        const inner = el("g", { class: "seat-in" }, g);
        el("circle", { r: SEN.rr + 1.5, class: "bezel" }, inner);
        el("circle", { r: SEN.rr, class: "pearl" }, inner);
        r.seats.push(g);
      }
    }
  }
  const orderedVisible = () => regions.filter(visible).sort((a, b) =>
    (FO_ORDER.indexOf(a.fo) - FO_ORDER.indexOf(b.fo)) || ((+a.no || a.id) - (+b.no || b.id)));

  const counters = new Map();
  function animateNumber(node, to) {
    const from = counters.get(node) || 0; const t0 = performance.now(); const dur = 700;
    counters.set(node, to);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * e);
      if (k < 1 && counters.get(node) === to) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let foCount = {};
  function layoutSenate() {
    const list = orderedVisible();
    const pts = arcLayout(SEN, list.length * SEATS_PER_REGION);
    const groups = seatTriples(pts);
    let i = 0; const foRange = {}; foCount = {};
    for (const r of regions) if (!visible(r)) r.seats.forEach(g => g.classList.add("off"));
    for (const r of list) {
      foCount[r.fo] = (foCount[r.fo] || 0) + 1;
      const grp = groups[i++];
      const fr = foRange[r.fo] || (foRange[r.fo] = { hi: -Infinity, lo: Infinity });
      r.seats.forEach((g, q) => {
        const p = pts[grp[q]];
        g.style.transform = `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`;
        g.classList.remove("off");
        fr.hi = Math.max(fr.hi, p.phi); fr.lo = Math.min(fr.lo, p.phi);
      });
    }
    drawArcs(foRange);
    if (state.fo && !foCount[state.fo]) state.fo = null;
    if (state.foPreview && !foCount[state.foPreview]) state.foPreview = null;
    applyFO();
  }

  const regionsWord = (n) => plural(n, "регион", "региона", "регионов");
  const genitive = (adj) => adj.replace(/ый$|ий$/, "ого").replace(/-Западный/, "-Западного").replace(/-Кавказский/, "-Кавказского");
  // Единый вид подписей: число → «мест в …» → (название округа) → значок «?» с формулой
  function senateCenter() {
    const T = totals(); const f = activeFO();
    if (f) {
      const N = (foCount[f] || 0) * SEATS_PER_REGION;
      animateNumber(sCount, N);
      sSub.textContent = `${seatsWord(N)} в Сенате`;
      sSub2.textContent = FO_NAMES[f];
      sSub3.textContent = "федеральный округ";
      sQ.setAttribute("transform", `translate(${SEN.cx},${SEN.cy + 134})`);
    } else {
      animateNumber(sCount, T.seats);
      sSub.textContent = `${seatsWord(T.seats)} в Сенате`;
      sSub2.textContent = ""; sSub3.textContent = "";
      sQ.setAttribute("transform", `translate(${SEN.cx},${SEN.cy + 88})`);
    }
    if (math.ctx === "senate") renderMath();
  }

  /* ---------------- «?»: формула расчёта ---------------- */
  function qmark(parent, ctx) {
    const g = el("g", { class: "qmark", "data-math": ctx, tabindex: 0, role: "button", "aria-label": "Как считается число мест" }, parent);
    el("circle", { r: 12.5, class: "qmark__ring" }, g);
    el("circle", { r: 10.6, class: "qmark__face" }, g);
    const t = el("text", { y: 5.5, "text-anchor": "middle", class: "qmark__q" }, g); t.textContent = "?";
    return g;
  }
  const math = { ctx: null, pinned: false, anchor: null };
  const CEIL_X = `<math><mo fence="true">⌈</mo><mi>x</mi><mo fence="true">⌉</mo></math>`;
  const mathPop = document.getElementById("mathPop");
  const mn = (v, d = 0) => `<mn>${fmt(v, d)}</mn>`;
  function mathHTML(ctx) {
    const T = totals();
    if (ctx === "senate") {
      const f = activeFO();
      if (f) {
        const n = foCount[f] || 0, ab = `<mtext>${f}</mtext>`;
        return `
          <p class="mp__eyebrow">● Сенат · ${FO_NAMES[f]} федеральный округ</p>
          <math display="block"><msub><mi>S</mi>${ab}</msub><mo>=</mo><mn>3</mn><mo>·</mo><msub><mi>n</mi>${ab}</msub><mo>=</mo><mn>3</mn><mo>·</mo>${mn(n)}<mo>=</mo>${mn(3 * n)}</math>
          <p class="mp__where">где <i>S</i><sub>${f}</sub> — число мест от округа, <i>n</i><sub>${f}</sub> — число его регионов<sup>1</sup>.</p>
          <p class="mp__text">Каждый регион направляет в Сенат трёх сенаторов, поэтому вес федерального округа определяется только числом его регионов, а не населением.</p>
          <ol class="mp__notes"><li>Учитываются регионы, выбранные ползунком «Состав федерации».</li></ol>`;
      }
      const n = T.list.length;
      return `
        <p class="mp__eyebrow">● Сенат</p>
        <math display="block"><mi>S</mi><mo>=</mo><mn>3</mn><mo>·</mo><mi>n</mi><mo>=</mo><mn>3</mn><mo>·</mo>${mn(n)}<mo>=</mo>${mn(3 * n)}</math>
        <p class="mp__where">где <i>S</i> — число мест в Сенате, <i>n</i> — число регионов<sup>1</sup>.</p>
        <p class="mp__text">Сенат — палата равного представительства регионов: каждый субъект федерации направляет трёх сенаторов независимо от численности населения.</p>
        <ol class="mp__notes"><li>Учитываются регионы, выбранные ползунком «Состав федерации» (сейчас ${n}).</li></ol>`;
    }
    const P = T.pop, D = T.duma, root = P ? Math.cbrt(P) : 0;
    const miss = T.list.length - T.withPop.length;
    return `
      <p class="mp__eyebrow">● Дума</p>
      <math display="block"><mi>D</mi><mo>=</mo><mo fence="true">⌈</mo><mroot><mi>P</mi><mn>3</mn></mroot><mo fence="true">⌉</mo></math>
      <math display="block"><mi>D</mi><mo>=</mo><mo fence="true">⌈</mo><mroot>${mn(P)}<mn>3</mn></mroot><mo fence="true">⌉</mo><mo>=</mo><mo fence="true">⌈</mo><mn>${fmt(root, 2)}…</mn><mo fence="true">⌉</mo><mo>=</mo>${mn(D)}</math>
      <p class="mp__where">где <i>D</i> — число мест в Думе, <i>P</i> — население страны<sup>1</sup>, ${CEIL_X} — округление вверх<sup>2</sup>.</p>
      <p class="mp__text">Размер Думы следует «правилу кубического корня» Р. Таагеперы: численность нижней палаты парламента примерно равна кубическому корню из населения страны. Так палата растёт вместе с населением, но медленно.</p>
      <ol class="mp__notes">
        <li>Сумма населения регионов, выбранных ползунком и имеющих данные в data.csv${miss ? ` (без ${miss} ${plural(miss, "региона", "регионов", "регионов")} без данных)` : ""}.</li>
        <li>${CEIL_X} — наименьшее целое число, не меньшее <i>x</i>.</li>
      </ol>`;
  }
  function renderMath() {
    if (!math.ctx) return;
    mathPop.innerHTML = mathHTML(math.ctx) + `<p class="mp__foot">${math.pinned ? "Закреплено · клик вне окна, ПКМ или Esc — закрыть" : "Клик по «?» — закрепить"}</p>`;
    placeMath();
  }
  function placeMath() {
    if (!math.anchor) return;
    const r = math.anchor.getBoundingClientRect();
    const w = mathPop.offsetWidth, h = mathPop.offsetHeight;
    let left = r.left + r.width / 2 - w / 2, top = r.bottom + 12;
    if (top + h > innerHeight - 12) top = r.top - h - 12;
    left = Math.max(12, Math.min(left, innerWidth - w - 12)); top = Math.max(12, top);
    mathPop.style.left = (left + scrollX) + "px"; mathPop.style.top = (top + scrollY) + "px";
  }
  function showMath(anchor, pin) {
    math.ctx = anchor.dataset.math; math.anchor = anchor; math.pinned = !!pin;
    mathPop.classList.add("show"); mathPop.classList.toggle("pinned", math.pinned);
    mathPop.setAttribute("aria-hidden", "false");
    renderMath();
  }
  function hideMath() {
    math.ctx = null; math.anchor = null; math.pinned = false;
    mathPop.classList.remove("show", "pinned"); mathPop.setAttribute("aria-hidden", "true");
  }
  function bindMath() {
    document.querySelectorAll(".qmark").forEach(q => {
      q.addEventListener("pointerenter", () => { if (!math.pinned) showMath(q, false); });
      q.addEventListener("pointerleave", () => { if (!math.pinned) hideMath(); });
      q.addEventListener("click", (e) => { e.stopPropagation(); if (math.pinned && math.anchor === q) hideMath(); else showMath(q, true); });
      q.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showMath(q, true); } });
    });
    document.addEventListener("click", (e) => { if (math.pinned && !mathPop.contains(e.target)) hideMath(); });
    window.addEventListener("scroll", () => { if (math.ctx && !math.pinned) hideMath(); }, { passive: true });
  }

  const foTags = {}, foArcs = {};
  function drawArcs(foRange) {
    gArcs.innerHTML = "";
    for (const k in foTags) delete foTags[k];
    const { cx, cy, Rout } = SEN;
    const list = FO_ORDER.filter(f => foRange[f]);
    const R = Rout + 17, RL = Rout + 34, gap = 0.014;
    const P = (r, a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    list.forEach((f, i) => {
      const cur = foRange[f];
      const prev = list[i - 1] && foRange[list[i - 1]], next = list[i + 1] && foRange[list[i + 1]];
      const a1 = (prev ? (prev.lo + cur.hi) / 2 : cur.hi + 0.02) - gap;
      const a2 = (next ? (cur.lo + next.hi) / 2 : cur.lo - 0.02) + gap;
      const [x1, y1] = P(R, a1), [x2, y2] = P(R, a2);
      const large = (a1 - a2) > Math.PI ? 1 : 0;
      const d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
      const tag = el("g", { class: "fo-tag", "data-fo": f, tabindex: 0, role: "button" }, gArcs);
      el("path", { d, class: "arc-hit" }, tag);
      foArcs[f] = el("path", { d, class: "fo-arc" }, tag);
      for (const a of [a1, a2]) {
        const [ax, ay] = P(R - 4, a), [bx, by] = P(R + 4, a);
        el("line", { x1: ax, y1: ay, x2: bx, y2: by, class: "fo-tick" }, tag);
      }
      const mid = (a1 + a2) / 2; const [lx, ly] = P(RL, mid); const c = Math.cos(mid);
      el("circle", { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 26, class: "hit" }, tag);
      const t = el("text", { x: lx.toFixed(1), y: (ly + 4).toFixed(1), class: "fo-label",
        "text-anchor": c > .35 ? "start" : c < -.35 ? "end" : "middle" }, tag);
      const n = (foCount[f] || 0) * SEATS_PER_REGION;
      t.innerHTML = `${f}<tspan class="fo-count" dx="6">${n}</tspan>`;
      const title = el("title", {}, tag); title.textContent = `${FO_NAMES[f]} федеральный округ: ${n} ${seatsWord(n)}. Нажмите, чтобы закрепить выделение`;
      foTags[f] = tag;
    });
  }

  const activeFO = () => state.foPreview || state.fo;
  function selectFO(f) { state.fo = state.fo === f ? null : f; applyFO(); }
  function previewFO(f) { if (state.foPreview === f) return; state.foPreview = f; applyFO(); }
  function applyFO() {
    const af = activeFO();
    for (const r of regions) {
      const on = !!af && r.fo === af && visible(r);
      r.seats.forEach(g => g.classList.toggle("fosel", on));
      r.path.classList.toggle("fosel", on);
    }
    gSeats.classList.toggle("fodim", !!af);
    gRegions.classList.toggle("fodim", !!af);
    for (const f in foTags) {
      foTags[f].classList.toggle("sel", f === af); foTags[f].classList.toggle("pinned", f === state.fo);
      foArcs[f] && foArcs[f].classList.toggle("sel", f === af);
    }
    senateCenter();
  }

  /* ---------------- Дума (арка) ---------------- */
  const dv = $("#duma");
  const DUMA = { cx: 380, cy: 445, Rout: 350, Rin: 168, rows: 11, A: Math.PI, k: 0.31 };
  const gDSeats = el("g", { class: "seats", filter: "url(#softShadow)" }, dv);
  const dCount = el("text", { x: DUMA.cx, y: DUMA.cy - 56, "text-anchor": "middle", class: "hall-count" }, dv);
  const dSub = el("text", { x: DUMA.cx, y: DUMA.cy - 20, "text-anchor": "middle", class: "hall-sub" }, dv);
  const dQ = qmark(dv, "duma"); dQ.setAttribute("transform", `translate(${DUMA.cx},${DUMA.cy + 12})`);
  const dPool = [];

  function layoutDuma() {
    const T = totals(); const N = T.duma;
    const pts = arcLayout(DUMA, N);
    while (dPool.length < N) {
      const g = el("g", { class: "dseat off" }, gDSeats);
      g.style.transform = `translate(${DUMA.cx}px,${DUMA.cy}px)`;
      g._b = el("circle", { class: "bezel" }, g); g._p = el("circle", { class: "pearl" }, g);
      dPool.push(g);
    }
    dPool.forEach((g, i) => {
      g._b.setAttribute("r", (pts.rr + 1.2).toFixed(2)); g._p.setAttribute("r", pts.rr.toFixed(2));
      if (i < N) { const p = pts[i]; g.style.transform = `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`; g.classList.remove("off"); }
      else g.classList.add("off");
    });
    animateNumber(dCount, N);
    dSub.textContent = `${seatsWord(N)} в Думе`;
    if (math.ctx === "duma") renderMath();
  }

  /* ---------------- палаты ---------------- */
  function applyChamber() {
    const main = state.chamber; const left = main === "senate" ? "duma" : "senate";
    document.querySelectorAll(".chamber").forEach(c => {
      const n = c.dataset.chamber;
      c.classList.remove("pos-left", "pos-main", "pos-right");
      c.classList.add(n === main ? "pos-main" : n === left ? "pos-left" : "pos-right");
    });
    store.set("frp.chamber", main);
    if (main !== "senate" && (state.fo || state.foPreview)) { state.fo = state.foPreview = null; applyFO(); }
  }

  /* ---------------- карточка ---------------- */
  const card = $("#card"), pinCard = $("#pinCard");
  function pearlsSVG(n) {
    let s = `<svg viewBox="0 0 ${n * 24} 22">`;
    for (let i = 0; i < n; i++) s += `<g transform="translate(${12 + i * 24},11)"><circle r="9.6" fill="url(#brass)"/><circle r="8" fill="url(#pearl)"/></g>`;
    return s + "</svg>";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function cardHTML(r, pinned) {
    const T = totals();
    const fo = r.fo ? `${r.fo}${r.status ? " · " + esc(r.status) : ""}` : esc(r.status || "");
    let body;
    if (r.row) {
      const dens = r.pop && r.area ? r.pop / r.area : null;
      const share = r.pop && T.pop ? r.pop / T.pop * 100 : null;
      const ashare = r.area && T.area ? r.area / T.area * 100 : null;
      let rows = `
        <dt>Население</dt><dd>${fmt(r.pop)} чел.</dd>
        <dt>Доля населения</dt><dd>${fmt(share, 2)} %</dd>
        <dt>Площадь</dt><dd>${fmt(r.area)} км²</dd>
        <dt>Доля площади</dt><dd>${fmt(ashare, 2)} %</dd>
        <dt>Плотность</dt><dd>${fmt(dens, dens < 10 ? 2 : 1)} чел./км²</dd>
        <dt>Один сенатор на</dt><dd>${fmt(r.pop ? r.pop / SEATS_PER_REGION : null)} чел.</dd>`;
      for (const c of extraCols) if (r.row[c]) rows += `<dt>${esc(c)}</dt><dd>${esc(r.row[c])}</dd>`;
      body = `<dl class="card__rows">${rows}</dl>`;
    } else {
      body = `<p class="card__nodata">Нет данных в data.csv.</p>
        <p class="card__note">Добавьте строку с названием «${esc(r.name)}» — карточка подхватит её автоматически.</p>`;
    }
    const n = SEATS_PER_REGION;
    return `
      <p class="card__eyebrow"><span><em class="card__dot ${layerClass(r)}"></em>${fo}</span><i>${r.no ? "№ " + esc(r.no) : ""}</i></p>
      <h3 class="card__title">${esc(r.name)}</h3>
      ${body}
      <div class="card__seats"><span>Сенат</span><b>${n} ${plural(n, "сенатор", "сенатора", "сенаторов")} ${pearlsSVG(n)}</b></div>
      <div class="card__foot">${pinned ? "Закреплено · ПКМ или Esc — открепить" : "Клик — закрепить"}</div>`;
  }

  function placeCard(c, x, y) {
    const pad = 14, off = 18;
    const w = c.offsetWidth, h = c.offsetHeight;
    let left = x + off, top = y + off;
    if (left + w > innerWidth - pad) left = x - w - off;
    if (top + h > innerHeight - pad) top = y - h - off;
    left = Math.max(pad, Math.min(left, innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, innerHeight - h - pad));
    if (c === pinCard) { left += scrollX; top += scrollY; }
    c.style.left = left + "px"; c.style.top = top + "px";
  }

  /* ---------------- наведение / закрепление ---------------- */
  function litRegion(id, on, cls = "lit") {
    const r = byId.get(id); if (!r) return;
    r.seats.forEach(g => g.classList.toggle(cls, on));
    if (r.marker) r.marker.classList.toggle(cls === "lit" ? "lit" : "pin", on);
    const t = foTags[r.fo]; if (t && cls === "lit") t.classList.toggle("lit", on);
  }

  function setHover(id, ev) {
    if (id !== state.hover) {
      if (state.hover) litRegion(state.hover, false);
      if (liftEl) { const old = liftEl; old.classList.remove("up"); setTimeout(() => old.remove(), 180); liftEl = null; }
      state.hover = id;
      gSeats.classList.toggle("dim", !!id);
      if (id) {
        const r = byId.get(id);
        litRegion(id, true);
        if (id !== state.pinned) {
          liftEl = makeLift(r, gHover);
          requestAnimationFrame(() => requestAnimationFrame(() => liftEl && liftEl.classList.add("up")));
          card.innerHTML = cardHTML(r, false); card.classList.add("show");
        } else card.classList.remove("show");
      } else card.classList.remove("show");
    }
    if (id && ev && card.classList.contains("show")) placeCard(card, ev.clientX, ev.clientY);
  }

  let pinLift = null;
  function pin(id, x, y) {
    if (state.pinned === id) { placeCard(pinCard, x, y); return; }
    unpin();
    const r = byId.get(id); state.pinned = id;
    r.path.classList.add("pinned");
    litRegion(id, true, "pin");
    pinLift = makeLift(r, gPin, "pinned up");
    pinCard.innerHTML = cardHTML(r, true);
    pinCard.classList.add("show"); pinCard.setAttribute("aria-hidden", "false");
    placeCard(pinCard, x, y);
    if (liftEl && state.hover === id) { liftEl.remove(); liftEl = null; card.classList.remove("show"); }
  }
  function unpin() {
    if (!state.pinned) return false;
    const r = byId.get(state.pinned);
    r.path.classList.remove("pinned"); litRegion(state.pinned, false, "pin");
    if (pinLift) { pinLift.remove(); pinLift = null; }
    state.pinned = null;
    pinCard.classList.remove("show"); pinCard.setAttribute("aria-hidden", "true");
    return true;
  }
  const idFrom = (t) => { const n = t && t.closest && t.closest("[data-id]"); return n ? +n.dataset.id : null; };

  /* ---------------- масштаб / сдвиг ---------------- */
  const MIN_W = GEO.W / 5;
  function setView(v) {
    v.w = Math.max(MIN_W, Math.min(GEO.W, v.w)); v.h = v.w * GEO.H / GEO.W;
    v.x = Math.max(0, Math.min(GEO.W - v.w, v.x)); v.y = Math.max(0, Math.min(GEO.H - v.h, v.y));
    state.view = v;
    svg.setAttribute("viewBox", `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
    placeMarkers();
  }
  function zoomAt(factor, cxClient, cyClient) {
    const rect = svg.getBoundingClientRect(); const v = state.view;
    const fx = cxClient == null ? .5 : (cxClient - rect.left) / rect.width;
    const fy = cyClient == null ? .5 : (cyClient - rect.top) / rect.height;
    const ux = v.x + fx * v.w, uy = v.y + fy * v.h;
    const w = Math.max(MIN_W, Math.min(GEO.W, v.w / factor)); const h = w * GEO.H / GEO.W;
    setView({ x: ux - fx * w, y: uy - fy * h, w, h });
  }

  /* ---------------- ползунок состава ---------------- */
  const slider = $("#slider"), rail = slider.querySelector(".slider__rail"), knob = $("#sliderKnob"), fill = $("#sliderFill");
  const STOP_H = 72;
  function stopY(v) { return STOP_H / 2 + v * STOP_H - 6; }
  function renderSlider(yOverride) {
    const y = yOverride != null ? yOverride : stopY(state.level);
    knob.style.top = y + "px"; fill.style.height = Math.max(0, y - 3) + "px";
    rail.style.height = (STOP_H * 3 - 12) + "px";
    slider.querySelectorAll(".slider__stop").forEach(s => s.style.top = stopY(+s.dataset.v) + "px");
    slider.querySelectorAll(".slider__labels li").forEach(li => {
      const v = +li.dataset.v; li.classList.toggle("cur", v === state.level); li.classList.toggle("inc", v <= state.level);
    });
    slider.setAttribute("aria-valuenow", state.level);
    slider.setAttribute("aria-valuetext", slider.querySelector(`li[data-v="${state.level}"]`).textContent.trim());
  }
  function setLevel(v) {
    v = Math.max(0, Math.min(2, v));
    if (v === state.level) { renderSlider(); return; }
    state.level = v; store.set("frp.level", v);
    renderSlider(); update();
  }
  function bindSlider() {
    let drag = false;
    const yToLevel = (clientY) => Math.round((clientY - rail.getBoundingClientRect().top - stopY(0)) / STOP_H);
    rail.addEventListener("pointerdown", (e) => { drag = true; slider.classList.add("dragging"); rail.setPointerCapture(e.pointerId); move(e); });
    const move = (e) => {
      if (!drag) return;
      const y = Math.max(stopY(0), Math.min(stopY(2), e.clientY - rail.getBoundingClientRect().top));
      renderSlider(y);
    };
    rail.addEventListener("pointermove", move);
    const end = (e) => { if (!drag) return; drag = false; slider.classList.remove("dragging"); setLevel(yToLevel(e.clientY)); renderSlider(); };
    rail.addEventListener("pointerup", end); rail.addEventListener("pointercancel", end);
    slider.querySelectorAll(".slider__labels li").forEach(li => li.addEventListener("click", () => setLevel(+li.dataset.v)));
    slider.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowRight"].includes(e.key)) { setLevel(state.level + 1); e.preventDefault(); }
      if (["ArrowUp", "ArrowLeft"].includes(e.key)) { setLevel(state.level - 1); e.preventDefault(); }
    });
  }

  /* ---------------- события ---------------- */
  function bind() {
    let drag = null, dragged = false;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, v: { ...state.view } }; dragged = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) > 4 && state.view.w < GEO.W) { dragged = true; svg.classList.add("dragging"); setHover(null); }
      if (dragged) {
        const rect = svg.getBoundingClientRect(); const k = drag.v.w / rect.width;
        setView({ x: drag.v.x - dx * k, y: drag.v.y - dy * k, w: drag.v.w, h: drag.v.h });
      }
    });
    window.addEventListener("pointerup", () => { drag = null; svg.classList.remove("dragging"); });

    svg.addEventListener("pointermove", (e) => { if (!dragged || !drag) setHover(idFrom(e.target), e); });
    svg.addEventListener("pointerleave", () => setHover(null));
    svg.addEventListener("click", (e) => {
      if (dragged) { dragged = false; return; }
      const id = idFrom(e.target); if (id) pin(id, e.clientX, e.clientY);
    });
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY);
      setHover(idFrom(document.elementFromPoint(e.clientX, e.clientY)), e);
    }, { passive: false });
    $("#zIn").addEventListener("click", () => zoomAt(1.6));
    $("#zOut").addEventListener("click", () => zoomAt(1 / 1.6));
    $("#zReset").addEventListener("click", () => setView({ x: 0, y: 0, w: GEO.W, h: GEO.H }));

    // места Сената
    gSeats.addEventListener("pointermove", (e) => setHover(idFrom(e.target), e));
    gSeats.addEventListener("pointerleave", () => setHover(null));
    gSeats.addEventListener("click", (e) => { const id = idFrom(e.target); if (id) pin(id, e.clientX, e.clientY); });
    // округа у подковы
    gArcs.addEventListener("click", (e) => { const t = e.target.closest(".fo-tag"); if (t) { state.foPreview = null; selectFO(t.dataset.fo); } });
    gArcs.addEventListener("pointerover", (e) => { const t = e.target.closest(".fo-tag"); previewFO(t ? t.dataset.fo : null); });
    gArcs.addEventListener("pointerleave", () => previewFO(null));
    gArcs.addEventListener("keydown", (e) => {
      const t = e.target.closest && e.target.closest(".fo-tag");
      if (t && (e.key === "Enter" || e.key === " ")) { selectFO(t.dataset.fo); e.preventDefault(); }
    });

    // ПКМ / Esc: сначала открепляем карточку, затем снимаем выделение округа
    const reset = () => {
      if (math.pinned) { hideMath(); return true; }
      if (unpin()) return true;
      if (state.fo) { state.fo = null; applyFO(); return true; }
      return false;
    };
    document.addEventListener("contextmenu", (e) => { if (state.pinned || state.fo || math.pinned) { e.preventDefault(); reset(); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); reset(); } });

    // палаты
    document.querySelectorAll(".chamber").forEach(c => c.querySelector(".chamber__mini").addEventListener("click", () => {
      const n = c.dataset.chamber;
      if (n === "veche") return toast("Вече — в разработке.");
      state.chamber = n; hideMath(); applyChamber();
    }));

    // меню
    const burger = $("#burger"), drawer = $("#drawer");
    burger.addEventListener("click", () => {
      const open = !drawer.classList.contains("open");
      drawer.classList.toggle("open", open); burger.setAttribute("aria-expanded", open); drawer.setAttribute("aria-hidden", !open);
    });
    closeDrawer = () => { drawer.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); drawer.setAttribute("aria-hidden", "true"); };
  }
  let closeDrawer = () => {};

  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400);
  }

  /* ---------------- малые иконки палат ---------------- */
  function dot(parent, x, y, r = 2.6, gem = "url(#pearl)") {
    const g = el("g", { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` }, parent);
    el("circle", { r, fill: "url(#brass)" }, g); el("circle", { r: r * .73, fill: gem }, g);
  }
  function drawIcons() {
    const duma = $("#iconDuma");
    arcLayout({ cx: 60, cy: 64, Rin: 20, Rout: 54, rows: 5, A: Math.PI }, 72).forEach(p => dot(duma, p.x, p.y, 2.5));
    const sen = $("#iconSenate");
    arcLayout({ cx: 60, cy: 38, Rin: 14, Rout: 31, rows: 4, A: Math.PI * 1.3 }, 58).forEach(p => dot(sen, p.x, p.y, 2.5));
    const veche = $("#iconVeche");
    for (const [n, r] of [[24, 31], [17, 22], [10, 13]]) for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      dot(veche, 60 + r * Math.cos(a), 35 + r * Math.sin(a), 2.5);
    }
    dot(veche, 60, 35, 4.6, "url(#sapphire)");
  }

  /* ---------------- сводка ---------------- */
  function updateStats() {
    const T = totals();
    $("#sRegions").textContent = T.list.length;
    $("#sSeats").textContent = T.seats;
    $("#sDuma").textContent = T.duma || "—";
    renderLegend();
    $("#sPop").textContent = T.pop ? fmt(T.pop / 1e6, 1) + " млн" : "—";
    $("#sPer").textContent = T.withPop.length ? fmt(T.pop / (T.withPop.length * SEATS_PER_REGION)) : "—";
    $("#sPerDuma").textContent = T.duma ? fmt(T.pop / T.duma) : "—";
    $("#miniSenate").textContent = `${T.seats} ${seatsWord(T.seats)}`;
    $("#miniDuma").textContent = `${T.duma} ${seatsWord(T.duma)}`;
    const missing = T.list.length - T.withPop.length;
    $("#footnote").textContent = missing
      ? `* без ${missing} ${plural(missing, "региона", "регионов", "регионов")}, для которых нет строк в data.csv`
      : "* по данным data.csv";
    // подписи ползунка
    const count = (lv) => regions.filter(r => r.group === "core" || (r.group === "crimea" && LEVELS[lv].crimea) || (r.group === "new" && LEVELS[lv].new)).length;
    const details = ["После объединения регионов", "Присоединение Республики Крым и Севастополя", "Присоединение ДНР, ЛНР, Запорожской и Херсонской областей"];
    for (let lv = 0; lv < 3; lv++) {
      const n = count(lv);
      $("#lv" + lv).innerHTML = (details[lv] ? `${details[lv]} · ` : "") +
        `<b>${n} ${regionsWord(n)}, ${n * SEATS_PER_REGION} ${seatsWord(n * SEATS_PER_REGION)}</b>`;
    }
  }

  function update() {
    applyVisibility();
    layoutSenate();
    layoutDuma();
    updateStats();
    if (state.pinned) pinCard.innerHTML = cardHTML(byId.get(state.pinned), true);
  }

  /* ---------------- старт ---------------- */
  (async () => {
    attachData(await loadCSV());
    buildMap(); buildSeats(); drawIcons(); bind(); bindSlider(); bindMath();
    applyChamber(); renderSlider();
    buildLayerDefs(); applyMode();
    document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => { state.mode = b.dataset.mode; applyMode(); }));
    const legend = $("#legend");
    legend.addEventListener("pointerover", (e) => { const li = e.target.closest("li"); highlightLayer(li && !li.classList.contains("empty") ? li.dataset.k : null); });
    legend.addEventListener("pointerleave", () => highlightLayer(null));
    requestAnimationFrame(update);
  })();
})();
