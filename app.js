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
    mode: store.get("frp.mode", "enamel") === "status" ? "status" : "enamel",
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

  /* ---------------- статусы субъектов ---------------- */
  const STATUSES = [
    { k: "gfz",  name: "Города федерального значения", c: ["#f3a0a6", "#c23a47", "#6a1420"] },
    { k: "krai", name: "Края",                         c: ["#f8c189", "#d1732a", "#723508"] },
    { k: "obl",  name: "Области",                      c: ["#f7e6a0", "#cfae3c", "#6f5a12"] },
    { k: "resp", name: "Республики",                   c: ["#a6e2bb", "#33925c", "#114628"] },
    { k: "ao",   name: "Автономные округа",            c: ["#bfe9f8", "#47a3cc", "#154e6c"] },
    { k: "aobl", name: "Автономная область",           c: ["#dcc0f4", "#8652bb", "#3a1c62"] }
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
  function buildStatusDefs() {
    const defs = document.querySelector("svg defs");
    for (const s of STATUSES) {
      const g = el("linearGradient", { id: "st-" + s.k, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
      [[0, s.c[0], .95], [.45, s.c[1], 1], [1, s.c[2], 1]].forEach(([o, c, a]) =>
        el("stop", { offset: o, "stop-color": c, "stop-opacity": a }, g));
    }
  }
  function applyMode() {
    document.body.classList.toggle("mode-status", state.mode === "status");
    document.querySelectorAll("#modeSeg button").forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
    });
    store.set("frp.mode", state.mode);
  }
  function renderLegend() {
    const list = regions.filter(visible);
    $("#legend").innerHTML = STATUSES.map(s => {
      const n = list.filter(r => r.st === s.k).length;
      return `<li data-st="${s.k}" class="st-${s.k}${n ? "" : " empty"}"><i class="legend__gem"></i><span>${s.name}</span><b>${n}</b></li>`;
    }).join("");
  }
  function highlightStatus(k) {
    gRegions.classList.toggle("stdim", !!k);
    for (const r of regions) r.path.classList.toggle("stsel", !!k && r.st === k);
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
    pts.rr = 0.43 * Math.min(dr, along);
    return pts;
  }

  /* ---------------- карта ---------------- */
  const svg = $("#map"), gRegions = $("#regions"), gBorders = $("#borders"),
        gHover = $("#hoverLayer"), gPin = $("#pinLayer"), gMarkers = $("#markers");
  const borders = {};

  function buildMap() {
    for (const r of regions) r.path = el("path", { d: r.d, class: "region" + (r.st ? " st-" + r.st : ""), "data-id": r.id }, gRegions);
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
    const p = el("path", { d: r.d, class: "lift" + (r.st ? " st-" + r.st : "") + (extra ? " " + extra : "") }, layer);
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
    let i = 0; const foRange = {}; foCount = {};
    for (const r of regions) if (!visible(r)) r.seats.forEach(g => g.classList.add("off"));
    for (const r of list) {
      foCount[r.fo] = (foCount[r.fo] || 0) + 1;
      for (const g of r.seats) {
        const p = pts[i++];
        g.style.transform = `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`;
        g.classList.remove("off");
        const fr = foRange[r.fo] || (foRange[r.fo] = { hi: -Infinity, lo: Infinity });
        fr.hi = Math.max(fr.hi, p.phi); fr.lo = Math.min(fr.lo, p.phi);
      }
    }
    drawArcs(foRange);
    if (state.fo && !foCount[state.fo]) state.fo = null;
    applyFO();
  }

  function senateCenter() {
    const T = totals();
    if (state.fo) {
      const n = foCount[state.fo] || 0;
      animateNumber(sCount, n * SEATS_PER_REGION);
      sSub.textContent = `${seatsWord(n * SEATS_PER_REGION)} · ${state.fo}`;
      sSub2.textContent = `${FO_NAMES[state.fo]} округ · ${n} × ${SEATS_PER_REGION}`;
    } else {
      animateNumber(sCount, T.seats);
      sSub.textContent = `${seatsWord(T.seats)} в Сенате`;
      sSub2.textContent = `${T.list.length} ${plural(T.list.length, "регион", "региона", "регионов")} × ${SEATS_PER_REGION}`;
    }
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
      foArcs[f] = el("path", { d: `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`, class: "fo-arc" }, gArcs);
      for (const a of [a1, a2]) {
        const [ax, ay] = P(R - 4, a), [bx, by] = P(R + 4, a);
        el("line", { x1: ax, y1: ay, x2: bx, y2: by, class: "fo-tick" }, gArcs);
      }
      const mid = (a1 + a2) / 2; const [lx, ly] = P(RL, mid); const c = Math.cos(mid);
      const tag = el("g", { class: "fo-tag", "data-fo": f, tabindex: 0, role: "button" }, gArcs);
      el("circle", { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 26, class: "hit" }, tag);
      const t = el("text", { x: lx.toFixed(1), y: (ly + 4).toFixed(1), class: "fo-label",
        "text-anchor": c > .35 ? "start" : c < -.35 ? "end" : "middle" }, tag);
      const n = (foCount[f] || 0) * SEATS_PER_REGION;
      t.innerHTML = `${f}<tspan class="fo-count" dx="6">${n}</tspan>`;
      const title = el("title", {}, tag); title.textContent = `${FO_NAMES[f]} федеральный округ: ${n} ${seatsWord(n)}. Нажмите, чтобы выделить`;
      foTags[f] = tag;
    });
  }

  function selectFO(f) { state.fo = state.fo === f ? null : f; applyFO(); }
  function applyFO() {
    for (const r of regions) {
      const on = !!state.fo && r.fo === state.fo && visible(r);
      r.seats.forEach(g => g.classList.toggle("fosel", on));
      r.path.classList.toggle("fosel", on);
    }
    gSeats.classList.toggle("fodim", !!state.fo);
    gRegions.classList.toggle("fodim", !!state.fo);
    for (const f in foTags) { foTags[f].classList.toggle("sel", f === state.fo); foArcs[f] && foArcs[f].classList.toggle("sel", f === state.fo); }
    senateCenter();
  }

  /* ---------------- Дума (арка) ---------------- */
  const dv = $("#duma");
  const DUMA = { cx: 380, cy: 445, Rout: 348, Rin: 168, rows: 11, A: Math.PI };
  const gDSeats = el("g", { class: "seats", filter: "url(#softShadow)" }, dv);
  const dCount = el("text", { x: DUMA.cx, y: DUMA.cy - 56, "text-anchor": "middle", class: "hall-count" }, dv);
  const dSub = el("text", { x: DUMA.cx, y: DUMA.cy - 20, "text-anchor": "middle", class: "hall-sub" }, dv);
  const dSub2 = el("text", { x: DUMA.cx, y: DUMA.cy + 8, "text-anchor": "middle", class: "hall-sub2" }, dv);
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
    dSub2.textContent = T.pop ? `∛ ${fmt(T.pop / 1e6, 2)} млн = ${fmt(Math.cbrt(T.pop), 1)} ↑ ${N}` : "";
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
    if (main !== "senate" && state.fo) { state.fo = null; applyFO(); }
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
      <p class="card__eyebrow"><span><em class="card__dot${r.st ? " st-" + r.st : ""}"></em>${fo}</span><i>${r.no ? "№ " + esc(r.no) : ""}</i></p>
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
  const STOP_H = 66;
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
    slider.setAttribute("aria-valuetext", slider.querySelector(`li[data-v="${state.level}"] .slider__name`).textContent);
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
    gArcs.addEventListener("click", (e) => { const t = e.target.closest(".fo-tag"); if (t) selectFO(t.dataset.fo); });
    gArcs.addEventListener("keydown", (e) => {
      const t = e.target.closest && e.target.closest(".fo-tag");
      if (t && (e.key === "Enter" || e.key === " ")) { selectFO(t.dataset.fo); e.preventDefault(); }
    });

    // ПКМ / Esc: сначала открепляем карточку, затем снимаем выделение округа
    const reset = () => {
      if (unpin()) return true;
      if (state.fo) { state.fo = null; applyFO(); return true; }
      return false;
    };
    document.addEventListener("contextmenu", (e) => { if (state.pinned || state.fo) { e.preventDefault(); reset(); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); reset(); } });

    // палаты
    document.querySelectorAll(".chamber").forEach(c => c.querySelector(".chamber__mini").addEventListener("click", () => {
      const n = c.dataset.chamber;
      if (n === "veche") return toast("Вече — в разработке.");
      state.chamber = n; applyChamber();
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
    const subs = ["", "Республика Крым, г. Севастополь", "ДНР, ЛНР, Запорожская и Херсонская обл."];
    for (let lv = 0; lv < 3; lv++) {
      const n = count(lv);
      $("#lv" + lv).innerHTML = (subs[lv] ? subs[lv] + " · " : "") + `<b>${n} ${plural(n, "регион", "региона", "регионов")}, ${n * SEATS_PER_REGION} ${seatsWord(n * SEATS_PER_REGION)}</b>`;
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
    buildMap(); buildSeats(); drawIcons(); bind(); bindSlider();
    applyChamber(); renderSlider();
    buildStatusDefs(); applyMode();
    document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => { state.mode = b.dataset.mode; applyMode(); }));
    const legend = $("#legend");
    legend.addEventListener("pointerover", (e) => { const li = e.target.closest("li"); highlightStatus(li && !li.classList.contains("empty") ? li.dataset.st : null); });
    legend.addEventListener("pointerleave", () => highlightStatus(null));
    requestAnimationFrame(update);
  })();
})();
