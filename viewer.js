(function () {
  const $ = (id) => document.getElementById(id);

  // Single-hue sequential ramps, validated with dataviz validate_palette.js
  // --ordinal (monotone L, adjacent dL >= 0.06, light end clears surface).
  // paper: white ink throughout, so the light end is capped by white-text
  // contrast. #3987e5 = 3.64:1. Swap to #256abf (5.39:1) for a stricter floor
  // at the cost of half the ramp's range.
  const RAMP = {
    screen: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],
    paper: ["#3987e5", "#1c5cab", "#0d366b"],
  };
  const PROMPT_BG = { screen: "#3a3a37", paper: "#e6e5e1" };
  const NOW_RING = { screen: "#ffd84d", paper: "#b45309" };

  let doc = null;
  let seq = null;
  let mode = "step";
  let surface = "screen";
  let k = 0;
  let timer = null;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isSpecial(t) {
    return /^<\|.*\|>$/.test(t.char);
  }

  function hexRgb(h) {
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  function rampAt(f) {
    const stops = RAMP[surface].map(hexRgb);
    const x = Math.max(0, Math.min(1, f)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const t = x - i;
    return stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * t));
  }

  function ink(rgb) {
    const [r, g, b] = rgb.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.42 ? "#101010" : "#f8f8f8";
  }

  function stepStyle(step, maxStep) {
    if (step === 0) {
      const bg = PROMPT_BG[surface];
      return { bg, ink: ink(hexRgb(bg)) };
    }
    const rgb = rampAt(maxStep <= 1 ? 1 : (step - 1) / (maxStep - 1));
    return {
      bg: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
      ink: surface === "paper" ? "#ffffff" : ink(rgb),
    };
  }

  function rampCss() {
    return `linear-gradient(to right, ${RAMP[surface].join(",")})`;
  }

  function render() {
    const maxStep = lastStep(seq);
    const shown = mode === "step" ? tokensAtStep(seq, k) : seq.tokens;
    const off = offsetOf(seq);
    let lines;
    try {
      lines = layoutLines(seq, shown);
    } catch (e) {
      $("tr-body").innerHTML = "";
      return showError(e.message);
    }
    $("tr-error").innerHTML = "";

    const html = lines
      .map((line, i) => {
        const toks = line
          .map((t) => {
            const now = mode === "step" && t.step === k;
            const s = stepStyle(t.step, maxStep);
            const cls =
              "tr-tok" +
              (isSpecial(t) ? " tr-tok-special" : "") +
              (now ? " tr-tok-now" : "");
            const ring = now
              ? `;box-shadow:0 0 0 2px ${NOW_RING[surface]}`
              : "";
            return (
              `<span class="${cls}" style="background:${s.bg};color:${s.ink}${ring}"` +
              ` data-id="${t.id}" data-rope="${t.rope}" data-step="${t.step}">` +
              `${esc(t.char.replace(/\n/g, "↵"))}</span>`
            );
          })
          .join("");
        const empty = line.length === 0 ? " tr-line-empty" : "";
        return (
          `<div class="tr-line${empty}"><span class="tr-line-idx">${i}</span>` +
          `<span class="tr-line-toks">${toks}</span></div>`
        );
      })
      .join("");

    $("tr-body").innerHTML = html;
    $("tr-ramp").style.background = rampCss();
    $("tr-prompt-sw").style.background = PROMPT_BG[surface];
    $("tr-step-label").textContent = `step ${k} / ${maxStep}`;
    $("tr-slider").max = maxStep;
    $("tr-slider").value = k;
    $("tr-prev").disabled = k <= 0;
    $("tr-next").disabled = k >= maxStep;
    $("tr-controls").toggleAttribute("data-hidden", mode !== "step");
    $("tr-info").textContent =
      `${seq.model} · ${seq.model === "ar" ? "flow" : "rope bands"} · ` +
      `${seq.tokens.length} tokens · ${maxStep} steps · ${lines.length} lines · ` +
      `offset ${off} · rope ${Math.min(...seq.tokens.map((t) => t.rope))}..` +
      `${Math.max(...seq.tokens.map((t) => t.rope))}`;
  }

  function selectSeq(i) {
    seq = doc.sequences[i];
    if (seq.offset == null) seq.offset = doc.offset;
    if (seq.model == null) seq.model = doc.model;
    k = 0;
    render();
  }

  function setStep(v) {
    k = Math.max(0, Math.min(lastStep(seq), v));
    render();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    $("tr-play").textContent = "▶ Play";
  }

  function play() {
    if (timer) return stop();
    if (k >= lastStep(seq)) k = 0;
    $("tr-play").textContent = "■ Stop";
    timer = setInterval(() => {
      if (k >= lastStep(seq)) return stop();
      setStep(k + 1);
    }, 60);
  }

  function buildSVG() {
    const body = $("tr-body");
    const box = body.getBoundingClientRect();
    const pad = 14;
    const W = Math.ceil(body.scrollWidth);
    const H = Math.ceil(body.scrollHeight);
    const cs = getComputedStyle(body);
    const at = (r) => ({
      x: r.left - box.left + body.scrollLeft,
      y: r.top - box.top + body.scrollTop,
    });
    const out = [
      `<rect width="${W}" height="${H}" fill="${cs.backgroundColor}"/>`,
    ];

    for (const el of body.querySelectorAll(".tr-line-idx")) {
      const r = el.getBoundingClientRect();
      const p = at(r);
      const s = getComputedStyle(el);
      out.push(
        `<text x="${(p.x + r.width).toFixed(1)}" y="${(p.y + r.height / 2).toFixed(1)}"` +
          ` text-anchor="end" dominant-baseline="central" fill="${s.color}"` +
          ` font-family="${s.fontFamily}" font-size="${s.fontSize}">${esc(el.textContent)}</text>`,
      );
    }

    for (const el of body.querySelectorAll(".tr-tok")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const p = at(r);
      const s = getComputedStyle(el);
      out.push(
        `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}"` +
          ` width="${r.width.toFixed(1)}" height="${r.height.toFixed(1)}"` +
          ` rx="2" fill="${s.backgroundColor}"/>`,
      );
      if (el.classList.contains("tr-tok-now"))
        out.push(
          `<rect x="${(p.x - 1).toFixed(1)}" y="${(p.y - 1).toFixed(1)}"` +
            ` width="${(r.width + 2).toFixed(1)}" height="${(r.height + 2).toFixed(1)}"` +
            ` rx="3" fill="none" stroke="${NOW_RING[surface]}" stroke-width="2"/>`,
        );
      out.push(
        `<text x="${p.x.toFixed(1)}" y="${(p.y + r.height / 2).toFixed(1)}"` +
          ` dominant-baseline="central" xml:space="preserve" fill="${s.color}"` +
          ` font-family="${s.fontFamily}" font-size="${s.fontSize}">${esc(el.textContent)}</text>`,
      );
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W + pad * 2}"` +
      ` height="${H + pad * 2}" viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}">` +
      out.join("") +
      `</svg>`
    );
  }

  function figName(ext) {
    const slug = (seq.name || "seq").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return `${slug}-step${k}.${ext}`;
  }

  function download(href, name) {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  }

  function exportSVG() {
    const blob = new Blob([buildSVG()], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    download(url, figName("svg"));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPNG(scale = 3) {
    const svg = buildSVG();
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    const w = +m[1];
    const h = +m[2];
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w * scale;
      c.height = h * scale;
      const g = c.getContext("2d");
      g.scale(scale, scale);
      g.drawImage(img, 0, 0);
      download(c.toDataURL("image/png"), figName("png"));
    };
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function showError(msg) {
    $("tr-error").innerHTML = `<div class="lv-error">${esc(msg)}</div>`;
  }

  function bindTooltip() {
    const tip = $("tr-tip");
    const body = $("tr-body");
    body.addEventListener("mouseover", (e) => {
      const el = e.target.closest(".tr-tok");
      if (!el) return;
      tip.innerHTML =
        `<div><span class="k">char</span> <span class="v">${esc(JSON.stringify(el.textContent))}</span></div>` +
        `<div><span class="k">id</span> <span class="v">${el.dataset.id}</span></div>` +
        `<div><span class="k">rope</span> <span class="v">${el.dataset.rope}</span></div>` +
        `<div><span class="k">step</span> <span class="v">${el.dataset.step}</span></div>`;
      tip.style.display = "block";
    });
    body.addEventListener("mousemove", (e) => {
      tip.style.left = e.clientX + 14 + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    body.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest(".tr-tok"))
        tip.style.display = "none";
    });
  }

  async function main() {
    const qs = new URLSearchParams(location.search);
    const path =
      qs.get("trace") ||
      "./examples/generation/cdlm_vs_ar_d24r20_daily.json";
    if (qs.get("surface") === "paper") surface = "paper";
    if (qs.get("mode") === "heat") mode = "heat";
    document.body.classList.toggle("tr-paper", surface === "paper");
    if (qs.get("bare") !== null) document.body.classList.add("tr-bare");
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      doc = await res.json();
    } catch (e) {
      $("tr-title").textContent = "Error";
      return showError(`Failed to load ${path}: ${e.message}`);
    }
    if (!doc.sequences || !doc.sequences.length)
      return showError("No sequences in file.");

    $("tr-title").textContent = doc.name || path;
    $("tr-seq").innerHTML = doc.sequences
      .map(
        (s, i) => `<option value="${i}">${esc(s.name || `seq ${i}`)}</option>`,
      )
      .join("");

    $("tr-seq").addEventListener("change", (e) => {
      stop();
      selectSeq(+e.target.value);
    });
    $("tr-slider").addEventListener("input", (e) => {
      stop();
      setStep(+e.target.value);
    });
    $("tr-prev").addEventListener("click", () => (stop(), setStep(k - 1)));
    $("tr-next").addEventListener("click", () => (stop(), setStep(k + 1)));
    $("tr-play").addEventListener("click", play);
    $("tr-svg").addEventListener("click", () => (stop(), exportSVG()));
    $("tr-png").addEventListener("click", () => (stop(), exportPNG()));
    $("tr-mode").addEventListener("click", () => {
      stop();
      mode = mode === "step" ? "heat" : "step";
      $("tr-mode").textContent = `Mode: ${mode}`;
      render();
    });
    $("tr-surface").addEventListener("click", () => {
      surface = surface === "screen" ? "paper" : "screen";
      document.body.classList.toggle("tr-paper", surface === "paper");
      $("tr-surface").textContent = `Surface: ${surface}`;
      render();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") (stop(), setStep(k - 1));
      if (e.key === "ArrowRight") (stop(), setStep(k + 1));
    });

    $("tr-mode").textContent = `Mode: ${mode}`;
    $("tr-surface").textContent = `Surface: ${surface}`;
    bindTooltip();
    selectSeq(Math.min(doc.sequences.length - 1, +(qs.get("seq") || 0)));
    if (qs.get("step") !== null) setStep(+qs.get("step"));
    if (qs.get("step") === "last") setStep(lastStep(seq));
  }

  main();
})();
