/**
 * JG Dispatch — Mobile Support
 * ============================
 * Adds touch-drag and responsive CSS to the dispatch board without
 * modifying index.html's existing drag handlers.
 *
 * HOW IT WORKS:
 * - Intercepts touchstart/touchmove/touchend on [draggable=true] elements
 * - Synthesizes HTML5 drag events (dragstart, dragover, dragleave, drop, dragend)
 *   so the existing onDS/onDE/onDO/onDL/onDD handlers run unchanged
 * - Injects a mobile stylesheet that reflows the board for small screens
 *
 * Include with: <script src="mobile-dispatch.js"></script>
 * Just before </body> — after the board has rendered the existing
 * desktop drag listeners.
 */
(function() {
  'use strict';

  // ── MOBILE CSS ──
  // Tightens the board, increases tap targets, makes the pool scrollable
  var MOBILE_CSS = `
@media (max-width: 900px) {
  body { font-size: 14px; }

  /* Header — compress and allow wrapping */
  .hdr { height: auto; min-height: 50px; padding: 8px 12px; flex-wrap: wrap; gap: 8px; }
  .hdr-l { flex-wrap: wrap; }
  .hdr-r { flex-wrap: wrap; gap: 4px; }
  .clk { display: none; } /* free up header space */
  .logo-tx { font-size: 12px; }
  .pill { font-size: 9px; padding: 2px 6px; }

  /* Stats bar — horizontal scroll instead of wrapping */
  .stats-bar { overflow-x: auto; padding: 0 8px; -webkit-overflow-scrolling: touch; }
  .stats-bar::-webkit-scrollbar { height: 0; }
  .stat { padding: 6px 10px 6px 0; margin-right: 10px; flex-shrink: 0; }
  .stat-val { font-size: 16px; }

  /* Tabs — horizontal scroll, larger tap area */
  .tabs-wrap, .tab-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tab { padding: 10px 14px; font-size: 12px; min-height: 44px; flex-shrink: 0; }

  /* Board — stack tech lanes vertically full-width */
  .board { display: block !important; padding: 8px; }
  .lane {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    margin-bottom: 12px;
  }

  /* Tech header — make it sticky at the top of each lane for scroll context */
  .lane-head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--surface);
  }

  /* Job cards — bigger, finger-friendly */
  .job-card, .uc {
    padding: 10px !important;
    min-height: 54px;
    touch-action: none; /* prevent scroll while dragging */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .job-card .c-jobname, .uc .c-jobname { font-size: 13px; }
  .job-card .c-city, .uc .c-city { font-size: 11px; }
  .hrs-in {
    min-width: 48px;
    min-height: 36px;
    padding: 6px 8px !important;
    font-size: 14px !important;
  }

  /* Time inputs — bigger for thumbs */
  input[type="time"], input[type="number"] {
    min-height: 36px;
    font-size: 14px;
  }

  /* Drag placeholder — more visible on small screens */
  .drag-placeholder {
    height: 54px !important;
    border: 2px dashed var(--orange) !important;
    background: rgba(232, 93, 4, 0.06) !important;
  }

  /* Pool (unassigned) — fixed height with scroll to avoid blocking the board */
  .pool, .pool-body, .unassigned-pool {
    max-height: 40vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* All buttons — 44px min tap target */
  .btn, button {
    min-height: 44px;
    padding: 10px 14px;
    font-size: 13px;
  }
  .btn.sm, button.sm {
    min-height: 36px;
    padding: 6px 10px;
  }

  /* Add-slot (drop zone when no jobs) */
  .add-slot {
    min-height: 60px !important;
    border: 2px dashed var(--border-mid) !important;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--muted);
  }
  .add-slot::before {
    content: '+ drop job here';
    opacity: 0.6;
  }

  /* On-call panel, time panel */
  #oncall-panel, #time-panel {
    padding: 12px !important;
  }

  /* AI assist panel — bottom sheet style */
  #ai-panel {
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: none !important;
    bottom: 0;
    border-radius: 16px 16px 0 0;
    max-height: 70vh;
    overflow-y: auto;
  }

  /* Toast — larger on mobile */
  #toast, .toast {
    left: 16px !important;
    right: 16px !important;
    width: auto !important;
    max-width: none !important;
    font-size: 14px;
    padding: 14px 16px;
  }

  /* Hide the sidebar-reserved space on mobile — sidebar becomes bottom drawer anyway */
  body {
    padding-left: 0 !important;
  }
}

@media (max-width: 480px) {
  /* Extra compression for phones */
  .stat { padding: 4px 8px 4px 0; }
  .stat-val { font-size: 14px; }
  .stat-lbl { font-size: 8px; }
  .logo-tx { display: none; }
  .lane-head { padding: 8px; font-size: 12px; }
}

/* ── TOUCH FEEDBACK ──
   Visual feedback when user picks up a job */
.touch-dragging {
  opacity: 0.4;
  transform: scale(0.98);
}
.touch-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 10000;
  opacity: 0.92;
  transform: rotate(2deg) scale(1.04);
  box-shadow: 0 12px 32px rgba(0,0,0,0.25);
  transition: transform 0.08s ease;
  will-change: transform;
}
.touch-drop-target {
  background: rgba(232, 93, 4, 0.08) !important;
  outline: 2px dashed var(--orange);
  outline-offset: -2px;
}
`;

  // Inject CSS only once
  if (!document.getElementById('jg-mobile-css')) {
    var style = document.createElement('style');
    style.id = 'jg-mobile-css';
    style.textContent = MOBILE_CSS;
    document.head.appendChild(style);
  }

  // ── TOUCH-TO-DRAG POLYFILL ──
  // HTML5 drag events don't fire on touch devices. This captures touch events
  // and dispatches synthetic drag events so existing handlers work unchanged.

  var state = {
    dragging: false,
    source: null,         // element being dragged
    ghost: null,          // floating clone under finger
    lastDropTarget: null, // current [ondragover] target
    startX: 0,
    startY: 0,
    offsetX: 0,           // finger offset inside the source element
    offsetY: 0,
    holdTimer: null,
    moved: false,
    DRAG_THRESHOLD: 8     // pixels before we commit to a drag
  };

  // Fire a synthetic event with dataTransfer that mimics the HTML5 drag API
  function fireDragEvent(type, target, clientX, clientY) {
    if (!target) return false;

    // Build an object that looks enough like a drag event for the handlers
    // Existing handlers use: currentTarget, dataTransfer.effectAllowed,
    //   clientY, classList, preventDefault, dataset, contains, relatedTarget
    var dt = {
      effectAllowed: 'move',
      dropEffect: 'move',
      types: ['application/json'],
      setData: function() {},
      getData: function() { return ''; },
      setDragImage: function() {}
    };

    var evt = {
      type: type,
      target: target,
      currentTarget: target,
      clientX: clientX,
      clientY: clientY,
      dataTransfer: dt,
      relatedTarget: null,
      _defaultPrevented: false,
      preventDefault: function() { this._defaultPrevented = true; },
      stopPropagation: function() {}
    };

    // The real handlers were bound with addEventListener so we need to find
    // and invoke them directly. We stored references at touch-start time.
    var handlers = target._jgTouchHandlers && target._jgTouchHandlers[type];
    if (handlers) {
      handlers.forEach(function(fn) {
        try { fn.call(target, evt); } catch(e) { console.warn('drag handler error', e); }
      });
    }
    return !evt._defaultPrevented;
  }

  // Patch addEventListener on elements we care about so we can invoke the
  // stored handlers during synthetic drag events. This runs lazily: first
  // time we see a touchstart on a [draggable] element, we snapshot its
  // registered drag listeners by re-reading them.
  // Simpler approach: wrap addEventListener on Element.prototype to record
  // drag listeners into a map on the element.
  var origAdd = Element.prototype.addEventListener;
  var DRAG_EVENTS = ['dragstart','dragend','dragover','dragleave','drop'];
  Element.prototype.addEventListener = function(type, listener, opts) {
    if (DRAG_EVENTS.indexOf(type) !== -1) {
      if (!this._jgTouchHandlers) this._jgTouchHandlers = {};
      if (!this._jgTouchHandlers[type]) this._jgTouchHandlers[type] = [];
      this._jgTouchHandlers[type].push(listener);
    }
    return origAdd.call(this, type, listener, opts);
  };

  // Utility: find the element under a touch point, skipping the ghost
  function pointAt(x, y) {
    if (state.ghost) state.ghost.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (state.ghost) state.ghost.style.display = '';
    return el;
  }

  // Find the nearest drop-zone ancestor (an element with ondrop handlers)
  function findDropZone(el) {
    while (el && el !== document.body) {
      if (el._jgTouchHandlers && el._jgTouchHandlers.drop) return el;
      // Fallback: lane-body class used throughout the board
      if (el.classList && el.classList.contains('lane-body')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Create a floating ghost that follows the finger
  function makeGhost(source, x, y) {
    var rect = source.getBoundingClientRect();
    state.offsetX = x - rect.left;
    state.offsetY = y - rect.top;

    var clone = source.cloneNode(true);
    clone.classList.add('touch-ghost');
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.left = (x - state.offsetX) + 'px';
    clone.style.top = (y - state.offsetY) + 'px';
    // Strip any interactive inputs inside clone
    clone.querySelectorAll('input, button').forEach(function(el) {
      el.disabled = true;
    });
    document.body.appendChild(clone);
    return clone;
  }

  function moveGhost(x, y) {
    if (!state.ghost) return;
    state.ghost.style.left = (x - state.offsetX) + 'px';
    state.ghost.style.top = (y - state.offsetY) + 'px';
  }

  function cleanup() {
    if (state.ghost && state.ghost.parentNode) state.ghost.parentNode.removeChild(state.ghost);
    if (state.source) state.source.classList.remove('touch-dragging');
    if (state.lastDropTarget) state.lastDropTarget.classList.remove('touch-drop-target');
    state.dragging = false;
    state.source = null;
    state.ghost = null;
    state.lastDropTarget = null;
    state.moved = false;
    if (state.holdTimer) { clearTimeout(state.holdTimer); state.holdTimer = null; }
  }

  // ── EVENT LISTENERS ──

  document.addEventListener('touchstart', function(e) {
    // Find a draggable ancestor
    var src = e.target;
    while (src && src !== document.body) {
      if (src.getAttribute && src.getAttribute('draggable') === 'true') break;
      src = src.parentElement;
    }
    if (!src || src === document.body) return;

    // Don't hijack taps on inputs/buttons inside the card
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return;

    var t = e.touches[0];
    state.source = src;
    state.startX = t.clientX;
    state.startY = t.clientY;
    state.moved = false;

    // Long-press (180ms) to pick up — prevents conflict with scroll
    state.holdTimer = setTimeout(function() {
      if (!state.source) return;
      if (state.moved) return; // already scrolling
      // Commit to drag
      state.dragging = true;
      state.source.classList.add('touch-dragging');
      state.ghost = makeGhost(state.source, t.clientX, t.clientY);
      if (navigator.vibrate) navigator.vibrate(12);
      fireDragEvent('dragstart', state.source, t.clientX, t.clientY);
    }, 180);
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!state.source) return;
    var t = e.touches[0];
    var dx = t.clientX - state.startX;
    var dy = t.clientY - state.startY;

    // If they moved a lot before the long-press timer, cancel it — they're scrolling
    if (!state.dragging) {
      if (Math.abs(dx) > state.DRAG_THRESHOLD || Math.abs(dy) > state.DRAG_THRESHOLD) {
        state.moved = true;
        if (state.holdTimer) { clearTimeout(state.holdTimer); state.holdTimer = null; }
        state.source = null;
      }
      return;
    }

    // Active drag — block scroll, move ghost
    if (e.cancelable) e.preventDefault();
    moveGhost(t.clientX, t.clientY);

    // Find current drop zone
    var under = pointAt(t.clientX, t.clientY);
    var zone = findDropZone(under);

    if (zone !== state.lastDropTarget) {
      if (state.lastDropTarget) {
        fireDragEvent('dragleave', state.lastDropTarget, t.clientX, t.clientY);
        state.lastDropTarget.classList.remove('touch-drop-target');
      }
      if (zone) {
        zone.classList.add('touch-drop-target');
      }
      state.lastDropTarget = zone;
    }

    if (zone) {
      fireDragEvent('dragover', zone, t.clientX, t.clientY);
    }
  }, { passive: false });

  document.addEventListener('touchend', function(e) {
    if (!state.source) { cleanup(); return; }
    if (!state.dragging) { cleanup(); return; }

    var t = e.changedTouches[0];

    if (state.lastDropTarget) {
      fireDragEvent('drop', state.lastDropTarget, t.clientX, t.clientY);
    }
    fireDragEvent('dragend', state.source, t.clientX, t.clientY);

    cleanup();
  }, { passive: false });

  document.addEventListener('touchcancel', cleanup, { passive: true });

  // ── VIEWPORT FIX ──
  // Ensure the viewport allows tap without 300ms delay and prevents pinch-zoom
  // during drag. We don't override the whole viewport tag since it's already set.
  var v = document.querySelector('meta[name="viewport"]');
  if (v && v.content.indexOf('user-scalable') === -1) {
    // Leave pinch-zoom enabled for accessibility — don't disable it
  }

  // ── PUBLIC ──
  window.JGMobile = {
    active: function() { return state.dragging; },
    cleanup: cleanup
  };

})();
