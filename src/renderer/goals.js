// Goals (v0.8.2): word-count targets for the day, week, month and the whole book.
// The writer clicks the word counter at the bottom to see and set them. Targets live in the store
// (undoable); progress is derived from the store's word counts, never kept as a second copy here.
// Loads after app.js (which fills the counter) and before home.js.
(() => {
  'use strict';
  const emw = window.emw;
  const S = emw.store;
  const $ = (s, r = document) => r.querySelector(s);

  const ROWS = [
    ['daily', 'Today'],
    ['weekly', 'This week'],
    ['monthly', 'This month'],
    ['book', 'Book']
  ];
  const REACHED = { daily: 'Daily goal reached', weekly: 'Weekly goal reached', monthly: 'Monthly goal reached', book: 'Book goal reached' };
  const fmt = (n) => { try { return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString(); } catch { return String(n); } };

  const stats = $('#stats');
  const triggers = [$('#st-words'), $('#st-total')].filter(Boolean);
  const stTotal = $('#st-total');

  let pop = null;
  let trigger = null;
  const refs = {};            // kind -> { row, add, set, input, fig, pct, bar, fill, reached }
  const adding = new Set();   // rows opened with "Set a goal" that have no number yet
  let weekBtns = null;

  const weekStart = () => (emw.settings.get('goalWeekStart') === 'sun' ? 'sun' : 'mon');
  const canOpen = () => !!(emw.book && emw.book.id) && !!stats && !stats.hidden && emw.view() !== 'home';
  const progress = () => { try { return S.goalProgress(weekStart()); } catch { return null; } };

  // ---- toasts -----------------------------------------------------------------------
  // A celebration must not replace an Undo toast that is still showing, so wait for it to go.
  function whenToastFree(fn, tries = 8) {
    const t = document.getElementById('toast');
    if (!t || t.hidden || tries <= 0) { fn(); return; }
    setTimeout(() => whenToastFree(fn, tries - 1), 1500);
  }
  const announce = (kind, target) => {
    const msg = kind === 'book' || kind === 'daily' ? `${REACHED[kind]}: ${fmt(target)} words` : REACHED[kind];
    whenToastFree(() => emw.toast(msg, { ms: 4000 }));
  };

  // Marks goals that are met. `silent` marks without a toast (opening a book, changing a target):
  // only a goal crossing its target while the writer writes is worth announcing, once per period.
  function checkFired(silent) {
    if (!canOpen() && !silent) return;
    const p = progress();
    if (!p) return;
    const keys = S.periodKeys(weekStart());
    for (const kind of S.GOAL_KINDS) {
      const g = p[kind];
      if (!g.target || !g.done) continue;
      if (S.goalFired(kind) === keys[kind]) continue;
      S.markGoalFired(kind, keys[kind]);
      if (!silent) announce(kind, g.target);
    }
  }

  // ---- the counter ------------------------------------------------------------------
  // A thin line under the manuscript total shows the daily goal; the same figure goes in its label.
  function paintCounter() {
    if (!stTotal) return;
    const p = progress();
    const d = p && p.daily;
    if (d && d.target) {
      const pct = Math.min(100, d.pct);
      stTotal.dataset.goal = '1';
      stTotal.style.setProperty('--goal-pct', pct + '%');
      const label = `${fmt(S.totalWords())} words in manuscript. Daily goal ${d.pct}%.`;
      stTotal.setAttribute('aria-label', label);
      stTotal.title = `Writing goals. Daily goal ${d.pct}%`;
    } else {
      delete stTotal.dataset.goal;
      stTotal.style.removeProperty('--goal-pct');
      stTotal.removeAttribute('aria-label');
      stTotal.title = 'Writing goals';
    }
  }

  // ---- the popover ------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function build() {
    pop = el('div', 'goals-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Writing goals');
    pop.append(el('h2', 'goals-title', 'Goals'));

    for (const [kind, label] of ROWS) {
      const row = el('div', 'goal-row');
      row.dataset.kind = kind;

      const add = el('button', 'goal-add', `${label}: set a goal`);
      add.type = 'button';
      add.addEventListener('click', () => {
        adding.add(kind);
        paint();
        refs[kind].input.focus();
      });

      const set = el('div', 'goal-set');
      const head = el('div', 'goal-head');
      const name = el('span', 'goal-name', label);
      const field = el('span', 'goal-field');
      const input = el('input', 'goal-input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'No goal';
      input.setAttribute('aria-label', `${label} word goal`);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { input.value = shown(kind); }   // reverted, so the close below commits nothing
      });
      input.addEventListener('blur', () => commit(kind));
      field.append(input, el('span', 'goal-unit', 'words'));
      head.append(name, field);

      const line = el('div', 'goal-line');
      const fig = el('span', 'goal-fig');
      const pct = el('span', 'goal-pct');
      line.append(fig, pct);

      const bar = el('div', 'goal-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${label} goal`);
      bar.setAttribute('aria-valuemin', '0');
      const fill = el('div', 'goal-fill');
      bar.append(fill);

      set.append(head, line, bar);
      row.append(add, set);
      pop.append(row);
      refs[kind] = { row, add, set, input, fig, pct, bar, fill, label };
    }

    pop.append(el('p', 'goals-help', 'Counts net new words since you started today.'));

    const wk = el('div', 'goals-week');
    const wl = el('span', 'goals-week-label', 'Week starts on');
    const seg = el('div', 'goals-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Week starts on');
    weekBtns = {};
    for (const [v, text] of [['mon', 'Monday'], ['sun', 'Sunday']]) {
      const b = el('button', 'goals-seg-btn', text);
      b.type = 'button';
      b.addEventListener('click', () => { if (weekStart() !== v) emw.settings.set('goalWeekStart', v); });
      weekBtns[v] = b;
      seg.append(b);
    }
    wk.append(wl, seg);
    pop.append(wk);

    pop.addEventListener('keydown', onKey);
    document.body.append(pop);
  }

  // What the field shows for a target: its number with separators, or empty.
  const shown = (kind) => {
    const t = (S.data && S.data.goals && S.data.goals[kind]) || 0;
    return t ? fmt(t) : '';
  };

  // Reads a field. Anything that is not a plain number reverts silently; decimals round down.
  function commit(kind) {
    const r = refs[kind];
    if (!r || !pop) return;
    const before = (S.data && S.data.goals && S.data.goals[kind]) || 0;
    const raw = r.input.value.replace(/[,\s]/g, '');
    let next = before;
    if (raw === '') next = 0;
    else if (/^\d+(\.\d+)?$/.test(raw)) {
      const n = Math.floor(Number(raw));
      if (Number.isFinite(n) && n <= S.GOAL_MAX) next = n;
    }
    if (next !== before) {
      S.setGoal(kind, next);
      afterTargetChange(kind, before, next);
    }
    if (!next) adding.delete(kind);
    r.input.value = shown(kind);
    paint();
  }

  // Raising a met target re-arms its toast; lowering one so it is already met stays quiet.
  function afterTargetChange(kind, before, next) {
    try {
      const p = progress();
      if (!p) return;
      const keys = S.periodKeys(weekStart());
      if (p[kind].done) S.markGoalFired(kind, keys[kind]);
      else if (next > before) S.markGoalFired(kind, '');
    } catch { /* bookkeeping only */ }
  }

  function paint() {
    paintCounter();
    if (!pop) return;
    const p = progress();
    if (!p) return;
    for (const [kind, label] of ROWS) {
      const r = refs[kind], g = p[kind];
      const open = g.target > 0 || adding.has(kind);
      r.add.hidden = open;
      r.set.hidden = !open;
      if (document.activeElement !== r.input) r.input.value = shown(kind);   // never rewrite a field being typed in
      const fillPct = g.target ? Math.min(100, (g.written / g.target) * 100) : 0;
      r.fill.style.width = fillPct + '%';
      r.row.classList.toggle('is-done', g.done);
      r.fig.textContent = g.target ? `${fmt(g.written)} / ${fmt(g.target)} words` : `${fmt(g.written)} words`;
      r.pct.textContent = g.target ? (g.done ? `${g.pct}%, goal reached` : `${g.pct}%`) : '';
      r.bar.hidden = !g.target;
      r.bar.setAttribute('aria-valuemax', String(g.target || 0));
      r.bar.setAttribute('aria-valuenow', String(Math.min(g.written, g.target || 0)));
      r.bar.setAttribute('aria-valuetext', g.target ? `${fmt(g.written)} of ${fmt(g.target)} words, ${g.pct}%` : '');
    }
    if (weekBtns) for (const v of Object.keys(weekBtns)) weekBtns[v].setAttribute('aria-pressed', String(weekStart() === v));
  }

  function place() {
    if (!pop) return;
    const w = Math.min(pop.offsetWidth || 320, window.innerWidth - 24);
    let rect = (trigger && trigger.getBoundingClientRect()) || null;
    if (rect && !rect.width && stats) rect = stats.getBoundingClientRect();
    const useRect = rect && rect.width > 0;
    const leftSide = stats && stats.parentElement && stats.parentElement.dataset.stats === 'left';
    let left = useRect ? (leftSide ? rect.left : rect.right - w) : window.innerWidth - w - 12;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    const bottom = useRect ? window.innerHeight - rect.top + 8 : 56;
    pop.style.left = left + 'px';
    pop.style.bottom = Math.max(8, bottom) + 'px';
    pop.style.maxHeight = Math.max(160, (useRect ? rect.top : window.innerHeight) - 24) + 'px';
  }

  // Tab stays inside the popover.
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key !== 'Tab') return;
    const items = [...pop.querySelectorAll('button, input')].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const onDown = (e) => {
    if (!pop) return;
    if (pop.contains(e.target) || triggers.some((t) => t.contains(e.target))) return;
    close(false);
  };

  function open(from) {
    if (pop || !canOpen()) return;
    // Darlings hides the counters outside the manuscript and timeline; anchor to the stats area then.
    trigger = from || triggers.find((t) => !t.hidden) || stats;
    adding.clear();
    build();
    paint();
    place();
    triggers.forEach((t) => t.setAttribute('aria-expanded', 'true'));
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', place);
    // Focus the first thing that can be edited: the first set goal, else the first row's button.
    const first = ROWS.map(([k]) => refs[k]).find((r) => !r.set.hidden) || refs.daily;
    (first.set.hidden ? first.add : first.input).focus();
  }

  function close(returnFocus) {
    if (!pop) return;
    const t = trigger;
    // A field that is still being edited keeps what the writer typed (unless Escape reverted it).
    for (const [k] of ROWS) if (document.activeElement === refs[k].input) commit(k);
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('resize', place);
    pop.remove();
    pop = null;
    for (const k of Object.keys(refs)) delete refs[k];
    weekBtns = null;
    adding.clear();
    triggers.forEach((x) => x.setAttribute('aria-expanded', 'false'));
    if (returnFocus && t && t.offsetParent !== null && t.focus) t.focus();
    trigger = null;
  }

  const toggle = (from) => { if (pop) close(true); else open(from); };

  // ---- wiring -----------------------------------------------------------------------
  for (const t of triggers) t.addEventListener('click', () => toggle(t));

  // View → Goals… is only usable where the counter is.
  function syncMenu() {
    const ok = canOpen();
    for (const b of document.querySelectorAll('.menu-item[data-action="goals"]')) b.disabled = !ok;
  }

  function refresh() {
    S.recordGoalProgress();   // rolls the day over; the caller that changed the data is already saving
    checkFired(false);
    paint();
  }

  S.on(() => { if (emw.book && emw.book.id) refresh(); });
  S.onGoalChange(() => { if (emw.book && emw.book.id) refresh(); });
  emw.settings.onChange(() => { paint(); });   // week start or anything else; paint is cheap

  emw.book.onSwitch(() => {
    close(false);
    if (emw.book.id) { S.recordGoalProgress(); checkFired(true); }
    paintCounter();
    syncMenu();
  });
  emw.onView(() => { close(false); syncMenu(); paintCounter(); });

  // The app can stay open across midnight (or a week or month end). A coarse check keeps the day
  // honest without a restart; it only touches the log when the day actually changes.
  setInterval(() => {
    if (!(emw.book && emw.book.id)) return;
    try { if (S.recordGoalProgress({ notify: true })) { checkFired(false); paint(); } } catch { /* ignore */ }
  }, 60000);

  emw.goals = { open: () => open(), close: () => close(true), toggle: () => toggle() };
  emw.actions.goals = () => { if (canOpen()) toggle(); };
  if (emw.keys) {
    emw.keys.register({
      id: 'goals', label: 'Goals', group: 'View', keys: 'Ctrl+Alt+G',
      when: () => canOpen() && !document.querySelector('dialog[open]')
    });
  }
  syncMenu();
  paintCounter();
})();
