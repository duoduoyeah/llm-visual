(function () {
  "use strict";

  // ------------------------------------------------------------
  // Config
  // ------------------------------------------------------------
  const CFG = {
    promptColor: "#b9a2db",
    currentColor: "#ffd84d", // brighter golden for the just-generated token
    rampStart: [255, 232, 153], // generated ramp: light yellow
    rampEnd: [212, 90, 20], //                  deep orange
    animMs: 8000, // total play duration cap
    minStepsPerSec: 4,
    // Per-thread base hues (HSL). Cycled by (thread_id - 1) % length.
    // thread_id 0 / absent uses the default ramp instead.
    threadHues: [180, 320, 80, 220, 30, 280, 140, 0],
    threadSat: 65,
    // Lightness ramps from threadL0 (early) → threadL1 (late) by gen_step.
    threadL0: 72,
    threadL1: 46,
  };
  const SPECIAL_TEXT_RE = /^<\|.+\|>$/;
  const SPECIAL_BREAK_TEXT = new Set(["<|eot|>"]);

  // ------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const titleEl = $("lv-title");
  const promptEl = $("lv-prompt");
  const selEl = $("lv-trace-select");
  const playBtn = $("lv-play");
  const prevBtn = $("lv-prev");
  const nextBtn = $("lv-next");
  const toggleStructuralBtn = $("lv-toggle-structural");
  const exportBtn = $("lv-export");
  const exportGifBtn = $("lv-export-gif");
  const sliderEl = $("lv-slider");
  const stepLabel = $("lv-step-label");
  const errorEl = $("lv-error");
  const tipEl = $("lv-tip");

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  let DOC = null;
  let TRACE = null;
  let LAYOUT = null;
  let currentStep = 0;
  let playing = false;
  let playTimer = null;
  let hideStructural = false;

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------
  function showError(msg) {
    errorEl.className = "lv-error";
    errorEl.textContent = msg;
  }
  function clearError() {
    errorEl.className = "";
    errorEl.textContent = "";
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  async function loadFromUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch " + url + ": " + res.status);
    return await res.json();
  }

  function isSpecial(vocabId) {
    if (!DOC) return false;
    if (DOC.vocab_meta) {
      const m = DOC.vocab_meta[String(vocabId)];
      if (m && m.is_special) return true;
    }
    // Fallback: any token whose text matches <|...|> is treated as special
    // even if vocab_meta forgot to mark it. Matches the schema's auto-detect rule.
    const text = DOC.vocab && DOC.vocab[String(vocabId)];
    return typeof text === "string" && SPECIAL_TEXT_RE.test(text);
  }

  // True when the renderer should insert a paragraph break AFTER this token.
  // Matches the schema's "break on either" rule:
  //   - role === "block_close", OR token text is exactly <|eot|>.
  // Newlines inside token text are handled separately (CSS pre-wrap / canvas split).
  function tokenForcesBreak(t) {
    if (t.role === "block_close") return true;
    const text = DOC && DOC.vocab && DOC.vocab[String(t.vocab_id)];
    return typeof text === "string" && SPECIAL_BREAK_TEXT.has(text);
  }

  // True if this trace carries any thread_id > 0 (enables thread-tint mode).
  function traceHasThreads(trace) {
    for (const t of trace.tokens) {
      if (typeof t.thread_id === "number" && t.thread_id > 0) return true;
    }
    return false;
  }

  function threadColor(threadId, gen_step, maxStep) {
    if (typeof threadId !== "number" || threadId <= 0) return null;
    const hue =
      CFG.threadHues[(threadId - 1) % CFG.threadHues.length];
    const tt = maxStep <= 1 ? 0 : Math.max(0, (gen_step - 1) / (maxStep - 1));
    const L = Math.round(CFG.threadL0 + (CFG.threadL1 - CFG.threadL0) * tt);
    return `hsl(${hue}, ${CFG.threadSat}%, ${L}%)`;
  }

  // ------------------------------------------------------------
  // Layout: walk tokens by gen_step. Each `abs` token has a permanent
  // signed column; `between` tokens get the midpoint of their anchor
  // columns. `cur` is the ordered (by column) list of visible token ids.
  // ------------------------------------------------------------
  function computeLayout(trace) {
    const tokensById = Object.create(null);
    for (const t of trace.tokens) tokensById[t.id] = t;

    const byStep = new Map();
    let maxStep = 0;
    for (const t of trace.tokens) {
      if (!byStep.has(t.gen_step)) byStep.set(t.gen_step, []);
      byStep.get(t.gen_step).push(t);
      if (t.gen_step > maxStep) maxStep = t.gen_step;
    }

    const colById = Object.create(null);
    const sequences = [];
    let cur = [];
    const sortByCol = (a, b) => colById[a] - colById[b];

    for (let step = 0; step <= maxStep; step++) {
      const newOnes = byStep.get(step) || [];
      const abs = newOnes.filter((t) => "abs" in t.position);
      const bet = newOnes.filter((t) => "between" in t.position);

      // 1) Place abs tokens at their permanent (signed) columns.
      for (const t of abs) {
        const c = t.position.abs;
        if (typeof c !== "number" || !Number.isFinite(c)) {
          throw new Error(
            "step " + step + ": token " + t.id + " has non-numeric abs",
          );
        }
        colById[t.id] = c;
        cur.push(t.id);
      }
      cur.sort(sortByCol);

      // detect column collisions across all placed tokens
      for (let i = 1; i < cur.length; i++) {
        if (colById[cur[i]] === colById[cur[i - 1]]) {
          throw new Error(
            "step " +
              step +
              ": tokens " +
              cur[i - 1] +
              " and " +
              cur[i] +
              " share column " +
              colById[cur[i]],
          );
        }
      }

      // 2) Validate between tokens: anchors from earlier steps, no duplicate pairs.
      const seen = new Map();
      for (const t of bet) {
        const k = t.position.between.join("|");
        if (seen.has(k)) {
          throw new Error(
            "step " +
              step +
              ": multiple tokens claim position [" +
              t.position.between.join(",") +
              "]: " +
              seen.get(k) +
              ", " +
              t.id,
          );
        }
        seen.set(k, t.id);
      }

      // 3) Place between tokens with col = midpoint of anchor cols.
      for (const t of bet) {
        const [aId, bId] = t.position.between;
        if (!(aId in colById) || !(bId in colById)) {
          throw new Error(
            "step " +
              step +
              ": token " +
              t.id +
              " anchors [" +
              aId +
              "," +
              bId +
              "] not in current sequence",
          );
        }
        if (
          tokensById[aId].gen_step >= step ||
          tokensById[bId].gen_step >= step
        ) {
          throw new Error(
            "step " +
              step +
              ": token " +
              t.id +
              " anchors must come from strictly earlier steps",
          );
        }
        const ai = cur.indexOf(aId);
        const bi = cur.indexOf(bId);
        if (bi !== ai + 1) {
          throw new Error(
            "step " +
              step +
              ": token " +
              t.id +
              " anchors [" +
              aId +
              "," +
              bId +
              "] not adjacent (positions " +
              ai +
              "," +
              bi +
              ")",
          );
        }
        colById[t.id] = (colById[aId] + colById[bId]) / 2;
        cur.push(t.id);
      }
      cur.sort(sortByCol);

      sequences.push(cur.slice());
    }

    let maxLen = 0;
    for (const s of sequences) if (s.length > maxLen) maxLen = s.length;

    return { sequences, maxStep, maxLen, tokensById, colById };
  }

  // ------------------------------------------------------------
  // Color: yellow → orange ramp by gen_step
  // ------------------------------------------------------------
  function rgbStr(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]})`;
  }
  function rampColor(step, maxStep) {
    if (step <= 0) return CFG.promptColor;
    if (maxStep <= 1) return rgbStr(CFG.rampEnd);
    const t = (step - 1) / (maxStep - 1);
    const r = Math.round(
      CFG.rampStart[0] + (CFG.rampEnd[0] - CFG.rampStart[0]) * t,
    );
    const g = Math.round(
      CFG.rampStart[1] + (CFG.rampEnd[1] - CFG.rampStart[1]) * t,
    );
    const b = Math.round(
      CFG.rampStart[2] + (CFG.rampEnd[2] - CFG.rampStart[2]) * t,
    );
    return `rgb(${r},${g},${b})`;
  }

  // ------------------------------------------------------------
  // Render colored sequence text for a given step.
  // Tokens with gen_step > currentStep are hidden (no preview).
  // ------------------------------------------------------------
  function renderSequenceText(step) {
    if (!LAYOUT) return "";
    const seq = LAYOUT.sequences[step] || [];
    const parts = [];
    for (let i = 0; i < seq.length; i++) {
      const id = seq[i];
      const t = LAYOUT.tokensById[id];
      const text = DOC.vocab[String(t.vocab_id)] ?? "";
      const cls = ["lv-tok"];
      let inlineColor = "";
      const isJust = t.gen_step > 0 && t.gen_step === step;
      const special = isSpecial(t.vocab_id);
      const tColor =
        !special && t.gen_step > 0 && !isJust
          ? threadColor(t.thread_id, t.gen_step, LAYOUT.maxStep)
          : null;
      if (t.gen_step === 0) {
        cls.push("lv-tok-prompt");
      } else if (isJust) {
        cls.push("lv-tok-just");
      } else if (tColor) {
        inlineColor = ' style="color:' + tColor + '"';
      } else {
        inlineColor =
          ' style="color:' + rampColor(t.gen_step, LAYOUT.maxStep) + '"';
      }
      if (special) cls.push("lv-tok-special");
      if (t.forced) cls.push("lv-tok-forced");
      const colVal = LAYOUT.colById ? LAYOUT.colById[t.id] : i;
      const dataAttrs = [
        ' data-id="' + escapeHtml(t.id) + '"',
        ' data-vid="' + t.vocab_id + '"',
        ' data-step="' + t.gen_step + '"',
        ' data-col="' + i + '"',
        ' data-abs="' + colVal + '"',
      ];
      if (t.forced) dataAttrs.push(' data-forced="1"');
      if (typeof t.thread_id === "number")
        dataAttrs.push(' data-thread="' + t.thread_id + '"');
      if (typeof t.wave_id === "number")
        dataAttrs.push(' data-wave="' + t.wave_id + '"');
      if (typeof t.block_id === "number")
        dataAttrs.push(' data-block="' + t.block_id + '"');
      if (t.role) dataAttrs.push(' data-role="' + escapeHtml(t.role) + '"');
      parts.push(
        '<span class="' +
          cls.join(" ") +
          '"' +
          inlineColor +
          dataAttrs.join("") +
          ">" +
          escapeHtml(text) +
          "</span>",
      );
      // Paragraph-break sentinels: <|eot|> / role:block_close force a line
      // break after the chip. The <br> is emitted regardless of the
      // hide-structural toggle, so paragraph layout survives chip hiding.
      if (tokenForcesBreak(t)) {
        parts.push('<br class="lv-block-break">');
      }
    }
    return parts.join("");
  }

  // ------------------------------------------------------------
  // Hover tooltip (token spans)
  // ------------------------------------------------------------
  promptEl.addEventListener("mousemove", (ev) => {
    const span =
      ev.target && ev.target.closest && ev.target.closest("span.lv-tok");
    if (!span) {
      tipEl.style.display = "none";
      return;
    }
    const vid = span.dataset.vid;
    const text = DOC.vocab[String(vid)] ?? "?";
    const special = isSpecial(parseInt(vid, 10));
    const rows = [
      '<div><span class="k">token: </span><span class="v ' +
        (special ? "special" : "") +
        '">' +
        escapeHtml(JSON.stringify(text)) +
        "</span></div>",
      '<div><span class="k">vocab_id: </span><span class="v">' +
        escapeHtml(vid) +
        "</span></div>",
      '<div><span class="k">id: </span><span class="v">' +
        escapeHtml(span.dataset.id) +
        "</span></div>",
      '<div><span class="k">gen_step: </span><span class="v">' +
        escapeHtml(span.dataset.step) +
        "</span></div>",
      '<div><span class="k">col: </span><span class="v">' +
        escapeHtml(span.dataset.col) +
        "</span></div>",
      '<div><span class="k">abs: </span><span class="v">' +
        escapeHtml(span.dataset.abs) +
        "</span></div>",
    ];
    if (span.dataset.thread !== undefined)
      rows.push(
        '<div><span class="k">thread_id: </span><span class="v">' +
          escapeHtml(span.dataset.thread) +
          "</span></div>",
      );
    if (span.dataset.wave !== undefined)
      rows.push(
        '<div><span class="k">wave_id: </span><span class="v">' +
          escapeHtml(span.dataset.wave) +
          "</span></div>",
      );
    if (span.dataset.block !== undefined)
      rows.push(
        '<div><span class="k">block_id: </span><span class="v">' +
          escapeHtml(span.dataset.block) +
          "</span></div>",
      );
    if (span.dataset.role)
      rows.push(
        '<div><span class="k">role: </span><span class="v">' +
          escapeHtml(span.dataset.role) +
          "</span></div>",
      );
    if (span.dataset.forced === "1")
      rows.push(
        '<div><span class="k">forced: </span><span class="v">true</span></div>',
      );
    tipEl.innerHTML = rows.join("");
    tipEl.style.display = "block";
    tipEl.style.left = ev.clientX + 14 + "px";
    tipEl.style.top = ev.clientY + 14 + "px";
  });
  promptEl.addEventListener("mouseleave", () => {
    tipEl.style.display = "none";
  });

  // ------------------------------------------------------------
  // Playback / step control
  // ------------------------------------------------------------
  function stepsPerSecForLayout() {
    if (!LAYOUT) return CFG.minStepsPerSec;
    const total = LAYOUT.maxStep + 1;
    const fromCap = total / (CFG.animMs / 1000);
    return Math.max(CFG.minStepsPerSec, fromCap);
  }

  function setStep(s) {
    if (!LAYOUT) return;
    currentStep = Math.max(0, Math.min(s, LAYOUT.maxStep));
    sliderEl.value = String(currentStep);
    stepLabel.textContent = "step " + currentStep + " / " + LAYOUT.maxStep;
    promptEl.innerHTML = renderSequenceText(currentStep);
    if (hideStructural) promptEl.setAttribute("data-hide-structural", "");
    else promptEl.removeAttribute("data-hide-structural");
    prevBtn.disabled = currentStep <= 0;
    nextBtn.disabled = currentStep >= LAYOUT.maxStep;
  }

  function play() {
    if (!LAYOUT) return;
    if (currentStep >= LAYOUT.maxStep) currentStep = 0;
    playing = true;
    playBtn.textContent = "❚❚ Pause";
    const interval = 1000 / stepsPerSecForLayout();
    playTimer = setInterval(() => {
      if (currentStep >= LAYOUT.maxStep) {
        stop();
        return;
      }
      setStep(currentStep + 1);
    }, interval);
  }
  function stop() {
    playing = false;
    playBtn.textContent = "▶ Play";
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }
  playBtn.addEventListener("click", () => (playing ? stop() : play()));

  sliderEl.addEventListener("input", () => {
    stop();
    setStep(Number(sliderEl.value));
  });

  prevBtn.addEventListener("click", () => {
    stop();
    setStep(currentStep - 1);
  });
  nextBtn.addEventListener("click", () => {
    stop();
    setStep(currentStep + 1);
  });

  // Left/right arrow keys step one at a time. Skip when typing into a control
  // (the slider already handles arrows; the trace dropdown should keep its native behavior).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!LAYOUT) return;
    stop();
    setStep(currentStep + (ev.key === "ArrowRight" ? 1 : -1));
    ev.preventDefault();
  });

  toggleStructuralBtn.addEventListener("click", () => {
    hideStructural = !hideStructural;
    toggleStructuralBtn.textContent = hideStructural ? "Show ⟨|⟩" : "Hide ⟨|⟩";
    if (hideStructural) promptEl.setAttribute("data-hide-structural", "");
    else promptEl.removeAttribute("data-hide-structural");
  });

  // ------------------------------------------------------------
  // Frame composer (shared by PNG + GIF export).
  // Layout dimensions are fixed across all frames using the final step,
  // so GIF frames stay a consistent size.
  // ------------------------------------------------------------
  const FRAME = {
    PAD: 22,
    TITLE_FONT: "600 14px ui-sans-serif, -apple-system, system-ui, sans-serif",
    TEXT_FONT: "14px ui-monospace, SFMono-Regular, Menlo, monospace",
    SMALL_FONT: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
    TITLE_H: 24,
    LINE_H: 22,
    GAP: 14,
    LEG_H: 22,
    TARGET_W: 960,
  };

  function spansForStep(step) {
    const { sequences, tokensById } = LAYOUT;
    const seq = sequences[step] || [];
    const out = [];
    for (const id of seq) {
      const t = tokensById[id];
      const special = isSpecial(t.vocab_id);
      // Apply the hide-structural toggle in canvas exports too: drop the chip,
      // but keep the block break it forces so paragraph layout is preserved.
      if (!(hideStructural && special)) {
        out.push({
          text: DOC.vocab[String(t.vocab_id)] ?? "",
          gen_step: t.gen_step,
          special,
          forced: !!t.forced,
          isJust: t.gen_step > 0 && t.gen_step === step,
          thread_id: typeof t.thread_id === "number" ? t.thread_id : 0,
          forceBreakAfter: tokenForcesBreak(t),
        });
      } else if (tokenForcesBreak(t)) {
        // Inject an empty span purely to carry the line-break flag through wrap.
        out.push({
          text: "",
          gen_step: t.gen_step,
          special: false,
          forced: false,
          isJust: false,
          thread_id: 0,
          forceBreakAfter: true,
        });
      }
    }
    return out;
  }

  function computeFrameDims() {
    const { maxStep } = LAYOUT;
    const innerW = FRAME.TARGET_W - 2 * FRAME.PAD;
    const tmp = document.createElement("canvas").getContext("2d");
    tmp.font = FRAME.TEXT_FONT;

    // size the canvas to the final (largest) sequence so all frames match
    const finalSpans = spansForStep(maxStep);
    const lines = wrapSpansIntoLines(tmp, finalSpans, innerW);
    const seqH = lines.length * FRAME.LINE_H;

    let anySpecial = false,
      anyForced = false;
    for (const t of TRACE.tokens) {
      if (isSpecial(t.vocab_id)) anySpecial = true;
      if (t.forced) anyForced = true;
    }

    const totalH =
      FRAME.PAD +
      FRAME.TITLE_H +
      FRAME.GAP +
      seqH +
      FRAME.GAP +
      FRAME.LEG_H +
      FRAME.PAD;
    return {
      totalW: FRAME.TARGET_W,
      totalH,
      innerW,
      seqH,
      anySpecial,
      anyForced,
    };
  }

  function drawFrame(step, dims, dpr) {
    const c = document.createElement("canvas");
    c.width = dims.totalW * dpr;
    c.height = dims.totalH * dpr;
    const cx = c.getContext("2d");
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cx.fillStyle = "#1a1a1a";
    cx.fillRect(0, 0, dims.totalW, dims.totalH);

    let y = FRAME.PAD;

    cx.font = FRAME.TITLE_FONT;
    cx.fillStyle = "#f2f2f2";
    cx.textBaseline = "top";
    cx.fillText(TRACE.name || "trace", FRAME.PAD, y);

    cx.font = FRAME.SMALL_FONT;
    cx.fillStyle = "#c9c9c9";
    const stepsLabel =
      "steps: " + LAYOUT.maxStep + " (snapshot at step " + step + ")";
    const stepsW = cx.measureText(stepsLabel).width;
    cx.fillText(stepsLabel, dims.totalW - FRAME.PAD - stepsW, y + 4);

    y += FRAME.TITLE_H + FRAME.GAP;

    // wrap THIS step's spans (not the final ones) so partial frames are correct
    const tmp = document.createElement("canvas").getContext("2d");
    tmp.font = FRAME.TEXT_FONT;
    const lines = wrapSpansIntoLines(tmp, spansForStep(step), dims.innerW);
    drawSeqLines(cx, FRAME.PAD, y, lines, FRAME.LINE_H, FRAME.TEXT_FONT);

    // legend stays anchored at the bottom of the fixed-height canvas
    const legY = dims.totalH - FRAME.PAD - FRAME.LEG_H;
    drawStaticLegend(
      cx,
      FRAME.PAD,
      legY,
      FRAME.SMALL_FONT,
      dims.anySpecial,
      dims.anyForced,
    );

    return c;
  }

  // ------------------------------------------------------------
  // PNG export — single frame at the final step.
  // ------------------------------------------------------------
  exportBtn.addEventListener("click", () => {
    if (!LAYOUT) return;
    const dims = computeFrameDims();
    const c = drawFrame(LAYOUT.maxStep, dims, window.devicePixelRatio || 1);
    const link = document.createElement("a");
    const safe = (TRACE && TRACE.name ? TRACE.name : "trace").replace(
      /[^a-z0-9-_]+/gi,
      "_",
    );
    link.download = safe + ".png";
    link.href = c.toDataURL("image/png");
    link.click();
  });

  // ------------------------------------------------------------
  // GIF export — one frame per generation step, paced like Play.
  // Last frame holds longer so the final state is readable.
  // ------------------------------------------------------------
  exportGifBtn.addEventListener("click", () => {
    if (!LAYOUT) return;
    if (typeof GIF === "undefined") {
      showError("GIF export unavailable: gif.js failed to load");
      return;
    }
    const origLabel = exportGifBtn.textContent;
    const reset = () => {
      exportGifBtn.disabled = false;
      exportGifBtn.textContent = origLabel;
    };
    exportGifBtn.disabled = true;
    exportGifBtn.textContent = "Rendering 0%";

    const dims = computeFrameDims();
    // adaptive frame budget: long traces would otherwise produce huge files
    // and play too slowly. 1:1 stays accurate for short traces; large traces
    // group steps so the frame count stays reasonable.
    const GIF_CFG = {
      stride1Threshold: 80, // <= this many steps → 1 frame per step
      strideLarge: 4, // otherwise → this many steps per frame
      pixelScale: 2, // 1 = 1MB-ish, 2 = ~4MB sharp on retina
    };
    const totalSteps = LAYOUT.maxStep + 1;
    const stride =
      totalSteps <= GIF_CFG.stride1Threshold ? 1 : GIF_CFG.strideLarge;
    const stepList = [];
    for (let s = 0; s <= LAYOUT.maxStep; s += stride) stepList.push(s);
    if (stepList[stepList.length - 1] !== LAYOUT.maxStep)
      stepList.push(LAYOUT.maxStep);
    const scale = GIF_CFG.pixelScale;

    // copy: true means gif.js reads pixels synchronously into ImageData so the
    // worker doesn't need to touch our HTMLCanvasElements. Without this, some
    // setups fail silently mid-render.
    const useCopy = true;
    // Use Blob-URL worker to dodge any path/MIME quirks with the Python server.
    let workerUrl = "./gif.worker.js";
    let revokeWorker = null;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "./gif.worker.js", false);
      xhr.send(null);
      if (xhr.status === 200) {
        const blob = new Blob([xhr.responseText], {
          type: "application/javascript",
        });
        workerUrl = URL.createObjectURL(blob);
        revokeWorker = () => URL.revokeObjectURL(workerUrl);
      } else {
        console.warn(
          "[gif] worker fetch returned",
          xhr.status,
          "— falling back to",
          workerUrl,
        );
      }
    } catch (e) {
      console.warn("[gif] worker prefetch failed:", e);
    }

    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: dims.totalW * scale,
      height: dims.totalH * scale,
      workerScript: workerUrl,
      background: "#1a1a1a",
      debug: true,
    });

    const frameMs = Math.max(120, Math.round(1000 / stepsPerSecForLayout()));
    for (const step of stepList) {
      const c = drawFrame(step, dims, scale);
      const delay =
        step === LAYOUT.maxStep ? Math.max(1500, frameMs * 5) : frameMs;
      gif.addFrame(c, { delay, copy: useCopy });
    }
    console.log(
      "[gif] queued",
      stepList.length,
      "frames (stride",
      stride + ")",
      "at",
      dims.totalW * scale,
      "x",
      dims.totalH * scale,
    );

    gif.on("start", () => console.log("[gif] render start"));
    gif.on("progress", (p) => {
      exportGifBtn.textContent = "Rendering " + Math.round(p * 100) + "%";
    });
    gif.on("finished", (blob) => {
      console.log("[gif] finished, blob size", blob.size);
      if (revokeWorker) revokeWorker();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safe = (TRACE && TRACE.name ? TRACE.name : "trace").replace(
        /[^a-z0-9-_]+/gi,
        "_",
      );
      link.download = safe + ".gif";
      link.href = url;
      link.rel = "noopener";
      // some browsers ignore .click() unless the link is in the DOM
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      reset();
    });
    gif.on("abort", () => {
      console.warn("[gif] aborted");
      if (revokeWorker) revokeWorker();
      reset();
    });

    // safety net: if nothing finishes in 60s, surface the failure
    const watchdog = setTimeout(() => {
      if (exportGifBtn.disabled) {
        showError(
          "GIF export timed out after 60s — check console for worker errors",
        );
        try {
          gif.abort();
        } catch (_) {}
      }
    }, 60000);
    gif.on("finished", () => clearTimeout(watchdog));
    gif.on("abort", () => clearTimeout(watchdog));

    try {
      gif.render();
    } catch (e) {
      console.error("[gif] render threw:", e);
      if (revokeWorker) revokeWorker();
      reset();
      showError("GIF export failed: " + (e.message || e));
    }
  });

  function wrapSpansIntoLines(tctx, spans, maxW) {
    tctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
    const lines = [[]];
    let curW = 0;
    for (const sp of spans) {
      const segments = sp.text.split("\n");
      for (let i = 0; i < segments.length; i++) {
        if (i > 0) {
          lines.push([]);
          curW = 0;
        }
        const seg = segments[i];
        if (seg.length === 0) continue;
        const w = tctx.measureText(seg).width;
        if (curW > 0 && curW + w > maxW) {
          lines.push([]);
          curW = 0;
        }
        lines[lines.length - 1].push({
          text: seg,
          w,
          gen_step: sp.gen_step,
          special: sp.special,
          forced: sp.forced,
          isJust: sp.isJust,
          thread_id: sp.thread_id,
        });
        curW += w;
      }
      if (sp.forceBreakAfter) {
        lines.push([]);
        curW = 0;
      }
    }
    return lines;
  }

  function drawSeqLines(cx, x0, y0, lines, lineH, font) {
    cx.font = font;
    cx.textBaseline = "top";
    for (let li = 0; li < lines.length; li++) {
      let x = x0;
      const y = y0 + li * lineH;
      for (const sp of lines[li]) {
        let color;
        const tCol =
          !sp.special && sp.gen_step > 0 && !sp.isJust
            ? threadColor(sp.thread_id, sp.gen_step, LAYOUT.maxStep)
            : null;
        if (sp.special) color = "#d4c8a8";
        else if (sp.gen_step === 0) color = CFG.promptColor;
        else if (sp.isJust) color = CFG.currentColor;
        else if (tCol) color = tCol;
        else color = rampColor(sp.gen_step, LAYOUT.maxStep);

        // Subtle pill background behind structural specials so they read as
        // chips in PNG/GIF, mirroring the HTML view.
        if (sp.special) {
          cx.fillStyle = "rgba(255,255,255,0.06)";
          const px = 3;
          cx.fillRect(x - px, y + 1, sp.w + 2 * px, lineH - 4);
          cx.strokeStyle = "rgba(255,210,120,0.22)";
          cx.lineWidth = 1;
          cx.strokeRect(x - px + 0.5, y + 1.5, sp.w + 2 * px - 1, lineH - 5);
        }

        cx.fillStyle = color;
        cx.fillText(sp.text, x, y);

        // underline for the just-generated token
        if (sp.isJust) {
          cx.fillRect(x, y + lineH - 4, sp.w, 2);
        }
        // forced marker (small dot above the trailing edge)
        if (sp.forced) {
          cx.fillStyle = "#ffd23f";
          cx.beginPath();
          cx.arc(x + sp.w + 2, y + 3, 2, 0, Math.PI * 2);
          cx.fill();
        }
        x += sp.w;
      }
    }
  }

  function drawStaticLegend(cx, x0, y0, font, anySpecial, anyForced) {
    cx.font = font;
    cx.textBaseline = "middle";
    const SW = 12;
    const RAMP_W = 70;
    const PAD_TXT = 6;
    const GAP_ITEM = 16;
    let x = x0;
    const yMid = y0 + 11;

    const drawSwatch = (color, label) => {
      cx.fillStyle = color;
      cx.fillRect(x, yMid - SW / 2, SW, SW);
      x += SW + PAD_TXT;
      cx.fillStyle = "#c9c9c9";
      cx.fillText(label, x, yMid);
      x += cx.measureText(label).width + GAP_ITEM;
    };

    drawSwatch(CFG.promptColor, "prompt");

    if (LAYOUT.maxStep > 0) {
      const grad = cx.createLinearGradient(x, 0, x + RAMP_W, 0);
      grad.addColorStop(0, rgbStr(CFG.rampStart));
      grad.addColorStop(1, rgbStr(CFG.rampEnd));
      cx.fillStyle = grad;
      cx.fillRect(x, yMid - SW / 2, RAMP_W, SW);
      x += RAMP_W + PAD_TXT;
      cx.fillStyle = "#c9c9c9";
      cx.fillText("step 1 → last", x, yMid);
      x += cx.measureText("step 1 → last").width + GAP_ITEM;
    }

    // current-step swatch: text "abc" with color + underline
    cx.fillStyle = CFG.currentColor;
    const cLabel = "just generated";
    cx.fillText(cLabel, x, yMid);
    const cw = cx.measureText(cLabel).width;
    cx.fillRect(x, yMid + 7, cw, 1.5);
    x += cw + GAP_ITEM;

    if (anySpecial) drawSwatch("#8a8a8a", "special token");
    if (anyForced) {
      cx.fillStyle = "#ffd23f";
      cx.beginPath();
      cx.arc(x + 4, yMid, 3, 0, Math.PI * 2);
      cx.fill();
      x += 12;
      cx.fillStyle = "#c9c9c9";
      cx.fillText("forced (tool / injected)", x, yMid);
    }
  }

  // ------------------------------------------------------------
  // Trace selection
  // ------------------------------------------------------------
  function loadDoc(doc) {
    DOC = doc;
    if (!doc.schema_version) {
      showError("missing schema_version");
      return;
    }
    if (
      doc.schema_version !== "1" &&
      doc.schema_version !== "2" &&
      doc.schema_version !== "3"
    ) {
      showError(
        "unsupported schema_version: " +
          doc.schema_version +
          ' (expected "1", "2", or "3")',
      );
      return;
    }
    if (!Array.isArray(doc.traces) || doc.traces.length === 0) {
      showError("no traces in document");
      return;
    }
    selEl.innerHTML = "";
    doc.traces.forEach((tr, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      const promptPreview = (tr.prompt_text || "")
        .slice(0, 40)
        .replace(/\s+/g, " ");
      opt.textContent =
        (tr.name || "trace " + i) +
        (promptPreview ? "  —  " + promptPreview : "");
      selEl.appendChild(opt);
    });
    selEl.value = "0";
    selectTrace(0);
  }

  function selectTrace(i) {
    stop();
    TRACE = DOC.traces[i];
    titleEl.textContent = TRACE.name || "trace " + i;
    try {
      LAYOUT = computeLayout(TRACE);
      clearError();
    } catch (e) {
      LAYOUT = null;
      showError(String(e.message || e));
      promptEl.innerHTML = "";
      sliderEl.max = "0";
      stepLabel.textContent = "step 0 / 0";
      return;
    }
    sliderEl.max = String(LAYOUT.maxStep);
    setStep(0);
  }

  selEl.addEventListener("change", () => selectTrace(Number(selEl.value)));

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  const params = new URLSearchParams(location.search);
  const traceUrl = params.get("trace") || "./examples/hello-world.json";
  loadFromUrl(traceUrl)
    .then(loadDoc)
    .catch((e) => {
      titleEl.textContent = "failed to load";
      showError("could not load " + traceUrl + ": " + (e.message || e));
    });
})();
