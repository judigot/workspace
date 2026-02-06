/**
 * DevBubble standalone widget.
 * Injected into app pages via nginx sub_filter.
 * Self-contained — no React, no build deps on the host page.
 *
 * Config via script tag data attributes:
 *   <script src="/dev-bubble.js" data-opencode-url="https://opencode.judigot.com"></script>
 */

(function () {
  // Prevent double-init
  if (document.getElementById("__dev-bubble-root")) return;

  // --- Config ---
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  const opencodeUrl =
    scriptTag?.getAttribute("data-opencode-url") ||
    "https://opencode.judigot.com";
  const dashboardUrl =
    scriptTag?.getAttribute("data-dashboard-url") || "/";

  // --- State ---
  let isOpen = false;
  let isDragging = false;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let posX = window.innerWidth - 84;
  let posY = window.innerHeight - 84;

  // --- Styles ---
  const css = `
    #__dev-bubble-root {
      font-family: system-ui, -apple-system, sans-serif;
      position: fixed;
      z-index: 99999;
    }

    #__dev-bubble-btn {
      position: fixed;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      z-index: 99999;
      touch-action: none;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      padding: 0;
    }
    #__dev-bubble-btn:active { cursor: grabbing; transform: scale(0.95); }
    @media (hover: hover) {
      #__dev-bubble-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 28px rgba(102, 126, 234, 0.5);
      }
    }

    #__dev-bubble-panel {
      position: fixed;
      inset: 0;
      background: #0f0f1a;
      z-index: 99998;
      display: flex;
      flex-direction: column;
    }
    #__dev-bubble-panel.hidden {
      visibility: hidden;
      pointer-events: none;
    }

    #__dev-bubble-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      flex-shrink: 0;
    }
    #__dev-bubble-header .title {
      font-size: 16px;
      font-weight: 600;
    }
    #__dev-bubble-header .minimize {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: rgba(255,255,255,0.2);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    #__dev-bubble-header .minimize:hover { background: rgba(255,255,255,0.3); }

    #__dev-bubble-nav {
      display: flex;
      gap: 0;
      padding: 0;
      background: #161627;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    #__dev-bubble-nav::-webkit-scrollbar { display: none; }
    #__dev-bubble-nav button {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: rgba(255,255,255,0.6);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      min-height: 44px;
      -webkit-tap-highlight-color: transparent;
      font-family: inherit;
    }
    #__dev-bubble-nav button:active { background: rgba(255,255,255,0.06); }
    #__dev-bubble-nav button.active {
      color: white;
      border-bottom-color: #667eea;
    }

    #__dev-bubble-urlbar {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      background: #1a1a2e;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    #__dev-bubble-urlbar .icon {
      flex-shrink: 0;
      color: rgba(255,255,255,0.4);
      margin-right: 8px;
      display: flex;
    }
    #__dev-bubble-urlbar input {
      flex: 1;
      background: #0f0f1a;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px;
      padding: 8px 10px;
      color: rgba(255,255,255,0.85);
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      outline: none;
      min-height: 36px;
    }
    #__dev-bubble-urlbar input:focus {
      border-color: #667eea;
      color: white;
    }
    #__dev-bubble-urlbar .go {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      margin-left: 6px;
      border: none;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    #__dev-bubble-urlbar .go:hover { background: rgba(255,255,255,0.12); color: white; }

    #__dev-bubble-iframe {
      flex: 1;
      width: 100%;
      border: none;
      background: #0f0f1a;
    }

    @media (max-width: 768px) {
      #__dev-bubble-header { padding: 10px 16px; }
      #__dev-bubble-header .title { font-size: 14px; }
      #__dev-bubble-header .minimize { width: 48px; height: 48px; }
    }
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // --- DOM ---
  const root = document.createElement("div");
  root.id = "__dev-bubble-root";

  // Panel (always mounted, hidden when minimized)
  const panel = document.createElement("div");
  panel.id = "__dev-bubble-panel";
  panel.className = "hidden";

  // Header
  const header = document.createElement("div");
  header.id = "__dev-bubble-header";
  header.innerHTML = `
    <span class="title">OpenCode</span>
    <button class="minimize" aria-label="Minimize">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M19 13H5v-2h14v2z"/>
      </svg>
    </button>
  `;
  header.querySelector(".minimize")!.addEventListener("click", () => toggle(false));

  // Nav
  const nav = document.createElement("div");
  nav.id = "__dev-bubble-nav";

  const homeBtn = document.createElement("button");
  homeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
    <span>Home</span>
  `;
  homeBtn.addEventListener("click", () => {
    window.location.href = dashboardUrl;
  });
  nav.appendChild(homeBtn);

  // URL bar
  const urlBar = document.createElement("form");
  urlBar.id = "__dev-bubble-urlbar";
  urlBar.innerHTML = `
    <span class="icon">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    </span>
    <input type="text" value="${window.location.href}" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" />
    <button type="submit" class="go" aria-label="Navigate">
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      </svg>
    </button>
  `;
  const urlInput = urlBar.querySelector("input")!;
  urlInput.addEventListener("focus", () => urlInput.select());
  urlBar.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = urlInput.value.trim();
    if (val && val !== window.location.href) {
      window.location.href = val;
    }
    urlInput.blur();
  });

  // OpenCode iframe
  const iframe = document.createElement("iframe");
  iframe.id = "__dev-bubble-iframe";
  iframe.src = opencodeUrl;
  iframe.title = "OpenCode";
  iframe.allow = "clipboard-read; clipboard-write; microphone";

  panel.appendChild(header);
  panel.appendChild(nav);
  panel.appendChild(urlBar);
  panel.appendChild(iframe);

  // Bubble button
  const bubble = document.createElement("button");
  bubble.id = "__dev-bubble-btn";
  bubble.setAttribute("aria-label", "Open assistant");
  bubble.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
    </svg>
  `;

  root.appendChild(panel);
  root.appendChild(bubble);
  document.body.appendChild(root);

  // --- Positioning ---
  function updateBubblePos() {
    bubble.style.left = posX + "px";
    bubble.style.top = posY + "px";
  }
  updateBubblePos();

  window.addEventListener("resize", () => {
    if (!isOpen) {
      posX = Math.min(posX, window.innerWidth - 84);
      posY = Math.min(posY, window.innerHeight - 84);
      updateBubblePos();
    }
  });

  // --- Toggle ---
  function toggle(open: boolean) {
    isOpen = open;
    panel.className = open ? "" : "hidden";
    bubble.style.display = open ? "none" : "flex";
  }

  // --- Bubble click ---
  bubble.addEventListener("click", () => {
    if (!hasDragged) toggle(true);
  });

  // --- Drag (mouse) ---
  bubble.addEventListener("mousedown", (e) => {
    isDragging = true;
    hasDragged = false;
    dragStartX = e.clientX - posX;
    dragStartY = e.clientY - posY;
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    hasDragged = true;
    posX = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragStartX));
    posY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragStartY));
    updateBubblePos();
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // --- Drag (touch) ---
  bubble.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (!t) return;
    isDragging = true;
    hasDragged = false;
    dragStartX = t.clientX - posX;
    dragStartY = t.clientY - posY;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    const t = e.touches[0];
    if (!t) return;
    hasDragged = true;
    posX = Math.max(0, Math.min(window.innerWidth - 60, t.clientX - dragStartX));
    posY = Math.max(0, Math.min(window.innerHeight - 60, t.clientY - dragStartY));
    updateBubblePos();
  }, { passive: true });

  document.addEventListener("touchend", () => {
    isDragging = false;
  });
})();
