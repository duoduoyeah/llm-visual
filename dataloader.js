/* dataloader.js — renderer for `kind: "dataloader"` JSONs.
   See SCHEMA-dataloader.md for the wire format. */

(function () {
  const CELL_W_PX = 64;     // each token cell width

  const els = {
    title:  document.getElementById("dl-title"),
    info:   document.getElementById("dl-info"),
    select: document.getElementById("dl-row-select"),
    pages:  document.getElementById("dl-pages"),
    error:  document.getElementById("dl-error"),
    tip:    document.getElementById("dl-tip"),
  };

  function showError(msg) {
    els.error.innerHTML = `<div class="lv-error">${esc(msg)}</div>`;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderTokenText(s) {
    if (s === "" || s == null) return "∅";
    return s.replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t")
            .replace(/\r/g, "\\r")
            .replace(/ /g, "·");   // visible space
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
    if (doc.kind !== "dataloader") {
      showError(`Expected kind="dataloader", got kind="${doc.kind}". `
              + `Did you mean to open this in viewer.html?`);
      return;
    }
    if (!doc.rows || doc.rows.length === 0) {
      showError("No rows in trace.");
      return;
    }
    document.title = `dataloader: ${doc.name || ""}`;
    els.title.textContent = doc.name || "(unnamed)";

    // populate row dropdown
    els.select.innerHTML = "";
    doc.rows.forEach((row, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = row.name || `row ${i}`;
      els.select.appendChild(opt);
    });
    els.select.addEventListener("change", () => render(doc, +els.select.value));

    render(doc, 0);
  }

  function render(doc, rowIdx) {
    const row = doc.rows[rowIdx];
    const { vocab, vocab_meta = {} } = doc;
    const T = row.T;
    if (row.inputs.length !== T || row.targets.length !== T || row.doc_idx.length !== T) {
      showError(`Row ${rowIdx}: lengths mismatch (T=${T}, `
              + `inputs=${row.inputs.length}, targets=${row.targets.length}, `
              + `doc_idx=${row.doc_idx.length}).`);
      return;
    }

    // info bar
    const numDocs = (new Set(row.doc_idx)).size;
    const bosId = lookupBosId(vocab);
    const bosPositions = bosId == null ? []
      : row.inputs.map((t, i) => t === bosId ? i : -1).filter(i => i >= 0);
    els.info.textContent =
      `${row.name}  |  T=${T}  |  docs=${numDocs}  |  `
      + `BOS at ${bosPositions.length === 0 ? "(none)"
          : bosPositions.length <= 8 ? `[${bosPositions.join(", ")}]`
          : `[${bosPositions.slice(0,4).join(", ")} … ${bosPositions.slice(-2).join(", ")}] (${bosPositions.length})`}`;

    els.pages.innerHTML = "";
    for (const g of docGroups(row)) {
      const pageEl = renderPage(row, g, vocab, vocab_meta, bosId);
      els.pages.appendChild(pageEl);
    }
  }

  /* Split the row into one group per contiguous doc (constant doc_idx run). */
  function docGroups(row) {
    const groups = [];
    let cur = row.doc_idx[0], start = 0;
    for (let i = 1; i < row.T; i++) {
      if (row.doc_idx[i] !== cur) {
        groups.push({ doc: cur, start, end: i });
        cur = row.doc_idx[i];
        start = i;
      }
    }
    groups.push({ doc: cur, start, end: row.T });
    return groups;
  }

  function renderPage(row, g, vocab, vocab_meta, bosId) {
    const cols = g.end - g.start;
    const page = document.createElement("div");
    page.className = "dl-page";

    const head = document.createElement("div");
    head.className = "dl-page-head";
    head.textContent = `doc ${g.doc}  |  pos ${g.start} … ${g.end - 1}  |  N=${cols}`;
    page.appendChild(head);

    const scroll = document.createElement("div");
    scroll.className = "dl-page-scroll";

    // inputs row
    const rowIn = document.createElement("div");
    rowIn.className = "dl-row";
    rowIn.style.gridTemplateColumns = `auto repeat(${cols}, ${CELL_W_PX}px)`;
    const lblIn = document.createElement("div");
    lblIn.className = "dl-rowlabel";
    lblIn.textContent = "in";
    rowIn.appendChild(lblIn);
    for (let i = g.start; i < g.end; i++) {
      rowIn.appendChild(makeCell(row, i, "in", vocab, vocab_meta, bosId));
    }
    scroll.appendChild(rowIn);

    // targets row
    const rowTg = document.createElement("div");
    rowTg.className = "dl-row";
    rowTg.style.gridTemplateColumns = `auto repeat(${cols}, ${CELL_W_PX}px)`;
    const lblTg = document.createElement("div");
    lblTg.className = "dl-rowlabel";
    lblTg.textContent = "tg";
    rowTg.appendChild(lblTg);
    for (let i = g.start; i < g.end; i++) {
      rowTg.appendChild(makeCell(row, i, "tg", vocab, vocab_meta, bosId));
    }
    scroll.appendChild(rowTg);

    page.appendChild(scroll);
    return page;
  }

  function makeCell(row, i, which, vocab, vocab_meta, bosId) {
    const tid = which === "in" ? row.inputs[i] : row.targets[i];
    const docId = row.doc_idx[i];
    const cell = document.createElement("div");
    cell.className = "dl-cell dl-row-" + which
      + (docId % 2 === 0 ? " dl-doc-even" : " dl-doc-odd");

    if (tid === -1) {
      cell.classList.add("dl-no-target");
      cell.textContent = "—";
    } else {
      const text = vocab[String(tid)] ?? `?id${tid}`;
      const isSpecial = vocab_meta[String(tid)]?.is_special;
      const isBos = (bosId != null && tid === bosId);
      if (isBos && which === "in") cell.classList.add("dl-bos");
      if (isSpecial) cell.classList.add("dl-special");
      cell.textContent = renderTokenText(text);
    }

    cell.addEventListener("mouseenter", e => showTip(e, row, i, vocab, vocab_meta));
    cell.addEventListener("mousemove", positionTip);
    cell.addEventListener("mouseleave", hideTip);
    return cell;
  }

  function lookupBosId(vocab) {
    for (const [id, txt] of Object.entries(vocab)) {
      if (txt === "<|bos|>") return parseInt(id, 10);
    }
    return null;
  }

  function showTip(e, row, i, vocab, vocab_meta) {
    const inId = row.inputs[i], tgId = row.targets[i];
    const inText = inId === -1 ? "(no target)" : (vocab[String(inId)] ?? `?id${inId}`);
    const tgText = tgId === -1 ? "(no target)" : (vocab[String(tgId)] ?? `?id${tgId}`);
    const inSpec = vocab_meta[String(inId)]?.is_special;
    const tgSpec = vocab_meta[String(tgId)]?.is_special;
    els.tip.innerHTML =
      `<div><span class="k">pos</span> <span class="v">${i}</span>`
      + `&nbsp;&nbsp;<span class="k">doc</span> <span class="v">${row.doc_idx[i]}</span></div>`
      + `<div><span class="k">in </span> <span class="v ${inSpec ? "special" : ""}">${esc(JSON.stringify(inText))}</span> <span class="k">id=${inId}</span></div>`
      + `<div><span class="k">tg </span> <span class="v ${tgSpec ? "special" : ""}">${esc(JSON.stringify(tgText))}</span> <span class="k">id=${tgId}</span></div>`;
    els.tip.style.display = "block";
    positionTip(e);
  }
  function positionTip(e) {
    const x = e.clientX + 14, y = e.clientY + 14;
    els.tip.style.left = x + "px";
    els.tip.style.top  = y + "px";
  }
  function hideTip() { els.tip.style.display = "none"; }

  load();
})();
