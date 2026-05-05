/* rope.js — renderer for `kind: "rope"` JSONs.
   See SCHEMA-rope.md for the wire format. */

(function () {
  const els = {
    title:  document.getElementById("rope-title"),
    info:   document.getElementById("rope-info"),
    select: document.getElementById("rope-variant-select"),
    table:  document.getElementById("rope-table"),
    scroll: document.getElementById("rope-scroll"),
    error:  document.getElementById("rope-error"),
    tip:    document.getElementById("rope-tip"),
  };

  function showError(msg) {
    els.error.innerHTML = `<div class="lv-error">${esc(msg)}</div>`;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function fmt(n) {
    if (Number.isInteger(n)) return String(n);
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  async function load() {
    const tracePath = getQueryParam("trace");
    if (!tracePath) {
      showError("Missing ?trace=<path> query parameter.");
      return;
    }
    let doc;
    try {
      const res = await fetch(tracePath);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      doc = await res.json();
    } catch (e) {
      showError(`Failed to load ${tracePath}: ${e.message}`);
      return;
    }
    if (doc.kind !== "rope") {
      showError(`Expected kind="rope", got kind="${doc.kind}".`);
      return;
    }
    if (!doc.variants || doc.variants.length === 0) {
      showError("No variants in trace.");
      return;
    }
    document.title = `rope: ${doc.name || ""}`;
    els.title.textContent = doc.name || "(unnamed)";

    els.select.innerHTML = "";
    doc.variants.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = v.name || `variant ${i}`;
      els.select.appendChild(opt);
    });
    els.select.addEventListener("change", () => render(doc, +els.select.value));

    render(doc, 0);
  }

  function deriveDistance(tokens) {
    const N = tokens.length;
    const d = new Array(N);
    for (let i = 0; i < N; i++) {
      const row = new Array(N);
      const qi = tokens[i].q_pos;
      for (let j = 0; j < N; j++) {
        row[j] = qi - tokens[j].k_pos;
      }
      d[i] = row;
    }
    return d;
  }

  function colorForDistance(d, maxAbs) {
    if (maxAbs <= 0 || d === 0) return "rgba(255, 255, 255, 0.06)";
    const t = Math.min(1, Math.abs(d) / maxAbs);
    if (d > 0) {
      // warm: orange accent (220, 100, 30) — fade alpha by magnitude.
      const a = 0.18 + 0.72 * t;
      return `rgba(220, 100, 30, ${a.toFixed(3)})`;
    }
    // cool: blue (77, 140, 255)
    const a = 0.18 + 0.62 * t;
    return `rgba(77, 140, 255, ${a.toFixed(3)})`;
  }

  function render(doc, vIdx) {
    const v = doc.variants[vIdx];
    const N = v.N;
    if (!Array.isArray(v.tokens) || v.tokens.length !== N) {
      showError(`variant ${vIdx}: tokens.length=${(v.tokens || []).length} != N=${N}.`);
      return;
    }
    let dist = v.distance;
    if (dist == null) {
      dist = deriveDistance(v.tokens);
    } else if (dist.length !== N || dist.some(r => r.length !== N)) {
      showError(`variant ${vIdx}: distance must be ${N}×${N}.`);
      return;
    }

    let maxAbs = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = Math.abs(dist[i][j]);
        if (a > maxAbs) maxAbs = a;
      }
    }

    const numDocs = (new Set(v.tokens.map(t => t.doc).filter(d => d != null))).size;
    const derived = v.distance == null ? "derived" : "explicit";
    els.info.textContent =
      `${v.name}  |  N=${N}  |  docs=${numDocs || 1}  |  max |distance| = ${fmt(maxAbs)}  |  distance: ${derived}`;

    renderTable(v.tokens, N);
    renderHeatmap(v.tokens, dist, N, maxAbs);
    els.error.innerHTML = "";
  }

  function isDocBoundRight(tokens, k) {
    const N = tokens.length;
    if (k >= N - 1) return false;
    const a = tokens[k].doc, b = tokens[k + 1].doc;
    return a != null && b != null && a !== b;
  }

  function renderTable(tokens, N) {
    els.table.innerHTML = "";
    els.table.style.gridTemplateColumns =
      `var(--rope-label-w) repeat(${N}, var(--rope-cell-size))`;
    els.table.style.gridTemplateRows = `repeat(4, var(--rope-label-h))`;

    const rows = [
      { key: "label",   head: "label",   cls: "rope-attr-label", get: (t) => t.label ?? "" },
      { key: "abs_pos", head: "abs_pos", cls: "rope-attr-abs",   get: (t) => fmt(t.abs_pos) },
      { key: "q_pos",   head: "q_pos",   cls: "rope-attr-q",     get: (t) => fmt(t.q_pos) },
      { key: "k_pos",   head: "k_pos",   cls: "rope-attr-k",     get: (t) => fmt(t.k_pos) },
    ];

    for (const row of rows) {
      const head = document.createElement("div");
      head.className = "rope-table-rowhead";
      head.textContent = row.head;
      els.table.appendChild(head);

      for (let k = 0; k < N; k++) {
        const t = tokens[k];
        const cell = document.createElement("div");
        cell.className = `rope-table-cell ${row.cls}`;
        if (row.key === "label" && t.is_bos) cell.classList.add("rope-bos");
        if (isDocBoundRight(tokens, k)) cell.classList.add("rope-doc-bound-right");
        cell.textContent = row.get(t);
        cell.title = `${row.head}[${k}] = ${row.get(t)}`;
        els.table.appendChild(cell);
      }
    }
  }

  function renderHeatmap(tokens, dist, N, maxAbs) {
    els.scroll.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "rope-grid";
    grid.style.gridTemplateColumns =
      `var(--rope-label-w) repeat(${N}, var(--rope-cell-size))`;
    grid.style.gridTemplateRows =
      `var(--rope-label-h) repeat(${N}, var(--rope-cell-size))`;

    const corner = document.createElement("div");
    corner.className = "rope-corner";
    grid.appendChild(corner);

    for (let k = 0; k < N; k++) {
      const c = tokens[k];
      const el = document.createElement("div");
      el.className = "rope-col-label";
      if (c.is_bos) el.classList.add("rope-bos");
      if (isDocBoundRight(tokens, k)) el.classList.add("rope-doc-bound-right");
      el.textContent = c.label ?? String(k + 1);
      el.title = `col ${k}: ${c.label} (k_pos=${fmt(c.k_pos)})`;
      grid.appendChild(el);
    }

    for (let q = 0; q < N; q++) {
      const r = tokens[q];
      const lbl = document.createElement("div");
      lbl.className = "rope-row-label";
      if (r.is_bos) lbl.classList.add("rope-bos");
      if (isDocBoundRight(tokens, q)) lbl.classList.add("rope-doc-bound-bot");
      lbl.textContent = r.label ?? String(q + 1);
      lbl.title = `row ${q}: ${r.label} (q_pos=${fmt(r.q_pos)})`;
      grid.appendChild(lbl);

      for (let k = 0; k < N; k++) {
        const d = dist[q][k];
        const cell = document.createElement("div");
        cell.className = "rope-cell";
        cell.style.background = colorForDistance(d, maxAbs);
        if (isDocBoundRight(tokens, k)) cell.classList.add("rope-doc-bound-right");
        if (isDocBoundRight(tokens, q)) cell.classList.add("rope-doc-bound-bot");
        cell.textContent = fmt(d);
        cell.dataset.q = q;
        cell.dataset.k = k;
        cell.addEventListener("mouseenter", e => showTip(e, tokens, q, k, d));
        cell.addEventListener("mousemove", positionTip);
        cell.addEventListener("mouseleave", hideTip);
        grid.appendChild(cell);
      }
    }

    els.scroll.appendChild(grid);
  }

  function showTip(e, tokens, q, k, d) {
    const r = tokens[q], c = tokens[k];
    let html =
      `<div><span class="k">q</span> <span class="v">${q}</span>`
      + ` <span class="k">→ k</span> <span class="v">${k}</span>`
      + ` &nbsp;<span class="v">distance ${fmt(d)}</span></div>`
      + `<div><span class="k">row</span> <span class="v">${esc(r.label ?? "")}</span>`
      + ` <span class="k">abs</span> <span class="v">${fmt(r.abs_pos)}</span>`
      + ` <span class="k">q_pos</span> <span class="v">${fmt(r.q_pos)}</span>`
      + (r.doc != null ? ` <span class="k">doc</span> <span class="v">${r.doc}</span>` : "")
      + (r.is_bos ? ` <span class="special">BOS</span>` : "")
      + `</div>`
      + `<div><span class="k">col</span> <span class="v">${esc(c.label ?? "")}</span>`
      + ` <span class="k">abs</span> <span class="v">${fmt(c.abs_pos)}</span>`
      + ` <span class="k">k_pos</span> <span class="v">${fmt(c.k_pos)}</span>`
      + (c.doc != null ? ` <span class="k">doc</span> <span class="v">${c.doc}</span>` : "")
      + (c.is_bos ? ` <span class="special">BOS</span>` : "")
      + `</div>`;
    if (r.extra) html += `<div><span class="k">row.extra</span> <span class="v">${esc(r.extra)}</span></div>`;
    if (c.extra) html += `<div><span class="k">col.extra</span> <span class="v">${esc(c.extra)}</span></div>`;
    els.tip.innerHTML = html;
    els.tip.style.display = "block";
    positionTip(e);
  }
  function positionTip(e) {
    els.tip.style.left = (e.clientX + 14) + "px";
    els.tip.style.top  = (e.clientY + 14) + "px";
  }
  function hideTip() { els.tip.style.display = "none"; }

  load();
})();
