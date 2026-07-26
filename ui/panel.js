/**
 * 面板 —— 翻译助手主界面（v0.6 紧凑重构）
 *
 * 布局（参考成熟软件：紧凑标签 + 折叠 + 顶部常驻工具栏）：
 *   - 顶部常驻纯图标工具栏：🎯点选 / ✏️编辑 / 皮肤下拉 / 收起 / 关闭。随时可用、不占大空间。
 *   - 选完元素：显示"这是【区域】"，下面是多选 chip「改什么」(颜色/大小/位置/文字/字体/图标)，
 *     每勾一项就展开它的「怎么改」小 chip（单选，全程点选不打字）。
 *   - 一次生成含所有诉求的提问，默认折叠，点开看/复制。
 *   - 打开 CSS 编辑框时，收起上面的区域模块（用户已在改代码）。
 *
 * 两态：收起=可拖拽小圆球；展开=面板。进入选择模式面板收成圆球让位+脉冲反馈。
 *
 * ★ 防抽屉收起：圆球和面板吞掉自己的 click+mousedown，ST 收不到"外部点击"，抽屉保持展开。
 *
 * ★ 法律红线：只读当前页面 CSS 用于分析、只写用户自己的 #customCSS；不建库、不上传。
 */

import { enterPickMode, exitPickMode, isPicking, getContainerChain, showToast } from '../src/picker.js';
import { identify } from '../src/semantic.js';
import { analyze } from '../src/analyzer.js';
import { WHAT_OPTIONS, getHowOptions, buildPrompt, buildMultiPrompt } from '../src/prompt-builder.js';
import { readNativeCSS, writeNativeCSS, nativeExists, searchInTextarea } from '../src/editor.js';

const PANEL_ID = 'cssw-panel';
const ORB_ID = 'cssw-orb';
const SKIN_FROSTED = 'cssw-skin-frosted';
const SKIN_CLAUDE = 'cssw-skin-claude';
const SKIN_STORAGE_KEY = 'css-whisperer:skin';
const ORB_POS_KEY = 'css-whisperer:orb-pos';
const NOTICE_KEY = 'css-whisperer:first-run-notice';
const DRAG_THRESHOLD = 5;

let panelEl = null;
let orbEl = null;
let currentSkin = 'frosted';
let orbGesture = null;
let editorOpen = false;

// 选择状态
let containerChain = [];
let chainIndex = 0;
let currentTarget = null;
// 多选诉求：{ [whatKey]: { whatLabel, howKey, howLabel } }
let intents = {};
let extraText = '';
// 购物车：多个区域的诉求，每项 { areaName, intents:[], analysis, locator }
let cart = [];

/* ============ 皮肤 ============ */
function getSkinClass() { return currentSkin === 'claude' ? SKIN_CLAUDE : SKIN_FROSTED; }
function loadSkin() {
  try { const s = localStorage.getItem(SKIN_STORAGE_KEY); if (s === 'frosted' || s === 'claude') return s; } catch (_) {}
  return 'frosted';
}
function persistSkin(skin) { try { localStorage.setItem(SKIN_STORAGE_KEY, skin); } catch (_) {} }
function applySkin() {
  const cls = getSkinClass();
  [panelEl, orbEl].forEach((el) => { if (!el) return; el.classList.remove(SKIN_FROSTED, SKIN_CLAUDE); el.classList.add(cls); });
}

function initPanel() { currentSkin = loadSkin(); }

/* ============ 圆球（收起态，可拖拽） ============ */
function ensureOrb() {
  if (orbEl && document.body.contains(orbEl)) return orbEl;
  orbEl = document.createElement('button');
  orbEl.id = ORB_ID;
  orbEl.type = 'button';
  orbEl.className = 'cssw-orb ' + getSkinClass();
  orbEl.setAttribute('aria-label', '打开点问');
  orbEl.innerHTML = '<span class="cssw-orb-icon">💬</span>';
  document.body.appendChild(orbEl);
  const pos = loadOrbPos();
  positionOrb(pos.fx, pos.fy);
  orbEl.addEventListener('pointerdown', onOrbPointerDown);
  orbEl.addEventListener('pointermove', onOrbPointerMove);
  orbEl.addEventListener('pointerup', onOrbPointerUp);
  orbEl.addEventListener('pointercancel', () => { orbGesture = null; });
  orbEl.addEventListener('click', (e) => e.stopPropagation());
  orbEl.addEventListener('mousedown', (e) => e.stopPropagation());
  return orbEl;
}
function onOrbPointerDown(e) {
  if (!e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  orbGesture = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startRect: e.currentTarget.getBoundingClientRect(), dragging: false };
}
function onOrbPointerMove(e) {
  if (!orbGesture || e.pointerId !== orbGesture.pointerId) return;
  const dist = Math.hypot(e.clientX - orbGesture.startX, e.clientY - orbGesture.startY);
  if (dist > DRAG_THRESHOLD) orbGesture.dragging = true;
  if (orbGesture.dragging) {
    const nx = orbGesture.startRect.x + e.clientX - orbGesture.startX;
    const ny = orbGesture.startRect.y + e.clientY - orbGesture.startY;
    positionOrb(nx / window.innerWidth, ny / window.innerHeight);
  }
}
function onOrbPointerUp(e) {
  if (!orbGesture || e.pointerId !== orbGesture.pointerId) return;
  const wasDrag = orbGesture.dragging;
  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  orbGesture = null;
  if (wasDrag) {
    const rect = e.currentTarget.getBoundingClientRect();
    saveOrbPos({ fx: rect.x / window.innerWidth, fy: rect.y / window.innerHeight });
  } else {
    expandPanel();
  }
}
function positionOrb(fx, fy) {
  if (!orbEl) return;
  fx = Math.max(0, Math.min(0.92, fx));
  fy = Math.max(0.04, Math.min(0.92, fy));
  orbEl.style.left = (fx * window.innerWidth) + 'px';
  orbEl.style.top = (fy * window.innerHeight) + 'px';
}
function loadOrbPos() {
  try { const raw = localStorage.getItem(ORB_POS_KEY); if (raw) { const d = JSON.parse(raw); if (typeof d.fx === 'number' && typeof d.fy === 'number') return d; } } catch (_) {}
  return { fx: 0.86, fy: 0.72 };
}
function saveOrbPos(pos) { try { localStorage.setItem(ORB_POS_KEY, JSON.stringify(pos)); } catch (_) {} }
function showOrb() { ensureOrb().style.display = 'flex'; }
function hideOrb() { if (orbEl) orbEl.style.display = 'none'; }

/* ============ 面板骨架 ============ */
function ensurePanel() {
  if (panelEl && document.body.contains(panelEl)) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = PANEL_ID;
  panelEl.className = 'cssw-panel ' + getSkinClass();
  panelEl.setAttribute('data-open', 'false');
  panelEl.innerHTML = renderShell();
  document.body.appendChild(panelEl);
  bindShellEvents();
  return panelEl;
}

// 顶部纯图标工具栏 + 内容区
function renderShell() {
  return `
    <div class="cssw-toolbar">
      <button type="button" class="cssw-tb cssw-tb-pick" title="点选界面上要改的地方">🎯</button>
      <button type="button" class="cssw-tb cssw-tb-editor" title="打开自定义CSS编辑框（搜索/粘贴/保存）">✏️</button>
      <button type="button" class="cssw-tb cssw-tb-cart" title="修改清单">🧺<span class="cssw-cart-badge" hidden>0</span></button>
      <span class="cssw-tb-title">点问</span>
      <select class="cssw-skin-select cssw-tb-skin" title="面板皮肤">
        <option value="frosted">磨砂</option>
        <option value="claude">Claude</option>
      </select>
      <button type="button" class="cssw-tb cssw-min" title="收起成小球">－</button>
      <button type="button" class="cssw-tb cssw-close" title="关闭">✕</button>
    </div>
    <div class="cssw-body">
      <div class="cssw-step cssw-step-editor" hidden></div>
      <div class="cssw-step cssw-step-cart" hidden></div>
      <div class="cssw-step cssw-step-area" hidden></div>
      <div class="cssw-step cssw-step-what" hidden></div>
      <div class="cssw-step cssw-step-result" hidden></div>
      <div class="cssw-empty">点顶部 🎯 开始：先点界面上想改的地方。</div>
    </div>
  `;
}

function bindShellEvents() {
  panelEl.querySelector('.cssw-close').addEventListener('click', closePanel);
  panelEl.querySelector('.cssw-min').addEventListener('click', collapseToOrb);
  panelEl.querySelector('.cssw-tb-pick').addEventListener('click', onPickClick);
  panelEl.querySelector('.cssw-tb-editor').addEventListener('click', toggleEditor);
  panelEl.querySelector('.cssw-tb-cart').addEventListener('click', toggleCart);
  const skinSel = panelEl.querySelector('.cssw-skin-select');
  skinSel.value = currentSkin;
  skinSel.addEventListener('change', (e) => {
    currentSkin = e.target.value === 'claude' ? 'claude' : 'frosted';
    persistSkin(currentSkin);
    applySkin();
  });
  // 防抽屉收起
  panelEl.addEventListener('click', (e) => e.stopPropagation());
  panelEl.addEventListener('mousedown', (e) => e.stopPropagation());
}

/* ============ 两态切换 ============ */
function openPanel() { expandPanel(); maybeShowFirstRunNotice(); }
function maybeShowFirstRunNotice() {
  try { if (localStorage.getItem(NOTICE_KEY)) return; localStorage.setItem(NOTICE_KEY, '1'); } catch (_) {}
  showToast('点问：把你想改的地方翻译成给 AI 的提问。请尊重主题作者授权，仅在允许范围内修改。');
}
function expandPanel() {
  ensurePanel();
  applySkin();
  panelEl.querySelector('.cssw-skin-select').value = currentSkin;
  panelEl.setAttribute('data-open', 'true');
  hideOrb();
}
function collapseToOrb() { if (panelEl) panelEl.setAttribute('data-open', 'false'); hidePersistentHighlight(); showOrb(); }
function closePanel() {
  if (isPicking()) exitPickMode();
  if (panelEl) panelEl.setAttribute('data-open', 'false');
  hidePersistentHighlight();
  hideOrb();
}

/* ============ 点选 ============ */
function onPickClick() {
  if (isPicking()) { exitPickMode(); onPickModeExit(); return; }
  enterPickMode((el) => { onPickModeExit(); onElementPicked(el); });
  onPickModeEnter();
}
function onPickModeEnter() {
  if (panelEl) panelEl.setAttribute('data-open', 'false');
  hidePersistentHighlight();
  showOrb();
  if (orbEl) orbEl.classList.add('cssw-orb-picking');
}
function onPickModeExit() { if (orbEl) orbEl.classList.remove('cssw-orb-picking'); }

function onElementPicked(el) {
  currentTarget = el;
  containerChain = getContainerChain(el);
  chainIndex = 0;
  intents = {};
  extraText = '';
  editorOpen = false;
  hideStep('.cssw-step-editor');
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  expandPanel();
  renderArea();
  renderWhat();
  hideStep('.cssw-step-result');
}

/* ============ CSS 编辑框 ============ */
function toggleEditor() {
  const step = panelEl.querySelector('.cssw-step-editor');
  if (editorOpen) { step.hidden = true; step.innerHTML = ''; editorOpen = false; return; }
  if (!nativeExists()) { showToast('找不到 SillyTavern 的自定义CSS框，请先打开一次「用户设置」'); return; }
  // 打开编辑器 → 收起区域/问答/结果模块，让用户专注改代码
  hideStep('.cssw-step-area'); hideStep('.cssw-step-what'); hideStep('.cssw-step-result');
  hidePersistentHighlight();
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  renderEditor();
  editorOpen = true;
}

function renderEditor() {
  const step = panelEl.querySelector('.cssw-step-editor');
  step.innerHTML = `
    <div class="cssw-editor-searchrow">
      <input type="text" class="cssw-editor-search" placeholder="搜索定位" />
      <button type="button" class="cssw-editor-prev" title="上一个">▲</button>
      <button type="button" class="cssw-editor-next" title="下一个">▼</button>
      <span class="cssw-editor-count">0/0</span>
    </div>
    <div class="cssw-editor-actions">
      <button type="button" class="cssw-editor-undo" disabled>↶ 撤回</button>
      <button type="button" class="cssw-editor-reset">⟲ 重置（恢复打开时）</button>
    </div>
    <div class="cssw-editor-wrap">
      <div class="cssw-editor-highlight" aria-hidden="true"></div>
      <textarea class="cssw-editor-textarea" spellcheck="false"></textarea>
    </div>
  `;
  step.hidden = false;

  const ta = step.querySelector('.cssw-editor-textarea');
  const hl = step.querySelector('.cssw-editor-highlight');
  const searchBox = step.querySelector('.cssw-editor-search');
  const prevBtn = step.querySelector('.cssw-editor-prev');
  const nextBtn = step.querySelector('.cssw-editor-next');
  const countEl = step.querySelector('.cssw-editor-count');
  const undoBtn = step.querySelector('.cssw-editor-undo');
  const resetBtn = step.querySelector('.cssw-editor-reset');

  ta.value = readNativeCSS();

  // 撤回/重置：打开时记原始快照；每次写回前把旧值压入 undo 栈
  const openBackup = ta.value;
  const undoStack = [];
  const pushUndo = (v) => { undoStack.push(v); if (undoStack.length > 50) undoStack.shift(); undoBtn.disabled = undoStack.length === 0; };

  let saveTimer = null;
  let lastSaved = ta.value;
  ta.addEventListener('input', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      pushUndo(lastSaved);       // 存"改动前"的值，撤回时回到它
      lastSaved = ta.value;
      writeNativeCSS(ta.value);
      renderHighlight();
    }, 400);
    renderHighlight();
  });

  undoBtn.addEventListener('click', () => {
    if (!undoStack.length) return;
    const prev = undoStack.pop();
    ta.value = prev;
    lastSaved = prev;
    writeNativeCSS(prev);
    undoBtn.disabled = undoStack.length === 0;
    recompute();
    showToast('已撤回一步');
  });
  resetBtn.addEventListener('click', () => {
    pushUndo(lastSaved);
    ta.value = openBackup;
    lastSaved = openBackup;
    writeNativeCSS(openBackup);
    recompute();
    showToast('已恢复到打开编辑器时的样子');
  });

  // ===== 搜索：计数 + 上/下一个 + 全部高亮 =====
  let matches = [];
  let cur = -1;
  const recompute = () => {
    const kw = searchBox.value;
    matches = [];
    if (kw) {
      let i = ta.value.indexOf(kw, 0);
      while (i !== -1) { matches.push(i); i = ta.value.indexOf(kw, i + kw.length); }
    }
    cur = matches.length ? 0 : -1;
    updateCount();
    renderHighlight();
    if (cur >= 0) jump();
  };
  const updateCount = () => { countEl.textContent = matches.length ? `${cur + 1}/${matches.length}` : '0/0'; };
  const jump = () => {
    const kw = searchBox.value;
    const idx = matches[cur];
    ta.focus();
    ta.setSelectionRange(idx, idx + kw.length);
    const before = ta.value.slice(0, idx);
    const line = before.split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
    syncHighlightScroll();
  };
  const step2 = (d) => {
    if (!matches.length) return;
    cur = (cur + d + matches.length) % matches.length;
    updateCount(); jump();
  };

  // 高亮层：把匹配词包 <mark>，铺在 textarea 背后（textarea 背景透明）
  const renderHighlight = () => {
    const kw = searchBox.value;
    const text = ta.value;
    if (!kw) { hl.innerHTML = escapeHtml(text); syncHighlightScroll(); return; }
    let out = '';
    let i = 0;
    while (true) {
      const j = text.indexOf(kw, i);
      if (j === -1) { out += escapeHtml(text.slice(i)); break; }
      out += escapeHtml(text.slice(i, j));
      out += '<mark class="cssw-hl">' + escapeHtml(kw) + '</mark>';
      i = j + kw.length;
    }
    hl.innerHTML = out;
    syncHighlightScroll();
  };
  const syncHighlightScroll = () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; };
  ta.addEventListener('scroll', syncHighlightScroll);

  searchBox.addEventListener('input', recompute);
  searchBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step2(1); } });
  nextBtn.addEventListener('click', () => step2(1));
  prevBtn.addEventListener('click', () => step2(-1));

  renderHighlight();
}

/* ============ 区域（层级链，直接显示区域名，不要"选大选小") ============ */
function renderArea() {
  const el = containerChain[chainIndex] || currentTarget;
  const info = identify(el);
  const step = panelEl.querySelector('.cssw-step-area');

  let chainButtons = '';
  if (containerChain.length > 1) {
    chainButtons = containerChain.map((node, i) => {
      const ci = identify(node);
      const noteHtml = ci.note ? `<span class="cssw-chain-note">${escapeHtml(ci.note)}</span>` : '';
      const active = i === chainIndex ? ' active' : '';
      return `<button type="button" class="cssw-chain-item${active}" data-idx="${i}"><span class="cssw-chain-nm">${escapeHtml(ci.name)}</span>${noteHtml}</button>`;
    }).join('');
    chainButtons = `<div class="cssw-chain"><div class="cssw-chain-tip">这里有好几层，选你要改的那层：</div><div class="cssw-chain-list">${chainButtons}</div></div>`;
  }

  const note = info.note ? `<span class="cssw-area-note">${escapeHtml(info.note)}</span>` : '';
  step.innerHTML = `
    <div class="cssw-area-name">正在改：<b>${escapeHtml(info.name)}</b>${note}</div>
    ${chainButtons}
  `;
  step.hidden = false;

  // 持续高亮当前选中的元素（不只是点选瞬间），让用户始终看清在改哪
  showPersistentHighlight(el);

  step.querySelectorAll('.cssw-chain-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      chainIndex = parseInt(btn.getAttribute('data-idx'), 10) || 0;
      renderArea();
      renderWhat();
    });
  });
}

/* ============ 当前选中元素持续高亮 ============ */
let persistHlEl = null;
let persistTarget = null;
let persistRaf = null;

function showPersistentHighlight(el) {
  persistTarget = el;
  if (!persistHlEl) {
    persistHlEl = document.createElement('div');
    persistHlEl.className = 'cssw-persist-highlight';
    document.body.appendChild(persistHlEl);
  }
  const update = () => {
    if (!persistTarget || !document.body.contains(persistTarget)) { hidePersistentHighlight(); return; }
    const r = persistTarget.getBoundingClientRect();
    persistHlEl.style.display = 'block';
    persistHlEl.style.top = (r.top + window.scrollY) + 'px';
    persistHlEl.style.left = (r.left + window.scrollX) + 'px';
    persistHlEl.style.width = r.width + 'px';
    persistHlEl.style.height = r.height + 'px';
    persistRaf = requestAnimationFrame(update);
  };
  cancelAnimationFrame(persistRaf);
  update();
}
function hidePersistentHighlight() {
  persistTarget = null;
  cancelAnimationFrame(persistRaf);
  if (persistHlEl) persistHlEl.style.display = 'none';
}

/* ============ 改什么（多选 chip） + 每项的怎么改 ============ */
function renderWhat() {
  const step = panelEl.querySelector('.cssw-step-what');
  const chips = WHAT_OPTIONS.map((o) => {
    const on = intents[o.key] ? ' active' : '';
    return `<button type="button" class="cssw-chip cssw-what-chip${on}" data-key="${o.key}" data-label="${escapeHtml(o.label)}">${escapeHtml(o.label)}</button>`;
  }).join('');
  step.innerHTML = `
    <div class="cssw-q">想改什么？（可多选）</div>
    <div class="cssw-chips">${chips}</div>
    <div class="cssw-how-groups"></div>
    <div class="cssw-what-actions">
      <button type="button" class="cssw-add-btn" ${Object.keys(intents).length ? '' : 'disabled'}>➕ 加入清单，再改下一处</button>
      <button type="button" class="cssw-gen-btn">生成提问${cart.length ? `（清单 ${cart.length} 处 + 当前）` : ''}</button>
    </div>
  `;
  step.hidden = false;

  step.querySelectorAll('.cssw-what-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const label = btn.getAttribute('data-label');
      if (intents[key]) { delete intents[key]; } else { intents[key] = { whatLabel: label, howKey: null, howLabel: null }; }
      renderWhat();
    });
  });

  renderHowGroups(step.querySelector('.cssw-how-groups'));

  const addBtn = step.querySelector('.cssw-add-btn');
  addBtn.disabled = !Object.keys(intents).length;
  addBtn.addEventListener('click', addCurrentToCart);
  step.querySelector('.cssw-gen-btn').addEventListener('click', onGenerate);
}

// 为每个已勾选的"改什么"渲染它的"怎么改"小 chip（单选）
function renderHowGroups(container) {
  container.innerHTML = Object.keys(intents).map((key) => {
    const it = intents[key];
    const opts = getHowOptions(key);
    const chips = opts.map((o) => {
      const on = it.howKey === o.key ? ' active' : '';
      return `<button type="button" class="cssw-chip cssw-how-chip${on}" data-what="${key}" data-key="${o.key}" data-label="${escapeHtml(o.label)}">${escapeHtml(o.label)}</button>`;
    }).join('');
    return `<div class="cssw-how-row"><span class="cssw-how-label">${escapeHtml(it.whatLabel)}：</span><div class="cssw-chips cssw-chips-sm">${chips}</div></div>`;
  }).join('');

  container.querySelectorAll('.cssw-how-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const what = btn.getAttribute('data-what');
      intents[what].howKey = btn.getAttribute('data-key');
      intents[what].howLabel = btn.getAttribute('data-label');
      // 只重渲染 how 区，避免整块闪
      renderHowGroups(container);
    });
  });
}

/* ============ 购物车（多区域） ============ */

// 把当前选中元素 + 已选诉求打包成一个 cart item（含即时分析）
function snapshotCurrent() {
  const el = containerChain[chainIndex] || currentTarget;
  if (!el) return null;
  const info = identify(el);
  const whatKeys = Object.keys(intents);
  if (!whatKeys.length) return null;
  let analysis;
  try { analysis = analyze(el, whatKeys.length === 1 ? whatKeys[0] : whatKeys); }
  catch (e) { analysis = { relevantRules: [], pseudo: [], variables: [], computed: {}, authoredHere: false, partialUnreadable: true }; }
  return {
    areaName: info.name,
    intents: whatKeys.map((k) => ({ whatKey: k, whatLabel: intents[k].whatLabel, howKey: intents[k].howKey, howLabel: intents[k].howLabel || '（你决定合适的）' })),
    analysis,
    locator: buildLocator(el, info.standardSelector),
  };
}

function addCurrentToCart() {
  const item = snapshotCurrent();
  if (!item) { showToast('先选"改什么"再加入清单'); return; }
  cart.push(item);
  updateCartBadge();
  showToast(`已加入清单（共 ${cart.length} 处）。可继续点 🎯 选下一处`);
  // 重置当前诉求，方便接着点下一个元素
  intents = {};
  hideStep('.cssw-step-area');
  hideStep('.cssw-step-what');
  const empty = panelEl.querySelector('.cssw-empty');
  if (empty) { empty.hidden = false; empty.textContent = `清单里有 ${cart.length} 处。点 🎯 继续选，或点 🧺 查看/生成。`; }
}

function updateCartBadge() {
  const badge = panelEl && panelEl.querySelector('.cssw-cart-badge');
  if (!badge) return;
  badge.textContent = cart.length;
  badge.hidden = cart.length === 0;
}

function toggleCart() {
  const step = panelEl.querySelector('.cssw-step-cart');
  if (!step.hidden) { step.hidden = true; step.innerHTML = ''; return; }
  renderCart();
}

function renderCart() {
  const step = panelEl.querySelector('.cssw-step-cart');
  if (!cart.length) {
    step.innerHTML = `<div class="cssw-q">修改清单</div><div class="cssw-cart-empty">清单是空的。选好一处后点"加入清单"。</div>`;
    step.hidden = false;
    return;
  }
  const items = cart.map((it, i) => {
    const desc = it.intents.map((x) => `${x.whatLabel}→${x.howLabel}`).join('、');
    return `<div class="cssw-cart-item"><span class="cssw-cart-item-text"><b>${escapeHtml(it.areaName)}</b>：${escapeHtml(desc)}</span><button type="button" class="cssw-cart-del" data-i="${i}" title="删除">✕</button></div>`;
  }).join('');
  step.innerHTML = `
    <div class="cssw-q">修改清单（${cart.length} 处）</div>
    <div class="cssw-cart-list">${items}</div>
    <button type="button" class="cssw-cart-gen">生成提问（${cart.length} 处一起）</button>
  `;
  step.hidden = false;
  step.querySelectorAll('.cssw-cart-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      cart.splice(parseInt(btn.getAttribute('data-i'), 10), 1);
      updateCartBadge();
      renderCart();
    });
  });
  step.querySelector('.cssw-cart-gen').addEventListener('click', () => {
    const text = buildMultiPrompt(cart);
    renderResult(text);
  });
}

/* ============ 生成结果 ============ */
function onGenerate() {
  // 把当前正在编辑的区域（若有诉求）也算进去，和清单一起生成
  const items = cart.slice();
  const current = snapshotCurrent();
  if (current) items.push(current);
  if (!items.length) { showToast('先选"改什么"'); return; }
  const text = items.length === 1 ? buildPrompt(items[0]) : buildMultiPrompt(items);
  renderResult(text);
}

function renderResult(text) {
  const step = panelEl.querySelector('.cssw-step-result');
  step.innerHTML = `
    <div class="cssw-q">复制发给 AI（ChatGPT / Claude 等）</div>
    <textarea class="cssw-result-text" readonly></textarea>
    <button type="button" class="cssw-copy-btn">📋 一键复制</button>
  `;
  step.hidden = false;
  step.querySelector('.cssw-result-text').value = text;
  step.querySelector('.cssw-copy-btn').addEventListener('click', () => copyText(text));
  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============ 工具 ============ */
function buildLocator(el, standardSelector) {
  const classes = [];
  try { el.classList.forEach((c) => { if (!c.startsWith('cssw-')) classes.push(c); }); } catch (_) {}
  return { tag: el.tagName ? el.tagName.toLowerCase() : '', id: el.id || '', classes: classes.slice(0, 6), standardSelector: standardSelector || '' };
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制，去粘给 AI 吧'), () => fallbackCopy(text));
  } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('已复制，去粘给 AI 吧');
  } catch (_) { showToast('复制失败，请手动长按选中复制'); }
}
function hideStep(selector) { const s = panelEl && panelEl.querySelector(selector); if (s) { s.hidden = true; s.innerHTML = ''; } }
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { initPanel, openPanel, closePanel };
