/* attention.js - renderer for `kind: "attention"` JSONs.
   See SCHEMA-attention.md for the wire format. */

(function () {
  const els = {
    title:  document.getElementById("att-title"),
    info:   document.getElementById("att-info"),
    select: document.getElementById("att-matrix-select"),
    scroll: document.getElementById("att-scroll"),
    error:  document.getElementById("att-error"),
    tip:    document.getElementById("att-tip"),
  };

  const THREAD_COLORS = [
    "#ffd23f", "#53c6d1", "#f28b82", "#81c995",
    "#c58af9", "#ffb86c", "#8ab4f8", "#a3e635",
  ];

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
    if (doc.kind !== "attention") {
      showError(`Expected kind="attention", got kind="${doc.kind}".`);
      return;
    }
    if (!doc.matrices || doc.matrices.length === 0) {
      showError("No matrices in trace.");
      return;
    }
    document.title = `attention: ${doc.name || ""}`;
    els.title.textContent = doc.name || "(unnamed)";

    els.select.innerHTML = "";
    doc.matrices.forEach((m, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = m.name || `matrix ${i}`;
      els.select.appendChild(opt);
    });
    els.select.addEventListener("change", () => render(doc, +els.select.value));

    render(doc, 0);
  }

  function render(doc, matIdx) {
    const m = doc.matrices[matIdx];
    const Nq = m.rows.length;
    const Nk = m.cols.length;
    if (!sameShape(m.mask, Nq, Nk)) {
      showError(`matrix ${matIdx}: shape mismatch (rows=${Nq}, cols=${Nk}, mask=${shapeLabel(m.mask)}).`);
      return;
    }

    const hasWeights = Array.isArray(m.weights);
    if (hasWeights && !sameShape(m.weights, Nq, Nk)) {
      showError(`matrix ${matIdx}: shape mismatch (rows=${Nq}, cols=${Nk}, weights=${shapeLabel(m.weights)}).`);
      return;
    }

    const numRowDocs = (new Set(m.rows.map(r => r.doc).filter(d => d != null))).size;
    const visibleCount = sumMatrix(m.mask);
    const sizeLabel = Nq === Nk ? `N=${Nq}` : `N_q=${Nq} x N_k=${Nk}`;
    let info = `${m.name}  |  ${sizeLabel}  |  docs=${numRowDocs || 1}  |  visible cells = ${visibleCount} / ${Nq * Nk}`;
    if (hasWeights) {
      const stats = weightStats(m.weights);
      info += `  |  nonzero weights = ${stats.nonzero}  |  max weight = ${formatWeight(stats.max)}`;
    }
    els.info.textContent = info;

    const hasCellLabels =
      Array.isArray(m.cell_labels) && m.cell_labels.length === Nq;

    els.scroll.innerHTML = "";
    els.error.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = hasWeights ? "att-grid att-grid-weighted" : "att-grid att-grid-mask";
    grid.style.gridTemplateColumns =
      `var(--att-label-w) repeat(${Nk}, var(--att-cell-size))`;
    grid.style.gridTemplateRows =
      `var(--att-label-h) repeat(${Nq}, var(--att-cell-size))`;

    const corner = document.createElement("div");
    corner.className = "att-corner";
    grid.appendChild(corner);

    for (let k = 0; k < Nk; k++) {
      const c = m.cols[k];
      const el = document.createElement("div");
      el.className = "att-col-label";
      if (c.is_bos) el.classList.add("att-bos");
      decorateAxisLabel(el, c);
      if (k < Nk - 1 && m.cols[k + 1].doc != null && c.doc != null && m.cols[k + 1].doc !== c.doc) {
        el.classList.add("att-doc-bound-right");
      }
      el.textContent = c.label ?? String(k + 1);
      el.title = axisTitle("col", k, c);
      grid.appendChild(el);
    }

    for (let q = 0; q < Nq; q++) {
      const r = m.rows[q];
      const lbl = document.createElement("div");
      lbl.className = "att-row-label";
      if (r.is_bos) lbl.classList.add("att-bos");
      decorateAxisLabel(lbl, r);
      if (q < Nq - 1 && m.rows[q + 1].doc != null && r.doc != null && m.rows[q + 1].doc !== r.doc) {
        lbl.classList.add("att-doc-bound-bot");
      }
      lbl.textContent = r.label ?? String(q + 1);
      lbl.title = axisTitle("row", q, r);
      grid.appendChild(lbl);

      for (let k = 0; k < Nk; k++) {
        const c = m.cols[k];
        const cell = document.createElement("div");
        cell.className = "att-cell";
        const visible = m.mask[q][k] === 1;
        const weight = hasWeights ? Number(m.weights[q][k]) : 0;
        if (hasWeights) {
          if (visible && Number.isFinite(weight) && weight > 0) {
            cell.classList.add("att-weight");
            cell.style.setProperty("--att-weight-alpha", weightOpacity(weight));
          }
        } else if (visible) {
          cell.classList.add("att-vis");
        }
        if (k < Nk - 1 && m.cols[k + 1].doc != null && c.doc != null && m.cols[k + 1].doc !== c.doc) {
          cell.classList.add("att-doc-bound-right");
        }
        if (q < Nq - 1 && m.rows[q + 1].doc != null && r.doc != null && m.rows[q + 1].doc !== r.doc) {
          cell.classList.add("att-doc-bound-bot");
        }
        if (hasCellLabels) {
          const txt = m.cell_labels[q][k];
          if (txt) cell.textContent = txt;
        }
        cell.dataset.q = q;
        cell.dataset.k = k;
        cell.addEventListener("mouseenter", e => showTip(e, m, q, k));
        cell.addEventListener("mousemove", positionTip);
        cell.addEventListener("mouseleave", hideTip);
        grid.appendChild(cell);
      }
    }

    els.scroll.appendChild(grid);
  }

  function sameShape(matrix, rows, cols) {
    return Array.isArray(matrix)
      && matrix.length === rows
      && matrix.every(row => Array.isArray(row) && row.length === cols);
  }
  function shapeLabel(matrix) {
    if (!Array.isArray(matrix)) return "not an array";
    return `${matrix.length}x${Array.isArray(matrix[0]) ? matrix[0].length : "?"}`;
  }
  function sumMatrix(matrix) {
    return matrix.reduce((sum, row) => sum + row.reduce((a, b) => a + Number(b || 0), 0), 0);
  }
  function weightStats(weights) {
    let max = 0, nonzero = 0;
    for (const row of weights) {
      for (const value of row) {
        const w = Number(value);
        if (!Number.isFinite(w) || w <= 0) continue;
        nonzero += 1;
        if (w > max) max = w;
      }
    }
    return { max, nonzero };
  }
  function weightOpacity(weight) {
    const w = Math.max(0, Math.min(1, Number(weight) || 0));
    return String(Math.min(0.96, 0.08 + 0.88 * Math.sqrt(w)).toFixed(3));
  }
  function formatWeight(weight) {
    const w = Number(weight);
    if (!Number.isFinite(w) || w === 0) return "0";
    if (Math.abs(w) >= 0.001) {
      return w.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    }
    return w.toExponential(2);
  }
  function threadColor(thread) {
    const idx = Number(thread);
    if (!Number.isInteger(idx)) return "";
    return THREAD_COLORS[((idx % THREAD_COLORS.length) + THREAD_COLORS.length) % THREAD_COLORS.length];
  }
  function decorateAxisLabel(el, entry) {
    const color = threadColor(entry.thread);
    if (!color) return;
    el.classList.add("att-threaded");
    el.style.color = color;
  }
  function axisTitle(kind, idx, a) {
    const parts = [`${kind} ${idx}: ${a.label ?? ""}`];
    if (a.doc != null) parts.push(`doc ${a.doc}`);
    if (a.thread != null) parts.push(`thread ${a.thread}`);
    if (a.local_step != null) parts.push(`step ${a.local_step}`);
    return parts.join(" | ");
  }

  function showTip(e, m, q, k) {
    const r = m.rows[q], c = m.cols[k];
    const vis = m.mask[q][k] === 1;
    const hasWeights = Array.isArray(m.weights);
    const weight = hasWeights ? Number(m.weights[q][k]) : null;
    let html =
      `<div><span class="k">q</span> <span class="v">${q}</span>`
      + ` <span class="k">-&gt; k</span> <span class="v">${k}</span>`
      + ` &nbsp;<span class="${vis ? "v" : "k"}">${vis ? "VISIBLE" : "masked"}</span></div>`;
    if (hasWeights) {
      html += `<div><span class="k">weight</span> <span class="v">${formatWeight(weight)}</span></div>`;
    }
    html += axisTip("row", r) + axisTip("col", c);
    if (r.extra) html += `<div><span class="k">row.extra</span> <span class="v">${esc(r.extra)}</span></div>`;
    if (c.extra) html += `<div><span class="k">col.extra</span> <span class="v">${esc(c.extra)}</span></div>`;
    els.tip.innerHTML = html;
    els.tip.style.display = "block";
    positionTip(e);
  }
  function axisTip(name, a) {
    let html = `<div><span class="k">${name}</span> <span class="v">${esc(a.label ?? "")}</span>`;
    if (a.doc != null) html += ` <span class="k">doc</span> <span class="v">${a.doc}</span>`;
    if (a.thread != null) html += ` <span class="k">thread</span> <span class="v">${a.thread}</span>`;
    if (a.local_step != null) html += ` <span class="k">step</span> <span class="v">${a.local_step}</span>`;
    if (a.is_bos) html += ` <span class="special">BOS</span>`;
    html += `</div>`;
    return html;
  }
  function positionTip(e) {
    els.tip.style.left = (e.clientX + 14) + "px";
    els.tip.style.top  = (e.clientY + 14) + "px";
  }
  function hideTip() { els.tip.style.display = "none"; }

  load();
})();
