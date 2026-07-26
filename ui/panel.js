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
import { readNativeCSS, writeNativeCSS, nativeExists } from '../src/editor.js';

const PANEL_ID = 'cssw-panel';
const ORB_ID = 'cssw-orb';
const SKIN_FROSTED = 'cssw-skin-frosted';
const SKIN_CLAUDE = 'cssw-skin-claude';
const SKIN_STORAGE_KEY = 'css-whisperer:skin';
const ORB_POS_KEY = 'css-whisperer:orb-pos';
const PANEL_RECT_KEY = 'css-whisperer:panel-rect';
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
  orbEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  orbEl.addEventListener('pointerdown', (e) => e.stopPropagation());
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
    <div class="cssw-footer" hidden>
      <button type="button" class="cssw-add-btn" disabled>➕ 加入清单，再改下一处</button>
      <button type="button" class="cssw-gen-btn">生成提问</button>
    </div>
  `;
}

function bindShellEvents() {
  panelEl.querySelector('.cssw-close').addEventListener('click', closePanel);
  panelEl.querySelector('.cssw-min').addEventListener('click', collapseToOrb);
  panelEl.querySelector('.cssw-tb-pick').addEventListener('click', onPickClick);
  panelEl.querySelector('.cssw-tb-editor').addEventListener('click', toggleEditor);
  panelEl.querySelector('.cssw-tb-cart').addEventListener('click', toggleCart);
  // 固定底部操作条（sticky footer）：加入清单 / 生成提问
  panelEl.querySelector('.cssw-footer .cssw-add-btn').addEventListener('click', addCurrentToCart);
  panelEl.querySelector('.cssw-footer .cssw-gen-btn').addEventListener('click', onGenerate);
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
  panelEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());

  // 面板拖动（拖工具栏空白处移动整个面板）+ resize 记忆
  bindPanelDrag();
  bindPanelResizePersist();
  restorePanelRect();
}

/* ============ 固定底部操作条（footer） ============
 * 只在"选好元素、正在选部位"这一步显示；编辑器/购物车/纯结果态隐藏，
 * 避免没选元素就先摆两个大按钮（视觉修 #3 的门控）。*/
function showFooter() {
  const f = panelEl && panelEl.querySelector('.cssw-footer');
  if (f) f.hidden = false;
  updateFooter();
}
function hideFooter() {
  const f = panelEl && panelEl.querySelector('.cssw-footer');
  if (f) f.hidden = true;
}
// 按当前状态刷新 footer 按钮（加入清单是否可用、生成按钮文案带清单计数）
function updateFooter() {
  if (!panelEl) return;
  const addBtn = panelEl.querySelector('.cssw-footer .cssw-add-btn');
  const genBtn = panelEl.querySelector('.cssw-footer .cssw-gen-btn');
  if (!addBtn || !genBtn) return;
  addBtn.disabled = !Object.keys(intents).length;
  genBtn.textContent = cart.length ? `生成提问（清单 ${cart.length} 处 + 当前）` : '生成提问';
}

/* ============ 面板拖动 + 尺寸/位置记忆 ============ */
let panelDrag = null;
function bindPanelDrag() {
  const bar = panelEl.querySelector('.cssw-toolbar');
  if (!bar) return;
  bar.addEventListener('pointerdown', (e) => {
    // 点在按钮/下拉上不拖，交给它们自己的 click
    if (e.target.closest('.cssw-tb, .cssw-skin-select')) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const rect = panelEl.getBoundingClientRect();
    panelDrag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startLeft: rect.left, startTop: rect.top };
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!panelDrag || e.pointerId !== panelDrag.pointerId) return;
    const nx = panelDrag.startLeft + (e.clientX - panelDrag.startX);
    const ny = panelDrag.startTop + (e.clientY - panelDrag.startY);
    setPanelPos(nx, ny);
  });
  const end = (e) => {
    if (!panelDrag || e.pointerId !== panelDrag.pointerId) return;
    try { bar.releasePointerCapture(e.pointerId); } catch (_) {}
    panelDrag = null;
    savePanelRect();
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// 切成显式定位并夹在视口内
function setPanelPos(left, top) {
  const w = panelEl.offsetWidth, h = panelEl.offsetHeight;
  const maxL = Math.max(0, window.innerWidth - w);
  const maxT = Math.max(0, window.innerHeight - Math.min(h, window.innerHeight * 0.9));
  left = Math.max(0, Math.min(maxL, left));
  top = Math.max(0, Math.min(maxT, top));
  panelEl.classList.add('cssw-moved');
  panelEl.style.left = left + 'px';
  panelEl.style.top = top + 'px';
}

function bindPanelResizePersist() {
  if (typeof ResizeObserver === 'undefined') return;
  let t = null;
  const ro = new ResizeObserver(() => {
    if (t) clearTimeout(t);
    t = setTimeout(savePanelRect, 300);
  });
  ro.observe(panelEl);
}

function savePanelRect() {
  try {
    const rect = panelEl.getBoundingClientRect();
    const moved = panelEl.classList.contains('cssw-moved');
    // 只记宽度和位置，不记高度——高度永远跟内容走，
    // 否则"上次用时被撑高的 height"会在下次刚打开(内容很少)时写回，造成下半空白(#2)。
    localStorage.setItem(PANEL_RECT_KEY, JSON.stringify({
      left: rect.left, top: rect.top,
      width: panelEl.offsetWidth,
      moved,
    }));
  } catch (_) {}
}

function restorePanelRect() {
  try {
    const raw = localStorage.getItem(PANEL_RECT_KEY);
    if (!raw) return;
    const r = JSON.parse(raw);
    if (r.width) panelEl.style.width = Math.min(r.width, window.innerWidth) + 'px';
    // 不恢复 height（见 savePanelRect 说明）
    if (r.moved && typeof r.left === 'number') setPanelPos(r.left, r.top);
  } catch (_) {}
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
  hideStep('.cssw-step-cart');
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  expandPanel();
  renderArea();
  renderWhat();
  hideStep('.cssw-step-result');
  showFooter();
}

/* ============ CSS 编辑框 ============ */
function toggleEditor() {
  const step = panelEl.querySelector('.cssw-step-editor');
  if (editorOpen) { step.hidden = true; step.innerHTML = ''; editorOpen = false; return; }
  if (!nativeExists()) { showToast('找不到 SillyTavern 的自定义CSS框，请先打开一次「用户设置」'); return; }
  // 打开编辑器 → 收起区域/问答/结果模块 + 底部操作条，让用户专注改代码
  hideStep('.cssw-step-area'); hideStep('.cssw-step-what'); hideStep('.cssw-step-result');
  hideStep('.cssw-step-cart');
  hideFooter();
  hidePersistentHighlight();
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  renderEditor();
  editorOpen = true;
}

async function renderEditor() {
  const step = panelEl.querySelector('.cssw-step-editor');
  step.innerHTML = `
    <div class="cssw-editor-searchrow">
      <input type="text" class="cssw-editor-search" placeholder="搜索定位（回车跳下一个，Shift+回车上一个）" />
      <button type="button" class="cssw-editor-prev" title="上一个">▲</button>
      <button type="button" class="cssw-editor-next" title="下一个">▼</button>
      <span class="cssw-editor-count">0/0</span>
    </div>
    <div class="cssw-editor-actions">
      <button type="button" class="cssw-editor-undo">↶ 撤回</button>
      <button type="button" class="cssw-editor-redo">↷ 重做</button>
      <button type="button" class="cssw-editor-reset">⟲ 重置</button>
    </div>
    <div class="cssw-editor-host">
      <textarea class="cssw-editor-textarea" spellcheck="false"></textarea>
    </div>
  `;
  step.hidden = false;

  const ta = step.querySelector('.cssw-editor-textarea');
  const searchBox = step.querySelector('.cssw-editor-search');
  const prevBtn = step.querySelector('.cssw-editor-prev');
  const nextBtn = step.querySelector('.cssw-editor-next');
  const countEl = step.querySelector('.cssw-editor-count');
  const undoBtn = step.querySelector('.cssw-editor-undo');
  const redoBtn = step.querySelector('.cssw-editor-redo');
  const resetBtn = step.querySelector('.cssw-editor-reset');

  // 镜像 ST 原生 #customCSS（同一份，不产生第二份 CSS）
  const openBackup = readNativeCSS();
  ta.value = openBackup;

  // 防抽屉/防冒泡：编辑区自己的事件不外泄
  ta.addEventListener('mousedown', (e) => e.stopPropagation());
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---- 撤回/重做：快照栈（编辑防抖后压栈）----
  const undoStack = [];
  const redoStack = [];
  let lastSnapshot = ta.value;
  let saveTimer = null;
  ta.addEventListener('input', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      undoStack.push(lastSnapshot);
      redoStack.length = 0;           // 新编辑清空重做栈
      lastSnapshot = ta.value;
      writeNativeCSS(ta.value);
      refreshCount();
    }, 400);
  });
  undoBtn.addEventListener('click', () => {
    if (!undoStack.length) return;
    redoStack.push(ta.value);
    const v = undoStack.pop();
    ta.value = v; lastSnapshot = v; writeNativeCSS(v); refreshCount();
  });
  redoBtn.addEventListener('click', () => {
    if (!redoStack.length) return;
    undoStack.push(ta.value);
    const v = redoStack.pop();
    ta.value = v; lastSnapshot = v; writeNativeCSS(v); refreshCount();
  });
  resetBtn.addEventListener('click', () => {
    undoStack.push(ta.value); redoStack.length = 0;
    ta.value = openBackup; lastSnapshot = openBackup; writeNativeCSS(openBackup);
    refreshCount(); showToast('已恢复到打开编辑器时');
  });

  // ---- 搜索：子串匹配，setSelectionRange 选中并滚动（无叠层→不抖，这是当初抖动的正解）----
  // 计数用全文扫描；上一个/下一个记录所有匹配起点，按当前光标定位。
  let matchStarts = [];
  let activeIdx = -1;
  const collect = () => {
    matchStarts = [];
    const kw = searchBox.value;
    if (!kw) { activeIdx = -1; return; }
    let i = ta.value.indexOf(kw, 0);
    while (i !== -1) { matchStarts.push(i); i = ta.value.indexOf(kw, i + kw.length); }
  };
  const refreshCount = () => {
    collect();
    countEl.textContent = searchBox.value ? `${activeIdx >= 0 ? activeIdx + 1 : 0}/${matchStarts.length}` : '0/0';
  };
  const goto = (dir) => {
    if (!matchStarts.length) { refreshCount(); return; }
    activeIdx = activeIdx < 0 ? 0 : (activeIdx + dir + matchStarts.length) % matchStarts.length;
    const idx = matchStarts[activeIdx];
    const kw = searchBox.value;
    ta.focus();
    ta.setSelectionRange(idx, idx + kw.length);
    // 滚动到选中行（textarea 无直接 API，用行高估算）
    const before = ta.value.slice(0, idx);
    const line = before.split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
    countEl.textContent = `${activeIdx + 1}/${matchStarts.length}`;
  };
  // 打字：只更新计数，不跳转（避免抢光标）
  searchBox.addEventListener('input', () => { activeIdx = -1; refreshCount(); });
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goto(e.shiftKey ? -1 : 1); }
  });
  nextBtn.addEventListener('click', () => goto(1));
  prevBtn.addEventListener('click', () => goto(-1));

  refreshCount();
}

/* ============ 区域（层级链，直接显示区域名，不要"选大选小") ============ */
function renderArea() {
  const el = containerChain[chainIndex] || currentTarget;
  const info = identify(el);
  const step = panelEl.querySelector('.cssw-step-area');

  let chainHtml = '';
  if (containerChain.length > 1) {
    const crumbs = containerChain.map((node, i) => {
      const ci = identify(node);
      const active = i === chainIndex ? ' active' : '';
      const title = ci.note ? ` title="${escapeHtml(ci.note)}"` : '';
      return `<button type="button" class="cssw-crumb${active}" data-idx="${i}"${title}>${escapeHtml(ci.name)}</button>`;
    }).join('<span class="cssw-crumb-sep">›</span>');
    chainHtml = `<div class="cssw-chain"><span class="cssw-chain-tip">层级：</span><div class="cssw-chain-crumbs">${crumbs}</div></div>`;
  }

  const noteHtml = info.note ? `<div class="cssw-area-note">${escapeHtml(info.note)}</div>` : '';
  step.innerHTML = `
    <div class="cssw-card cssw-area-card">
      <div class="cssw-area-label">正在改</div>
      <div class="cssw-area-name">${escapeHtml(info.name)}</div>
      ${noteHtml}
      ${chainHtml}
    </div>
  `;
  step.hidden = false;

  // 持续高亮当前选中的元素（不只是点选瞬间），让用户始终看清在改哪
  showPersistentHighlight(el);

  // 面包屑重建后横向滚动条会归零 → 把选中项拉回可视区（#1：点最右层不再跳回第一层）
  const activeCrumb = step.querySelector('.cssw-crumb.active');
  if (activeCrumb && activeCrumb.scrollIntoView) {
    try { activeCrumb.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {}
  }

  step.querySelectorAll('.cssw-crumb').forEach((btn) => {
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

/* ============ 改什么（部位卡片，手风琴：选中即就地展开"怎么改"） ============ */
function renderWhat() {
  const step = panelEl.querySelector('.cssw-step-what');
  // 每个部位：卡片 +（若选中）紧跟其后的"怎么改"面板，面板在网格里横跨整行，
  // 视觉上从属该卡、就地展开——选完立刻看到下一步，不用往下滚找。
  const parts = WHAT_OPTIONS.map((o) => {
    const selected = !!intents[o.key];
    const on = selected ? ' active' : '';
    const note = o.note ? `<span class="cssw-part-note">${escapeHtml(o.note)}</span>` : '';
    const caret = `<span class="cssw-part-caret">${selected ? '▲' : '▼'}</span>`;
    const card = `<button type="button" class="cssw-part-card${on}" data-key="${o.key}" data-label="${escapeHtml(o.label)}">`
      + `<span class="cssw-part-name">${escapeHtml(o.label)}</span>${caret}${note}</button>`;
    const panel = selected ? `<div class="cssw-how-panel" data-for="${o.key}"></div>` : '';
    return card + panel;
  }).join('');
  step.innerHTML = `
    <div class="cssw-card">
      <div class="cssw-q">想改这里的哪个部位？（可多选，点开看怎么改）</div>
      <div class="cssw-parts">${parts}</div>
    </div>
  `;
  step.hidden = false;

  step.querySelectorAll('.cssw-part-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const label = btn.getAttribute('data-label');
      if (intents[key]) { delete intents[key]; } else { intents[key] = { whatLabel: label, howKey: null, howLabel: null }; }
      renderWhat();
    });
  });

  step.querySelectorAll('.cssw-how-panel').forEach((panel) => {
    renderHowPanel(panel, panel.getAttribute('data-for'));
  });
  updateFooter();
}

// 渲染单个部位的"怎么改"面板（手风琴展开体）：小 chip 单选；选"自己描述"给输入框。
function renderHowPanel(container, key) {
  const it = intents[key];
  if (!it) { container.innerHTML = ''; return; }
  const opts = getHowOptions(key);
  const chips = opts.map((o) => {
    const on = it.howKey === o.key ? ' active' : '';
    return `<button type="button" class="cssw-chip cssw-how-chip${on}" data-key="${o.key}" data-label="${escapeHtml(o.label)}">${escapeHtml(o.label)}</button>`;
  }).join('');
  const customBox = it.howKey === 'custom'
    ? `<input type="text" class="cssw-how-custom" placeholder="用一句话说你想怎么改" value="${escapeHtml(it.customText || '')}" />`
    : '';
  container.innerHTML = `<div class="cssw-how-title">「${escapeHtml(it.whatLabel)}」想怎么改？</div>`
    + `<div class="cssw-chips cssw-chips-sm">${chips}</div>${customBox}`;

  container.querySelectorAll('.cssw-how-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      it.howKey = btn.getAttribute('data-key');
      it.howLabel = btn.getAttribute('data-label');
      renderHowPanel(container, key);
      // 选了"自己描述"→ 自动聚焦输入框
      if (it.howKey === 'custom') {
        const inp = container.querySelector('.cssw-how-custom');
        if (inp) inp.focus();
      }
    });
  });

  const inp = container.querySelector('.cssw-how-custom');
  if (inp) {
    inp.addEventListener('input', () => {
      it.customText = inp.value;
      it.howLabel = inp.value.trim() || '自己描述';
    });
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
  }
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
    areaAiName: info.aiName || info.name,  // 给 AI 用的精确名（顶栏项为英文功能名），无则同 areaName
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
  // 重置当前诉求，回到"待点选"空状态 → 收起底部操作条
  intents = {};
  hideStep('.cssw-step-area');
  hideStep('.cssw-step-what');
  hideFooter();
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
  if (!step.hidden) {
    // 关闭购物车：若还停在"选部位"步骤，恢复底部操作条
    step.hidden = true; step.innerHTML = '';
    const whatStep = panelEl.querySelector('.cssw-step-what');
    if (whatStep && !whatStep.hidden) showFooter();
    return;
  }
  // 打开购物车：收起底部操作条，用购物车自己的生成按钮（避免两个生成按钮打架）
  hideFooter();
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
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : '',
    id: el.id || '',
    classes: classes.slice(0, 6),
    standardSelector: standardSelector || '',
    uniqueSelector: buildUniqueSelector(el),  // 尽量唯一的路径，让 AI 只改这一个
  };
}

/**
 * 生成"尽量唯一"的选择器：优先自身 id；否则向上找带 id 的祖先做锚点 + 后代路径。
 * 目的：避免 AI 拿 .drawer-icon 这类通用类，一改改一整批。
 */
function buildUniqueSelector(el) {
  try {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    // 向上找最近的带唯一 id 的祖先
    let anchor = el.parentElement;
    const path = [tagWithNth(el)];
    while (anchor && anchor !== document.body) {
      if (anchor.id && document.querySelectorAll('#' + CSS.escape(anchor.id)).length === 1) {
        return '#' + CSS.escape(anchor.id) + ' ' + path.join(' > ');
      }
      path.unshift(tagWithNth(anchor));
      anchor = anchor.parentElement;
    }
    return path.join(' > ');
  } catch (_) { return ''; }
}
function tagWithNth(el) {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
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
