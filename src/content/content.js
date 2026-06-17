// Watch Your Tone — content script.
// Detects editable fields, shows a floating button, and renders a refinement
// panel inside a shadow root (so the host page's CSS can't interfere).
// It reads text only on explicit user action and replaces text only on approval.

(() => {
  if (window.__wytLoaded) return;
  window.__wytLoaded = true;

  const HOSTNAME = location.hostname;
  let CONFIG = {
    personas: [{ id: "none", name: "No persona", emoji: "✍️" }],
    actions: [
      { id: "improve", label: "Improve", emoji: "✨" },
      { id: "grammar", label: "Fix grammar", emoji: "✅" },
      { id: "concise", label: "Make concise", emoji: "✂️" },
      { id: "tone", label: "Check tone", emoji: "🎚️" },
    ],
    activePersonaId: "none",
    showInlineButton: true,
    disabledSites: [],
  };

  let currentField = null; // the editable element we're attached to
  let capture = null; // snapshot of text taken when the panel opens
  let host = null; // shadow host element
  let root = null; // shadow root
  let btn = null; // floating button element
  let panelOpen = false;

  // ---- editable detection ----------------------------------------------------
  const TEXT_INPUT_TYPES = new Set([
    "text",
    "search",
    "email",
    "url",
    "tel",
    "",
  ]);

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT")
      return (
        !el.disabled &&
        !el.readOnly &&
        TEXT_INPUT_TYPES.has((el.type || "").toLowerCase())
      );
    if (el.isContentEditable) return true;
    return false;
  }

  function siteDisabled() {
    return (CONFIG.disabledSites || []).some((d) => HOSTNAME.includes(d));
  }

  // ---- text capture / replacement -------------------------------------------
  function snapshot(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const hadSelection = end > start;
      const full = el.value || "";
      return {
        el,
        isCE: false,
        hadSelection,
        selStart: start,
        selEnd: end,
        selectedText: hadSelection ? full.slice(start, end) : "",
        fullText: full,
        text: hadSelection ? full.slice(start, end) : full,
      };
    }
    // contenteditable
    const sel = window.getSelection();
    let selectedText = "";
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      // only count selection if it's within the field
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) selectedText = sel.toString();
    }
    const full = el.innerText || "";
    return {
      el,
      isCE: true,
      hadSelection: Boolean(selectedText),
      selectedText,
      fullText: full,
      text: selectedText || full,
    };
  }

  function applyReplacement(cap, newText) {
    const el = cap.el;
    el.focus();

    if (!cap.isCE) {
      if (cap.hadSelection) {
        const before = cap.fullText.slice(0, cap.selStart);
        const after = cap.fullText.slice(cap.selEnd);
        el.value = before + newText + after;
        const pos = (before + newText).length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {}
      } else {
        el.value = newText;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // contenteditable (Slack, Gmail, Notion, etc. — rich editors).
    // execCommand('insertText') is deprecated but remains the most reliable way
    // to write into these editors so their internal state stays consistent.
    const sel = window.getSelection();
    if (!cap.hadSelection) {
      // select the whole field, then overwrite
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const ok = document.execCommand("insertText", false, newText);
    if (!ok) {
      // last-resort fallback
      el.textContent = newText;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ---- messaging -------------------------------------------------------------
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  // ---- UI --------------------------------------------------------------------
  const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wyt-btn {
    position: fixed; z-index: 2147483646; cursor: pointer;
    background: #14b8a6; color: #fff; border: none; border-radius: 999px;
    width: 30px; height: 30px; font-size: 15px; line-height: 30px; text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,.25); padding: 0; user-select: none;
  }
  .wyt-btn:hover { background: #0d9488; }
  .wyt-panel {
    position: fixed; z-index: 2147483647; width: 380px; max-width: calc(100vw - 24px);
    background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,.22); overflow: hidden; font-size: 13px;
  }
  .wyt-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    background: #0f172a; color: #fff; }
  .wyt-title { font-weight: 600; font-size: 13px; flex: 0 0 auto; }
  .wyt-title .dot { color: #2dd4bf; }
  .wyt-persona { margin-left: auto; background: #1e293b; color: #fff; border: 1px solid #334155;
    border-radius: 6px; padding: 3px 6px; font-size: 12px; max-width: 150px; }
  .wyt-close { background: transparent; border: none; color: #cbd5e1; font-size: 16px;
    cursor: pointer; padding: 0 2px; }
  .wyt-body { padding: 12px; max-height: 70vh; overflow: auto; }
  .wyt-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .wyt-action { border: 1px solid #d1d5db; background: #f9fafb; border-radius: 999px;
    padding: 4px 10px; font-size: 12px; cursor: pointer; color: #111827; }
  .wyt-action:hover { background: #ecfdf5; border-color: #5eead4; }
  .wyt-section-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: #6b7280; margin: 8px 0 4px; }
  .wyt-orig { background: #f3f4f6; border-radius: 8px; padding: 8px; white-space: pre-wrap;
    color: #374151; max-height: 90px; overflow: auto; }
  .wyt-tone { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 8px;
    padding: 8px; margin: 8px 0; }
  .wyt-warn { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px;
    padding: 6px 8px; margin: 6px 0; font-size: 12px; }
  .wyt-sugg-label { font-size: 11px; color: #0d9488; font-weight: 600; margin-bottom: 3px; }
  .wyt-result { border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 8px; padding: 8px; margin-bottom: 10px; }
  .wyt-suggest { width: 100%; min-height: 70px; resize: vertical; border: 1px solid #d1d5db;
    border-radius: 6px; padding: 6px; font-size: 13px; color: #111827; background: #fff; }
  .wyt-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .wyt-primary { background: #14b8a6; color: #fff; border: none; border-radius: 6px;
    padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: 600; }
  .wyt-primary:hover { background: #0d9488; }
  .wyt-ghost { background: #fff; color: #111827; border: 1px solid #d1d5db; border-radius: 6px;
    padding: 6px 10px; font-size: 12px; cursor: pointer; }
  .wyt-ghost:hover { background: #f3f4f6; }
  .wyt-status { color: #6b7280; font-size: 12px; padding: 6px 0; }
  .wyt-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px;
    padding: 8px; }
  .wyt-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #d1d5db;
    border-top-color: #14b8a6; border-radius: 50%; animation: wyt-spin .7s linear infinite; vertical-align: -1px; margin-right: 6px; }
  @keyframes wyt-spin { to { transform: rotate(360deg); } }
  .wyt-link { color: #0d9488; cursor: pointer; text-decoration: underline; }
  `;

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.id = "wyt-host";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function showButton() {
    if (!CONFIG.showInlineButton || siteDisabled() || !currentField) return;
    ensureHost();
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "wyt-btn";
      btn.title = "Watch Your Tone";
      btn.textContent = "✎";
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => openPanel());
      root.appendChild(btn);
    }
    positionButton();
    btn.style.display = "block";
  }

  function hideButton() {
    if (btn) btn.style.display = "none";
  }

  function positionButton() {
    if (!btn || !currentField) return;
    const r = currentField.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hideButton();
      return;
    }
    const top = Math.min(Math.max(r.bottom - 36, 8), window.innerHeight - 38);
    const left = Math.min(Math.max(r.right - 36, 8), window.innerWidth - 38);
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
  }

  let panel = null;
  function buildPanel() {
    ensureHost();
    panel = document.createElement("div");
    panel.className = "wyt-panel";

    const personaOpts = CONFIG.personas
      .map(
        (p) =>
          `<option value="${p.id}" ${
            p.id === CONFIG.activePersonaId ? "selected" : ""
          }>${p.emoji || ""} ${escapeHtml(p.name)}</option>`
      )
      .join("");

    const actionBtns = CONFIG.actions
      .map(
        (a) =>
          `<button class="wyt-action" data-action="${a.id}">${a.emoji || ""} ${escapeHtml(
            a.label
          )}</button>`
      )
      .join("");

    panel.innerHTML = `
      <div class="wyt-head">
        <span class="wyt-title"><span class="dot">●</span> Watch Your Tone</span>
        <select class="wyt-persona" title="Persona">${personaOpts}</select>
        <button class="wyt-close" title="Close">×</button>
      </div>
      <div class="wyt-body">
        <div class="wyt-actions">${actionBtns}</div>
        <div class="wyt-section-label">Your message</div>
        <div class="wyt-orig"></div>
        <div class="wyt-out"></div>
      </div>
    `;
    root.appendChild(panel);

    panel.querySelector(".wyt-close").addEventListener("click", closePanel);
    panel.querySelector(".wyt-persona").addEventListener("change", (e) => {
      CONFIG.activePersonaId = e.target.value;
    });
    panel.querySelectorAll(".wyt-action").forEach((b) => {
      b.addEventListener("click", () => runAction(b.dataset.action));
    });
    return panel;
  }

  function positionPanel() {
    if (!panel || !currentField) return;
    const r = currentField.getBoundingClientRect();
    const pw = 380;
    let left = Math.min(r.left, window.innerWidth - pw - 12);
    left = Math.max(12, left);
    let top = r.bottom + 8;
    const ph = panel.offsetHeight || 320;
    if (top + ph > window.innerHeight - 8) {
      top = Math.max(8, r.top - ph - 8);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function openPanel(initialAction) {
    if (!currentField) return;
    capture = snapshot(currentField);
    if (!panel) buildPanel();
    panel.style.display = "block";
    panelOpen = true;
    hideButton();
    panel.querySelector(".wyt-orig").textContent =
      capture.text || "(empty — type a message first)";
    panel.querySelector(".wyt-out").innerHTML = capture.text
      ? `<div class="wyt-status">Pick an action above to refine your message.</div>`
      : `<div class="wyt-status">Type a message in the box, then pick an action.</div>`;
    positionPanel();
    if (initialAction && capture.text) runAction(initialAction);
  }

  function closePanel() {
    if (panel) panel.style.display = "none";
    panelOpen = false;
    capture = null;
  }

  async function runAction(actionId) {
    const out = panel.querySelector(".wyt-out");
    if (!capture || !capture.text) {
      out.innerHTML = `<div class="wyt-status">There's no text to work on yet.</div>`;
      return;
    }
    out.innerHTML = `<div class="wyt-status"><span class="wyt-spinner"></span>Working…</div>`;

    const resp = await send({
      type: "WYT_REWRITE",
      payload: {
        actionId,
        personaId: CONFIG.activePersonaId,
        text: capture.text,
        hostname: HOSTNAME,
      },
    });

    if (!resp || !resp.ok) {
      const msg = resp?.error || "Something went wrong.";
      out.innerHTML = `<div class="wyt-error">${escapeHtml(msg)} ${
        resp?.needsSetup
          ? `<span class="wyt-link" data-open-settings>Open settings</span>`
          : ""
      }</div>`;
      const link = out.querySelector("[data-open-settings]");
      if (link)
        link.addEventListener("click", () => send({ type: "WYT_OPEN_OPTIONS" }));
      return;
    }

    renderResult(resp.result);
  }

  function renderResult(result) {
    const out = panel.querySelector(".wyt-out");
    let html = "";
    if (result.toneFeedback) {
      html += `<div class="wyt-section-label">How it may come across</div>
               <div class="wyt-tone">${escapeHtml(result.toneFeedback)}</div>`;
    }
    (result.warnings || []).forEach((w) => {
      html += `<div class="wyt-warn">⚠ ${escapeHtml(w)}</div>`;
    });
    html += `<div class="wyt-section-label">Suggestion${
      result.suggestions.length > 1 ? "s" : ""
    }</div>`;

    result.suggestions.forEach((s, i) => {
      html += `<div class="wyt-result" data-sugg="${i}">
        <div class="wyt-sugg-label">${escapeHtml(s.label || "Suggestion")}</div>
        <textarea class="wyt-suggest">${escapeHtml(s.text)}</textarea>
        <div class="wyt-row">
          <button class="wyt-primary" data-replace="${i}">Replace</button>
          <button class="wyt-ghost" data-copy="${i}">Copy</button>
        </div>
      </div>`;
    });

    html += `<div class="wyt-row" style="margin-top:8px">
      <button class="wyt-ghost" data-regen>↻ Try again</button>
    </div>`;

    out.innerHTML = html;

    out.querySelectorAll("[data-replace]").forEach((b) => {
      b.addEventListener("click", () => {
        const idx = b.dataset.replace;
        const ta = out.querySelector(`[data-sugg="${idx}"] .wyt-suggest`);
        applyReplacement(capture, ta.value);
        closePanel();
      });
    });
    out.querySelectorAll("[data-copy]").forEach((b) => {
      b.addEventListener("click", async () => {
        const idx = b.dataset.copy;
        const ta = out.querySelector(`[data-sugg="${idx}"] .wyt-suggest`);
        try {
          await navigator.clipboard.writeText(ta.value);
          b.textContent = "Copied ✓";
          setTimeout(() => (b.textContent = "Copy"), 1200);
        } catch {
          b.textContent = "Copy failed";
        }
      });
    });
    const regen = out.querySelector("[data-regen]");
    if (regen) regen.addEventListener("click", () => runAction("improve"));
    positionPanel();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- focus tracking --------------------------------------------------------
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (isEditable(el)) {
        currentField = el;
        if (!panelOpen) showButton();
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      // Delay so clicking our button/panel doesn't immediately hide it.
      setTimeout(() => {
        const active = document.activeElement;
        if (active === host) return; // focus moved into shadow UI
        if (!panelOpen) hideButton();
      }, 150);
    },
    true
  );

  window.addEventListener(
    "scroll",
    () => {
      if (panelOpen) positionPanel();
      else positionButton();
    },
    true
  );
  window.addEventListener("resize", () => {
    if (panelOpen) positionPanel();
    else positionButton();
  });

  // Keyboard shortcut: Ctrl/Cmd+Shift+E opens the panel on the focused field.
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "E" || e.key === "e")
      ) {
        const el = document.activeElement;
        if (isEditable(el)) {
          e.preventDefault();
          currentField = el;
          openPanel();
        }
      }
    },
    true
  );

  // Messages from background (context menu, popup).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "WYT_OPEN_PANEL") {
      const el = document.activeElement;
      if (isEditable(el)) currentField = el;
      if (currentField) openPanel(msg.actionId || "improve");
    } else if (msg?.type === "WYT_CONFIG_UPDATED") {
      loadConfig();
    }
  });

  // ---- init ------------------------------------------------------------------
  async function loadConfig() {
    const resp = await send({ type: "WYT_GET_CONFIG" });
    if (resp && resp.ok) {
      CONFIG = { ...CONFIG, ...resp };
      // rebuild panel next time it opens to reflect new persona/action lists
      if (panel) {
        panel.remove();
        panel = null;
      }
    }
  }
  loadConfig();
})();
