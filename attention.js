/* attention.js — renderer for `kind: "attention"` JSONs.
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
    const N = m.N;
    if (m.rows.length !== N || m.cols.length !== N || m.mask.length !== N) {
      showError(`matrix ${matIdx}: size mismatch (N=${N}, rows=${m.rows.length}, cols=${m.cols.length}, mask=${m.mask.length}).`);
      return;
    }

    const numRowDocs = (new Set(m.rows.map(r => r.doc).filter(d => d != null))).size;
    const visibleCount = m.mask.flat().reduce((a, b) => a + b, 0);
    els.info.textContent = `${m.name}  |  N=${N}  |  docs=${numRowDocs || 1}  |  visible cells = ${visibleCount} / ${N * N}`;

    els.scroll.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "att-grid";
    grid.style.gridTemplateColumns =
      `var(--att-label-w) repeat(${N}, var(--att-cell-size))`;
    grid.style.gridTemplateRows =
      `var(--att-label-h) repeat(${N}, var(--att-cell-size))`;

    // top-left corner
    const corner = document.createElement("div");
    corner.className = "att-corner";
    grid.appendChild(corner);

    // column labels (top row)
    for (let k = 0; k < N; k++) {
      const c = m.cols[k];
      const el = document.createElement("div");
      el.className = "att-col-label";
      if (c.is_bos) el.classList.add("att-bos");
      if (k < N - 1 && m.cols[k + 1].doc != null && c.doc != null && m.cols[k + 1].doc !== c.doc) {
        el.classList.add("att-doc-bound-right");
      }
      el.textContent = c.label ?? String(k + 1);
      el.title = `col ${k}: ${c.label}`;
      grid.appendChild(el);
    }

    // body rows (left label + N cells each)
    for (let q = 0; q < N; q++) {
      const r = m.rows[q];
      const lbl = document.createElement("div");
      lbl.className = "att-row-label";
      if (r.is_bos) lbl.classList.add("att-bos");
      if (q < N - 1 && m.rows[q + 1].doc != null && r.doc != null && m.rows[q + 1].doc !== r.doc) {
        lbl.classList.add("att-doc-bound-bot");
      }
      lbl.textContent = r.label ?? String(q + 1);
      grid.appendChild(lbl);

      for (let k = 0; k < N; k++) {
        const c = m.cols[k];
        const cell = document.createElement("div");
        cell.className = "att-cell";
        if (m.mask[q][k]) cell.classList.add("att-vis");
        if (k < N - 1 && m.cols[k + 1].doc != null && c.doc != null && m.cols[k + 1].doc !== c.doc) {
          cell.classList.add("att-doc-bound-right");
        }
        if (q < N - 1 && m.rows[q + 1].doc != null && r.doc != null && m.rows[q + 1].doc !== r.doc) {
          cell.classList.add("att-doc-bound-bot");
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

  function showTip(e, m, q, k) {
    const r = m.rows[q], c = m.cols[k];
    const vis = m.mask[q][k] === 1;
    let html =
      `<div><span class="k">q</span> <span class="v">${q}</span>`
      + ` <span class="k">→ k</span> <span class="v">${k}</span>`
      + ` &nbsp;<span class="${vis ? "v" : "k"}">${vis ? "VISIBLE" : "masked"}</span></div>`
      + `<div><span class="k">row</span> <span class="v">${esc(r.label ?? "")}</span>`
      + (r.doc != null ? ` <span class="k">doc</span> <span class="v">${r.doc}</span>` : "")
      + (r.is_bos ? ` <span class="special">BOS</span>` : "")
      + `</div>`
      + `<div><span class="k">col</span> <span class="v">${esc(c.label ?? "")}</span>`
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
