/* shell.js — injects the shared top-of-page chrome on every llm-visual page.
   Use:
     <header id="shell" data-page="dataloader"></header>
     <script src="shell.js"></script>
   The home page omits data-page (or sets data-page="home") and gets a large
   hero title; subpages get a "← Eyeball LLM / <page>" back-breadcrumb.
   shell.js also sets document.title to "<PROJECT> · <page>". */

(function () {
  const PROJECT_NAME = "Eyeball LLM";
  const HOME_HREF    = "index.html";

  const SHELL_CSS = `
    /* hero (home page) */
    #shell.lv-shell-home {
      max-width: 760px;
      margin: 28px auto 12px;
      padding: 0 8px;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .lv-shell-home .lv-shell-title {
      margin: 0;
      font-size: 2.4rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #f4f4f4;
      line-height: 1.1;
    }

    /* breadcrumb (subpages) */
    #shell.lv-shell-sub {
      max-width: 960px;
      margin: 18px auto 14px;
      padding: 0 8px;
      display: flex;
      align-items: baseline;
      gap: 10px;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .lv-shell-sub .lv-shell-back {
      color: #c9c9c9;
      text-decoration: none;
      font-weight: 500;
      font-size: 0.85rem;
      letter-spacing: -0.01em;
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
    }
    .lv-shell-sub .lv-shell-back:hover { color: #dc641e; }
    .lv-shell-sub .lv-shell-back .lv-arr { font-size: 0.95rem; }
    .lv-shell-sub .lv-shell-sep  { color: #555; }
    .lv-shell-sub .lv-shell-page {
      color: #8a8a8a;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
  `;

  function injectStyles() {
    if (document.getElementById("lv-shell-style")) return;
    const s = document.createElement("style");
    s.id = "lv-shell-style";
    s.textContent = SHELL_CSS;
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    const el = document.getElementById("shell");
    if (!el) return;
    const pageName = el.dataset.page || "";
    const isHome   = !pageName || pageName === "home";
    if (isHome) {
      el.classList.add("lv-shell-home");
      el.innerHTML = `<h1 class="lv-shell-title">${PROJECT_NAME}</h1>`;
      document.title = PROJECT_NAME;
    } else {
      el.classList.add("lv-shell-sub");
      el.innerHTML =
        `<a class="lv-shell-back" href="${HOME_HREF}">`
        +   `<span class="lv-arr">←</span><span>Home</span>`
        + `</a>`
        + `<span class="lv-shell-sep">·</span>`
        + `<span class="lv-shell-page">${pageName}</span>`;
      document.title = `${PROJECT_NAME} · ${pageName}`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
