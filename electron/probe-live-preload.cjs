// Preload injected into the "Probar" window (the owned, same-origin surface that
// renders the user's running app). Phase 1 of Live coding: it establishes the
// "living surface" — tracking the real cursor and the real DOM element(s) under
// it within a physical radius, and rendering the subtle blur-halo feedback.
//
// This runs in an isolated world but shares the page DOM, so it can inject the
// overlay and read `elementFromPoint`. It reports pointer/element context to the
// main process for later phases (voice → prompt), and shows a live element label.
const { ipcRenderer } = require("electron");

// ~2.2 cm around the cursor. 1cm ≈ 96/2.54 CSS px at standard density.
const CM_TO_PX = 96 / 2.54;
const RADIUS_PX = Math.round(2.2 * CM_TO_PX); // ≈ 83px

const plog = (...a) => {
  try {
    console.log("[Live]", ...a);
  } catch {
    /* ignore */
  }
  try {
    ipcRenderer.send("cocreate:live:log", a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  } catch {
    /* ignore */
  }
};

// The overlay renders on the TOP document (above the iframes, always visible); the
// tracking reads from TD (the left iframe in split). To place an overlay element at
// the coordinates of something in TD, we shift by the iframe's position in the top
// document. In single view TD === document so the offset is zero.
function frameOffset(TD) {
  if (TD === document) return { x: 0, y: 0 };
  try {
    const fr = document.getElementById("cc-left");
    if (fr) {
      const r = fr.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }
  } catch {
    /* ignore */
  }
  return { x: 0, y: 0 };
}

// TD/TW = the document/window the cursor tracking operates on. In single view
// that's the page itself; in split view it's the LEFT iframe (the frozen
// original) so pointing detects its real elements and code context.
function init(TD, TW) {
  if (window.__ccLiveInjected) return;
  window.__ccLiveInjected = true;
  TD = TD || document;
  TW = TW || window;
  plog("init running; trackDoc =", TD === document ? "TOP (wrapper/page)" : "LEFT IFRAME", "| body?", Boolean(TD.body));

  // The visual overlay (halo, label, dots) always renders on the TOP document so
  // it's above the iframes and visible; only the tracking reads from TD (iframe).
  const style = document.createElement("style");
  style.textContent = `
    .cc-live-halo, .cc-live-ring {
      position: fixed; top: 0; left: 0;
      width: ${RADIUS_PX * 2}px; height: ${RADIUS_PX * 2}px;
      margin-left: -${RADIUS_PX}px; margin-top: -${RADIUS_PX}px;
      border-radius: 50%; pointer-events: none; z-index: 2147483646;
      will-change: transform;
    }
    .cc-live-halo {
      /* Very subtle background distortion around the cursor. */
      backdrop-filter: blur(1.8px) saturate(1.04);
      -webkit-backdrop-filter: blur(1.8px) saturate(1.04);
      -webkit-mask-image: radial-gradient(circle, rgba(0,0,0,0.95) 28%, rgba(0,0,0,0.4) 58%, transparent 74%);
      mask-image: radial-gradient(circle, rgba(0,0,0,0.95) 28%, rgba(0,0,0,0.4) 58%, transparent 74%);
    }
    .cc-live-ring {
      box-shadow: 0 0 0 1px rgba(124,124,255,0.22), 0 0 26px rgba(124,124,255,0.16);
    }
    .cc-live-label {
      position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483647;
      transform: translate(14px, 14px);
      font: 500 11px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif;
      color: #fff; background: rgba(18,18,28,0.82); padding: 3px 7px; border-radius: 6px;
      max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      backdrop-filter: blur(4px); box-shadow: 0 4px 14px rgba(0,0,0,0.28);
    }
  `;
  document.documentElement.appendChild(style);

  const halo = document.createElement("div");
  halo.className = "cc-live-halo";
  const ring = document.createElement("div");
  ring.className = "cc-live-ring";
  const label = document.createElement("div");
  label.className = "cc-live-label";
  label.style.display = "none";

  const mount = () => (document.body || document.documentElement).append(halo, ring, label);
  mount();

  const OWN = new Set([halo, ring, label]);

  const describe = (el) => {
    if (!el || !el.tagName) return "";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const className = typeof el.className === "string" ? el.className.trim() : "";
    const cls = className ? "." + className.split(/\s+/).slice(0, 2).join(".") : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${tag}${id}${cls}${text ? ` — "${text}"` : ""}`;
  };

  // Build a stable-ish CSS selector path so a task's dot can re-anchor to the same
  // element after scroll/reload.
  const cssPath = (el) => {
    if (!el || !el.tagName || el === TD.body || el === TD.documentElement) return "";
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== TD.body && depth < 6) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        sel += `#${CSS.escape(node.id)}`;
        parts.unshift(sel);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) sel += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  };

  // Collect the distinct elements within the physical radius by sampling the
  // center and a ring of points around it.
  const elementsInRadius = (x, y) => {
    const found = [];
    const seen = new Set();
    const r = RADIUS_PX;
    const offsets = [
      [0, 0], [r, 0], [-r, 0], [0, r], [0, -r],
      [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]
    ];
    for (const [dx, dy] of offsets) {
      const el = TD.elementFromPoint(x + dx, y + dy);
      if (el && !OWN.has(el) && !seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }
    return found;
  };

  // Latest cursor context, shared with the Live voice loop.
  const state = { cursorContext: "", pointer: { x: 0.5, y: 0.5 }, anchor: "", anchorText: "", anchorTag: "" };

  let lastSent = 0;
  const onMove = (event) => {
    // Raw coords are in TD's (iframe) viewport; overlay lives on the top document.
    const x = event.clientX;
    const y = event.clientY;
    const off = frameOffset(TD);
    const ox = x + off.x;
    const oy = y + off.y;
    halo.style.transform = `translate(${ox}px, ${oy}px)`;
    ring.style.transform = `translate(${ox}px, ${oy}px)`;
    label.style.left = `${ox}px`;
    label.style.top = `${oy}px`;

    const elements = elementsInRadius(x, y);
    const primary = elements[0];
    const described = elements.slice(0, 6).map(describe).filter(Boolean);
    if (primary) {
      label.style.display = "block";
      label.textContent = describe(primary);
    }
    state.pointer = { x: x / Math.max(1, TW.innerWidth), y: y / Math.max(1, TW.innerHeight) };
    state.cursorContext = described.slice(0, 3).join("; ");
    state.anchor = primary ? cssPath(primary) : "";
    state.anchorTag = primary && primary.tagName ? primary.tagName.toLowerCase() : "";
    state.anchorText = primary ? (primary.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) : "";

    const now = Date.now();
    if (now - lastSent > 120) {
      lastSent = now;
      try {
        ipcRenderer.send("cocreate:live:pointer", {
          x: state.pointer.x,
          y: state.pointer.y,
          radiusPx: RADIUS_PX,
          elements: described
        });
      } catch {
        /* channel not ready */
      }
    }
  };

  TD.addEventListener("mousemove", onMove, { passive: true });
  TD.addEventListener("mouseleave", () => {
    label.style.display = "none";
  });

  initLiveControls(state, TD, TW);
}

// ---- Live coding controls: toggle button + voice + task markers ----
// Controls (button/tabs/pill/voice) live on the TOP document; task markers are
// rendered on TD (the tracked doc — the left iframe in split view).
function initLiveControls(state, TD, TW) {
  TD = TD || document;
  TW = TW || window;
  const style = document.createElement("style");
  style.textContent = `
    .cc-live-btn {
      position: fixed; top: 14px; right: 14px; z-index: 2147483647;
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(124,124,255,0.4);
      background: rgba(18,18,28,0.82); color: #fff; font: 600 12px/1 system-ui, sans-serif;
      cursor: pointer; backdrop-filter: blur(8px); box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    }
    .cc-live-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: #8a8aff; }
    .cc-live-btn.on { border-color: #ff4d6d; background: rgba(40,10,20,0.85); }
    .cc-live-btn.on .dot { background: #ff4d6d; animation: cc-pulse 1s infinite; }
    @keyframes cc-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.4)} }
    @keyframes cc-spin { to { transform: rotate(360deg); } }

    .cc-markers { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
    .cc-marker { position: fixed; transform: translate(-50%, -50%); }
    /* recording: white dot that morphs into a check button on hover (Apple/OpenAI feel) */
    .cc-dot {
      width: 15px; height: 15px; border-radius: 50%; background: rgba(255,255,255,0.96);
      box-shadow: 0 0 0 4px rgba(255,255,255,0.16), 0 2px 12px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      pointer-events: auto; transition: width .16s ease, height .16s ease;
    }
    .cc-dot:hover { width: 32px; height: 32px; }
    .cc-dot .check { opacity: 0; color: #111; font-size: 16px; line-height: 1; transition: opacity .12s ease; }
    .cc-dot:hover .check { opacity: 1; }
    /* executing: spinner + a small horizontal live dialog above it */
    .cc-spin {
      width: 30px; height: 30px; border-radius: 50%;
      border: 3px solid rgba(124,124,255,0.3); border-top-color: #7c7cff;
      animation: cc-spin 0.8s linear infinite;
    }
    .cc-dialog {
      position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%);
      min-width: 200px; max-width: 340px; padding: 8px 12px; border-radius: 12px;
      background: rgba(16,16,24,0.94); color: #eee; font: 500 12px/1.4 system-ui, sans-serif;
      backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(0,0,0,0.42); text-align: center;
    }
    .cc-dialog-prompt {
      border: 1px solid rgba(124,124,255,0.35); text-align: left; color: #dfe0ff;
      max-height: 140px; overflow: auto; white-space: pre-wrap;
    }
    /* done: green check; hover reveals Codex's final summary */
    .cc-done {
      width: 26px; height: 26px; border-radius: 50%; background: #34d399; color: #063;
      display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700;
      pointer-events: auto; box-shadow: 0 2px 14px rgba(52,211,153,0.5); cursor: pointer;
    }
    .cc-marker.failed .cc-done { background: #f87171; color: #400; }
    .cc-fail .retry { display: none; }
    .cc-fail:hover .bang { display: none; }
    .cc-fail:hover .retry { display: inline; }
    .cc-summary {
      position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); display: none;
      min-width: 220px; max-width: 360px; max-height: 220px; overflow: auto; padding: 10px 12px;
      border-radius: 12px; background: rgba(16,16,24,0.97); color: #eee; text-align: left;
      font: 500 12px/1.5 system-ui, sans-serif; backdrop-filter: blur(10px);
      box-shadow: 0 12px 34px rgba(0,0,0,0.48); white-space: pre-wrap;
    }
    .cc-marker:hover .cc-summary { display: block; }
    .cc-tabs {
      position: fixed; top: 14px; right: 92px; z-index: 2147483647; display: inline-flex; gap: 3px;
      padding: 4px; border-radius: 999px; background: rgba(18,18,28,0.82); backdrop-filter: blur(8px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    }
    .cc-tab {
      width: 32px; height: 26px; display: flex; align-items: center; justify-content: center;
      border-radius: 999px; cursor: pointer; color: #9a9aa8; border: none; background: transparent;
    }
    .cc-tab.active { background: rgba(124,124,255,0.32); color: #fff; }
    .cc-green-pill {
      position: fixed; bottom: 22px; right: 22px; z-index: 2147483647; display: inline-flex;
      align-items: center; gap: 9px; padding: 13px 24px; border-radius: 999px; background: #22c55e;
      color: #052e16; font: 700 14px system-ui, sans-serif; border: none; cursor: pointer;
      box-shadow: 0 8px 26px rgba(34,197,94,0.5);
    }
    .cc-green-pill:hover { background: #16a34a; }
  `;
  document.documentElement.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "cc-live-btn";
  btn.innerHTML = '<span class="dot"></span><span class="txt">Live</span>';
  // Markers render on the TOP document so they sit above the iframes and are always
  // visible in split view; positioning shifts them by the iframe offset.
  const markers = document.createElement("div");
  markers.className = "cc-markers";
  (document.body || document.documentElement).append(btn, markers);

  // --- Split / Single view tabs (next to the Live button) ---
  const isSplit = location.pathname.includes("__split__");
  const canSplit = isSplit || location.search.includes("__ccsplit");
  const SPLIT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
  const SINGLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/></svg>';
  const goSingle = () => {
    const clean = location.origin + "/" + (location.search ? location.search : "?__ccsplit=1");
    location.href = clean;
  };
  const goSplit = () => {
    location.href = location.origin + "/__split__";
  };
  if (canSplit) {
    const tabs = document.createElement("div");
    tabs.className = "cc-tabs";
    const tSplit = document.createElement("button");
    tSplit.className = "cc-tab" + (isSplit ? " active" : "");
    tSplit.title = "Vista dividida (original / en edición)";
    tSplit.innerHTML = SPLIT_ICON;
    tSplit.addEventListener("click", () => {
      if (!isSplit) goSplit();
    });
    const tSingle = document.createElement("button");
    tSingle.className = "cc-tab" + (isSplit ? "" : " active");
    tSingle.title = "Vista única";
    tSingle.innerHTML = SINGLE_ICON;
    tSingle.addEventListener("click", () => {
      if (isSplit) goSingle();
    });
    tabs.append(tSplit, tSingle);
    (document.body || document.documentElement).append(tabs);
  }


  // Position a marker anchored to its DOM element (sticky through scroll/edits).
  let markerEls = []; // { el, task, target }
  const isContainerEl = (el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width === 0 || r.height === 0 || r.width > TW.innerWidth * 0.85 || r.height > TW.innerHeight * 0.85
    );
  };
  // Resolve the anchored element: first by selector, then by tag+text (robust to
  // selector drift after edits), else null (fall back to recorded coordinate).
  const resolveTarget = (task) => {
    if (task.anchor) {
      try {
        const t = TD.querySelector(task.anchor);
        if (t && !isContainerEl(t)) return t;
      } catch {
        /* invalid selector */
      }
    }
    if (task.anchorTag && task.anchorText) {
      try {
        const list = TD.getElementsByTagName(task.anchorTag);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const txt = (c.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
          if (txt && txt === task.anchorText && !isContainerEl(c)) return c;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  };
  const positionMarker = (entry) => {
    if (!entry.target || !entry.target.isConnected) entry.target = resolveTarget(entry.task);
    const off = frameOffset(TD);
    let left;
    let top;
    if (entry.target) {
      const r = entry.target.getBoundingClientRect();
      left = r.left + r.width / 2;
      top = r.top + r.height / 2;
    } else {
      left = entry.task.x * TW.innerWidth;
      top = entry.task.y * TW.innerHeight;
    }
    entry.el.style.left = `${left + off.x}px`;
    entry.el.style.top = `${top + off.y}px`;
  };

  // Render task markers from main: recording (white dot → check), executing
  // (spinner + live dialog), done (green check → summary on hover).
  const renderTasks = (list) => {
    plog("renderTasks:", list.length, "tasks; markers on TOP doc; TD =", TD === document ? "page" : "iframe");
    markers.innerHTML = "";
    markerEls = [];
    for (const task of list) {
      const m = document.createElement("div");
      m.className = "cc-marker " + task.status;
      const entry = { el: m, task, target: null };
      positionMarker(entry);

      if (task.status === "recording") {
        const dot = document.createElement("div");
        dot.className = "cc-dot";
        dot.title = "Ejecutar esta tarea";
        const chk = document.createElement("span");
        chk.className = "check";
        chk.textContent = "✓";
        dot.appendChild(chk);
        // pointerdown fires immediately (no click delay); stop it reaching the page.
        const fire = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          log("dot POINTERDOWN task=" + task.id);
          // Optimistic instant feedback: swap to a spinner right away.
          m.className = "cc-marker executing";
          dot.remove();
          const sp = document.createElement("div");
          sp.className = "cc-spin";
          m.appendChild(sp);
          ipcRenderer
            .invoke("cocreate:live:dispatch-task", { id: task.id })
            .then(() => log("dispatch-task ack task=" + task.id))
            .catch((err) => log("dispatch-task error:" + String(err)));
        };
        dot.addEventListener("pointerdown", fire);
        m.appendChild(dot);
        // The prompt being designed for this task, shown live (like Codex's dialog).
        if (task.prompt) {
          const d = document.createElement("div");
          d.className = "cc-dialog cc-dialog-prompt";
          d.textContent = task.prompt;
          m.appendChild(d);
        }
      } else if (task.status === "executing") {
        const sp = document.createElement("div");
        sp.className = "cc-spin";
        m.appendChild(sp);
        if (task.progress) {
          const d = document.createElement("div");
          d.className = "cc-dialog";
          d.textContent = task.progress;
          m.appendChild(d);
        }
      } else if (task.status === "failed") {
        // Red marker → hover shows a retry icon → click retries.
        const badge = document.createElement("div");
        badge.className = "cc-done cc-fail";
        badge.title = "Reintentar";
        badge.innerHTML = '<span class="bang">!</span><span class="retry">↻</span>';
        badge.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          log("retry task=" + task.id);
          m.className = "cc-marker executing";
          badge.remove();
          const sp = document.createElement("div");
          sp.className = "cc-spin";
          m.appendChild(sp);
          ipcRenderer.invoke("cocreate:live:retry-task", { id: task.id }).catch(() => {});
        });
        m.appendChild(badge);
        if (task.summary) {
          const s = document.createElement("div");
          s.className = "cc-summary";
          s.textContent = task.summary;
          m.appendChild(s);
        }
      } else {
        // Green check (done) → click dismisses.
        const done = document.createElement("div");
        done.className = "cc-done";
        done.textContent = "✓";
        done.title = "Clic para descartar";
        done.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          log("dismiss task=" + task.id);
          m.remove(); // instant
          ipcRenderer.invoke("cocreate:live:dismiss-task", { id: task.id }).catch(() => {});
        });
        m.appendChild(done);
        if (task.summary) {
          const s = document.createElement("div");
          s.className = "cc-summary";
          s.textContent = task.summary;
          m.appendChild(s);
        }
      }
      markers.appendChild(m);
      markerEls.push(entry);
    }
  };

  // Keep markers stuck to their elements while the page scrolls/resizes. A rAF
  // loop also catches layout shifts (fonts, images, edits) so anchoring stays firm.
  let rafPending = false;
  const reposition = () => {
    for (const entry of markerEls) positionMarker(entry);
  };
  const onScrollOrResize = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      reposition();
    });
  };
  TW.addEventListener("scroll", onScrollOrResize, true);
  TW.addEventListener("resize", onScrollOrResize);
  // Top window resize changes the iframe offset, so reposition there too.
  if (TW !== window) {
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
  }
  // Continuous light reposition so dots track through async layout changes.
  setInterval(() => {
    if (markerEls.length) reposition();
  }, 300);

  // Navigating single↔split reuses the renderer process, so previous-page listeners
  // would linger and render into detached overlays. Clear them before re-registering.
  ipcRenderer.removeAllListeners("cocreate:live:tasks");
  ipcRenderer.removeAllListeners("cocreate:live:refresh");
  ipcRenderer.on("cocreate:live:tasks", (_event, payload) => renderTasks((payload && payload.tasks) || []));

  // Refresh after a Codex edit: reload only the right pane in split view (keeping
  // the frozen snapshot + dots stable), or the whole page in single view.
  ipcRenderer.on("cocreate:live:refresh", () => {
    if (location.pathname.includes("__split__")) {
      const right = document.getElementById("cc-right");
      try {
        if (right && right.contentWindow) right.contentWindow.location.reload();
      } catch {
        /* ignore */
      }
    } else {
      location.reload();
    }
  });

  // Full logging: mirror to the window console AND to the main process so we can
  // trace the whole Live pipeline while polishing it.
  const log = (...args) => {
    try {
      console.log("[Live]", ...args);
    } catch {
      /* ignore */
    }
    try {
      ipcRenderer.send(
        "cocreate:live:log",
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
      );
    } catch {
      /* ignore */
    }
  };

  // Real-time transcript bar at the bottom (so the user sees Codex is listening).
  const bar = document.createElement("div");
  bar.className = "cc-live-transcript";
  Object.assign(bar.style, {
    position: "fixed",
    left: "50%",
    bottom: "18px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    maxWidth: "72vw",
    display: "none",
    padding: "10px 16px",
    borderRadius: "14px",
    background: "rgba(16,16,24,0.9)",
    backdropFilter: "blur(10px)",
    color: "#fff",
    font: "500 14px/1.4 system-ui, sans-serif",
    boxShadow: "0 10px 34px rgba(0,0,0,0.4)"
  });
  (document.body || document.documentElement).appendChild(bar);
  let finalText = "";
  const showTranscript = (interim) => {
    const text = `${finalText} ${interim || ""}`.trim();
    bar.textContent = text || "Escuchando…";
    bar.style.display = "block";
  };

  // Voice: real-time streaming via Deepgram WebSocket. Interim results update the
  // transcript bar word-by-word; final results are sent as segments to main.
  let live = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let dgSocket = null;

  const startVoice = async () => {
    let token = "";
    try {
      const r = await ipcRenderer.invoke("cocreate:live:deepgram-token");
      token = (r && r.token) || "";
    } catch (e) {
      log("deepgram-token error:", String(e));
    }
    if (!token) {
      bar.textContent = "Falta la key de Deepgram.";
      bar.style.display = "block";
      log("ERROR: no deepgram token");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      log("getUserMedia granted; opening Deepgram stream");
    } catch (e) {
      log("getUserMedia error:", String(e));
      bar.textContent = "No pude acceder al micrófono.";
      bar.style.display = "block";
      return;
    }

    const url =
      "wss://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true&interim_results=true&punctuate=true";
    // Deepgram accepts the API key via the WS subprotocol ["token", key].
    try {
      dgSocket = new WebSocket(url, ["token", token]);
    } catch (e) {
      log("WebSocket create error:", String(e));
      return;
    }

    dgSocket.onopen = () => {
      log("Deepgram WS open");
      try {
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });
      } catch (e) {
        log("MediaRecorder error:", String(e));
        return;
      }
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size && dgSocket && dgSocket.readyState === 1) dgSocket.send(e.data);
      };
      mediaRecorder.start(250); // stream in 250ms chunks
    };

    dgSocket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
      const text = alt && alt.transcript ? alt.transcript.trim() : "";
      if (!text) return;
      if (msg.is_final) {
        finalText = `${finalText} ${text}`.trim();
        showTranscript("");
        log("FINAL:", text);
        ipcRenderer
          .invoke("cocreate:live:segment", {
            segment: text,
            cursorContext: state.cursorContext,
            pointer: state.pointer,
            anchor: state.anchor,
            anchorText: state.anchorText,
            anchorTag: state.anchorTag
          })
          .catch((e) => log("segment error:", String(e)));
      } else {
        showTranscript(text); // interim — real-time
      }
    };

    dgSocket.onerror = (e) => log("Deepgram WS error:", String((e && e.message) || "error"));
    dgSocket.onclose = (e) => log("Deepgram WS close", e && e.code);
  };

  const stopVoice = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    if (dgSocket) {
      try {
        if (dgSocket.readyState === 1) dgSocket.send(JSON.stringify({ type: "CloseStream" }));
        dgSocket.close();
      } catch {
        /* ignore */
      }
      dgSocket = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  };

  const setLive = async (on) => {
    live = on;
    btn.classList.toggle("on", on);
    btn.querySelector(".txt").textContent = on ? "Live activo" : "Live";
    log("setLive:", on);
    try {
      window.sessionStorage.setItem("ccLive", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (on) {
      // Clear only the transcript display — task markers PERSIST across toggles.
      finalText = "";
      showTranscript("");
      await startVoice();
    } else {
      bar.style.display = "none";
      stopVoice();
    }
  };

  btn.addEventListener("click", () => {
    void setLive(!live);
  });

  // Auto-resume Live after the window reloads following an applied edit.
  let resume = false;
  try {
    resume = window.sessionStorage.getItem("ccLive") === "1";
  } catch {
    /* ignore */
  }
  log("initLiveControls ready; resume=" + resume);
  if (resume) void setLive(true);
}

// In split view the cursor tracking must run inside the LEFT iframe (same-origin
// frozen original). Wait for it to load, then init against its document.
function boot() {
  const isSplit = location.pathname.includes("__split__");
  plog("boot: isSplit =", isSplit, "path =", location.pathname);
  if (!isSplit) {
    init(document, window);
    return;
  }
  const left = document.getElementById("cc-left");
  if (!left) {
    plog("boot: LEFT iframe not found → fallback to top doc");
    init(document, window);
    return;
  }
  const run = () => {
    try {
      plog("boot: left iframe ready → init on iframe doc");
      init(left.contentDocument || document, left.contentWindow || window);
    } catch (e) {
      plog("boot: iframe access threw → fallback:", String(e));
      init(document, window);
    }
  };
  const idoc = (() => {
    try {
      return left.contentDocument;
    } catch {
      return null;
    }
  })();
  if (idoc && idoc.body && idoc.readyState !== "loading") {
    plog("boot: iframe already loaded → run now");
    run();
  } else {
    plog("boot: waiting for iframe load event (readyState=" + (idoc ? idoc.readyState : "no-idoc") + ")");
    left.addEventListener("load", run, { once: true });
    // Safety: if the load event was missed, poll briefly.
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      try {
        const d = left.contentDocument;
        if (d && d.body && d.readyState === "complete") {
          clearInterval(poll);
          if (!window.__ccLiveInjected) run();
        }
      } catch {
        /* ignore */
      }
      if (tries > 40) clearInterval(poll);
    }, 150);
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
