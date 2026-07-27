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
import { buildPrompt } from '../src/prompt-builder.js';
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
let userText = '';        // 用户一句话诉求（自由输入）
let lastAnalysis = null;  // 当前元素现状 { computed, pseudo }
let lastSelector = '';    // 当前元素精确选择器

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
      <span class="cssw-tb-title">点问</span>
      <select class="cssw-skin-select cssw-tb-skin" title="面板皮肤">
        <option value="frosted">磨砂</option>
        <option value="claude">Claude</option>
      </select>
      <button type="button" class="cssw-tb cssw-min" title="收起成小球">－</button>
      <button type="button" class="cssw-tb cssw-close" title="关闭">✕</button>
    </div>
    <div class="cssw-body">
      <div class="cssw-step cssw-step-area" hidden></div>
      <div class="cssw-step cssw-step-editor" hidden></div>
      <div class="cssw-step cssw-step-result" hidden></div>
      <div class="cssw-empty">点顶部 🎯 开始：先点界面上想改的地方。</div>
    </div>
    <div class="cssw-footer" hidden>
      <button type="button" class="cssw-gen-btn">生成提问问 AI</button>
    </div>
  `;
}

function bindShellEvents() {
  panelEl.querySelector('.cssw-close').addEventListener('click', closePanel);
  panelEl.querySelector('.cssw-min').addEventListener('click', collapseToOrb);
  panelEl.querySelector('.cssw-tb-pick').addEventListener('click', onPickClick);
  panelEl.querySelector('.cssw-tb-editor').addEventListener('click', () => toggleEditor());
  // 固定底部操作条：生成提问
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
 * 只在"选好元素"时显示；编辑器/纯结果态隐藏。*/
function showFooter() {
  const f = panelEl && panelEl.querySelector('.cssw-footer');
  if (f) f.hidden = false;
}
function hideFooter() {
  const f = panelEl && panelEl.querySelector('.cssw-footer');
  if (f) f.hidden = true;
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

  // #11 兜底：双击工具栏空白处复位（按钮/下拉上的双击不触发）
  bar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.cssw-tb, .cssw-skin-select')) return;
    resetPanelPos();
  });
}

// 切成显式定位并夹在视口内
function setPanelPos(left, top) {
  const w = panelEl.offsetWidth, h = panelEl.offsetHeight;
  const maxL = Math.max(0, window.innerWidth - w);
  // 顶部下限留出安全边距：避免面板被拖到 ST 顶栏下、工具栏(拖动手柄)被顶栏盖住而拖不动(#11)
  const minT = 8;
  const maxT = Math.max(minT, window.innerHeight - Math.min(h, window.innerHeight * 0.9));
  left = Math.max(0, Math.min(maxL, left));
  top = Math.max(minT, Math.min(maxT, top));
  panelEl.classList.add('cssw-moved');
  panelEl.style.left = left + 'px';
  panelEl.style.top = top + 'px';
}

// #11 兜底：双击工具栏空白处，把面板复位到默认居中位置——任何情况下都能救回
function resetPanelPos() {
  panelEl.classList.remove('cssw-moved');
  panelEl.style.left = '';
  panelEl.style.top = '';
  panelEl.style.width = '';
  try { localStorage.removeItem(PANEL_RECT_KEY); } catch (_) {}
  showToast('面板已复位');
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
  userText = '';
  editorOpen = false;
  hideStep('.cssw-step-editor');
  hideStep('.cssw-step-result');
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  expandPanel();
  renderArea();       // 显示：区域名 + 精确选择器(可复制) + 现状 + 层级链 + 诉求输入框
  showFooter();
  // 默认打开编辑器并定位到该元素相关那段（会改的人当场改）
  openEditorAndLocate();
}

/* ============ CSS 编辑框 ============ */
function toggleEditor() {
  const step = panelEl.querySelector('.cssw-step-editor');
  if (editorOpen) { step.hidden = true; step.innerHTML = ''; editorOpen = false; return; }
  if (!nativeExists()) { showToast('找不到 SillyTavern 的自定义CSS框，请先打开一次「用户设置」'); return; }
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  renderEditor();
  editorOpen = true;
}

// 点选后默认调用：打开编辑器，并尝试定位到当前元素相关那段（搜到→跳转高亮；搜不到→面板提示，不写入）
function openEditorAndLocate() {
  if (!nativeExists()) return;  // 没有 #customCSS 框就跳过，area 仍显示
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  renderEditor(lastSelector);
  editorOpen = true;
}

async function renderEditor(locateSelector) {
  const step = panelEl.querySelector('.cssw-step-editor');
  step.innerHTML = `
    <div class="cssw-editor-searchrow">
      <input type="text" class="cssw-editor-search" placeholder="搜索定位（回车跳下一个，Shift+回车上一个）" />
      <button type="button" class="cssw-editor-prev" title="上一个">▲</button>
      <button type="button" class="cssw-editor-next" title="下一个">▼</button>
      <button type="button" class="cssw-editor-top" title="回到顶部">⤒</button>
      <button type="button" class="cssw-editor-bottom" title="到达底部">⤓</button>
      <span class="cssw-editor-count">0/0</span>
    </div>
    <div class="cssw-editor-actions">
      <button type="button" class="cssw-editor-save">💾 保存</button>
      <button type="button" class="cssw-editor-undo">↶ 撤回</button>
      <button type="button" class="cssw-editor-redo">↷ 重做</button>
      <button type="button" class="cssw-editor-reset">⟲ 重置</button>
    </div>
    <div class="cssw-editor-host">
      <pre class="cssw-editor-highlight" aria-hidden="true"><code class="language-css"></code></pre>
      <textarea class="cssw-editor-textarea" spellcheck="false"></textarea>
    </div>
  `;
  step.hidden = false;

  const ta = step.querySelector('.cssw-editor-textarea');
  const hlPre = step.querySelector('.cssw-editor-highlight');
  const hlCode = hlPre ? hlPre.querySelector('code') : null;
  const searchBox = step.querySelector('.cssw-editor-search');
  const prevBtn = step.querySelector('.cssw-editor-prev');
  const nextBtn = step.querySelector('.cssw-editor-next');
  const topBtn = step.querySelector('.cssw-editor-top');
  const bottomBtn = step.querySelector('.cssw-editor-bottom');
  const countEl = step.querySelector('.cssw-editor-count');
  const saveBtn = step.querySelector('.cssw-editor-save');
  const undoBtn = step.querySelector('.cssw-editor-undo');
  const redoBtn = step.querySelector('.cssw-editor-redo');
  const resetBtn = step.querySelector('.cssw-editor-reset');

  // 镜像 ST 原生 #customCSS（同一份，不产生第二份 CSS）
  const openBackup = readNativeCSS();
  ta.value = openBackup;

  // ---- hljs 语法高亮叠层（ST 内置 window.hljs，不抢全局；缺失则降级为纯 textarea）----
  const hasHljs = !!(window.hljs && typeof window.hljs.highlight === 'function');
  if (!hasHljs && hlPre) hlPre.style.display = 'none';  // 无 hljs：藏掉高亮层，textarea 变不透明(靠 CSS)
  const syncHighlight = () => {
    if (!hasHljs || !hlCode) return;
    let html;
    try { html = window.hljs.highlight(ta.value, { language: 'css' }).value; }
    catch (_) { html = escapeHtml(ta.value); }
    // 结尾换行不渲染，补一个占位，保证末行高度对齐
    hlCode.innerHTML = html + '\n';
    hlPre.scrollTop = ta.scrollTop;
    hlPre.scrollLeft = ta.scrollLeft;
  };
  step.classList.toggle('cssw-editor-has-hl', hasHljs);

  // 防抽屉/防冒泡：编辑区自己的事件不外泄
  ta.addEventListener('mousedown', (e) => e.stopPropagation());
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  // 高亮层跟随滚动
  ta.addEventListener('scroll', () => { if (hlPre) { hlPre.scrollTop = ta.scrollTop; hlPre.scrollLeft = ta.scrollLeft; } });

  // ---- 撤回/重做：快照栈（编辑防抖后压栈）----
  const undoStack = [];
  const redoStack = [];
  let lastSnapshot = ta.value;
  let saveTimer = null;
  ta.addEventListener('input', () => {
    syncHighlight();
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
    ta.value = v; lastSnapshot = v; writeNativeCSS(v); syncHighlight(); refreshCount();
  });
  redoBtn.addEventListener('click', () => {
    if (!redoStack.length) return;
    undoStack.push(ta.value);
    const v = redoStack.pop();
    ta.value = v; lastSnapshot = v; writeNativeCSS(v); syncHighlight(); refreshCount();
  });
  resetBtn.addEventListener('click', () => {
    undoStack.push(ta.value); redoStack.length = 0;
    ta.value = openBackup; lastSnapshot = openBackup; writeNativeCSS(openBackup);
    syncHighlight(); refreshCount(); showToast('已恢复到打开编辑器时');
  });

  // #6 显式保存：立即写回 #customCSS（本已自动保存，但给用户可确认的手段）
  saveBtn.addEventListener('click', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    undoStack.push(lastSnapshot); redoStack.length = 0; lastSnapshot = ta.value;
    writeNativeCSS(ta.value);
    const orig = saveBtn.textContent;
    saveBtn.textContent = '✓ 已保存';
    saveBtn.classList.add('cssw-saved');
    setTimeout(() => { saveBtn.textContent = orig; saveBtn.classList.remove('cssw-saved'); }, 1500);
    showToast('已保存到自定义CSS');
  });

  // #4 回顶 / 到底：长代码时不用一直滑（到底还把光标移到末尾，方便在底部粘贴覆盖）
  topBtn.addEventListener('click', () => { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; });
  bottomBtn.addEventListener('click', () => {
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    ta.scrollTop = ta.scrollHeight;
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
    if (hlPre) { hlPre.scrollTop = ta.scrollTop; hlPre.scrollLeft = ta.scrollLeft; }
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
  syncHighlight();  // 初次渲染高亮

  // 点选后定位：在 #customCSS 全文里找该元素相关那段。
  // 用选择器的"最后一段"当搜索词（如 #chat .mes_text → .mes_text），命中率高于整串。
  if (locateSelector) {
    const needle = locateSelectorNeedle(locateSelector);
    const at = needle ? ta.value.indexOf(needle) : -1;
    if (at !== -1) {
      searchBox.value = needle;
      refreshCount();
      goto(1);
      showLocateHint(`已在你的自定义CSS里定位到 ${needle}，可直接改。`, false);
    } else {
      // 搜不到：只提示，绝不往 #customCSS 写任何骨架（见记忆 never-auto-write-user-css）
      showLocateHint(`没在你的自定义CSS里找到 ${needle || '这个元素'} 相关的规则——说明还没给它写过样式。你可以自己在末尾新写一条，或点下面「生成提问问 AI」让 AI 从零帮你写。`, true);
    }
  }
}

// 从精确选择器取一个适合搜索的片段：优先自身 id/class 的最后一段
function locateSelectorNeedle(selector) {
  if (!selector) return '';
  const last = selector.trim().split(/\s+/).pop() || selector;
  // 去掉 :nth-of-type(...) 这类，留纯 #id / .class / tag
  return last.replace(/:nth-of-type\(\d+\)/g, '');
}

// 编辑器顶部的定位提示条（found=false 时是"没找到"的橙色提示）
function showLocateHint(text, notFound) {
  const step = panelEl.querySelector('.cssw-step-editor');
  if (!step) return;
  let hint = step.querySelector('.cssw-editor-tip');
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'cssw-editor-tip';
    step.insertBefore(hint, step.firstChild);
  }
  hint.textContent = text;
  hint.classList.toggle('cssw-editor-tip-warn', !!notFound);
}

/* ============ 区域：区域名 + 精确选择器(可复制) + 现状 + 层级链 + 诉求输入 ============ */
function renderArea() {
  const el = containerChain[chainIndex] || currentTarget;
  const info = identify(el);
  const step = panelEl.querySelector('.cssw-step-area');

  // 现状 + 选择器（供展示 + 生成提问复用）
  try { lastAnalysis = analyze(el); } catch (_) { lastAnalysis = { computed: {}, pseudo: [] }; }
  lastSelector = buildUniqueSelector(el);

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
  const selHtml = lastSelector
    ? `<div class="cssw-sel-row"><code class="cssw-sel-code">${escapeHtml(lastSelector)}</code><button type="button" class="cssw-sel-copy" title="复制选择器">📋</button></div>`
    : '';
  // 现状摘要（最多列几条常用的，避免太长）
  const comp = lastAnalysis && lastAnalysis.computed ? lastAnalysis.computed : {};
  const compKeys = Object.keys(comp).slice(0, 6);
  const compHtml = compKeys.length
    ? `<div class="cssw-now"><div class="cssw-now-title">它现在的样子：</div>${compKeys.map((k) => `<div class="cssw-now-item"><span>${escapeHtml(k)}</span><span>${escapeHtml(comp[k])}</span></div>`).join('')}</div>`
    : '';

  step.innerHTML = `
    <div class="cssw-card cssw-area-card">
      <div class="cssw-area-label">正在改</div>
      <div class="cssw-area-name">${escapeHtml(info.name)}</div>
      ${noteHtml}
      ${selHtml}
      ${chainHtml}
    </div>
    ${compHtml}
    <div class="cssw-card">
      <label class="cssw-q" for="cssw-usertext">你想把它改成什么样？（一句话，可留空）</label>
      <textarea id="cssw-usertext" class="cssw-usertext" rows="2" placeholder="例如：字大一点、背景透明些、加个圆角">${escapeHtml(userText)}</textarea>
    </div>
  `;
  step.hidden = false;

  // 持续高亮当前选中的元素
  showPersistentHighlight(el);

  // 面包屑重建后横向滚动条归零 → 选中项拉回可视区
  const activeCrumb = step.querySelector('.cssw-crumb.active');
  if (activeCrumb && activeCrumb.scrollIntoView) {
    try { activeCrumb.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {}
  }

  const selCopy = step.querySelector('.cssw-sel-copy');
  if (selCopy) selCopy.addEventListener('click', () => copyText(lastSelector, selCopy));

  const ut = step.querySelector('.cssw-usertext');
  if (ut) {
    ut.addEventListener('input', () => { userText = ut.value; });
    ut.addEventListener('mousedown', (e) => e.stopPropagation());
    ut.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  step.querySelectorAll('.cssw-crumb').forEach((btn) => {
    btn.addEventListener('click', () => {
      chainIndex = parseInt(btn.getAttribute('data-idx'), 10) || 0;
      renderArea();
      // 切层后重新定位编辑器
      if (editorOpen) openEditorAndLocate();
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

/* ============ 生成结果 ============ */
function onGenerate() {
  const el = containerChain[chainIndex] || currentTarget;
  if (!el) { showToast('先点 🎯 选一个要改的地方'); return; }
  const info = identify(el);
  if (!lastAnalysis) { try { lastAnalysis = analyze(el); } catch (_) { lastAnalysis = { computed: {}, pseudo: [] }; } }
  if (!lastSelector) lastSelector = buildUniqueSelector(el);
  const text = buildPrompt({
    areaName: info.name,
    areaAiName: info.aiName || info.name,
    selector: lastSelector,
    computed: lastAnalysis.computed,
    pseudo: lastAnalysis.pseudo,
    userText,
    customCss: safeReadNativeCSS(),
  });
  renderResult(text);
}

function safeReadNativeCSS() {
  try { return readNativeCSS() || ''; } catch (_) { return ''; }
}

function renderResult(text) {
  const step = panelEl.querySelector('.cssw-step-result');
  step.innerHTML = `
    <div class="cssw-q">复制发给 AI（ChatGPT / Claude 等）</div>
    <textarea class="cssw-result-text" readonly></textarea>
    <button type="button" class="cssw-copy-btn">📋 一键复制</button>
    <button type="button" class="cssw-restart-btn">🔄 全部清空，重新开始</button>
  `;
  step.hidden = false;
  step.querySelector('.cssw-result-text').value = text;
  const copyBtn = step.querySelector('.cssw-copy-btn');
  copyBtn.addEventListener('click', () => copyText(text, copyBtn));
  step.querySelector('.cssw-restart-btn').addEventListener('click', restartAll);
  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// #7：生成后一键清空，从头改别处
function restartAll() {
  userText = '';
  lastAnalysis = null;
  lastSelector = '';
  currentTarget = null;
  containerChain = [];
  chainIndex = 0;
  hideStep('.cssw-step-area');
  hideStep('.cssw-step-editor');
  hideStep('.cssw-step-result');
  editorOpen = false;
  hideFooter();
  hidePersistentHighlight();
  const empty = panelEl.querySelector('.cssw-empty');
  if (empty) { empty.hidden = false; empty.textContent = '已清空。点顶部 🎯 重新选择要改的地方。'; }
  showToast('已清空，可以重新开始');
}

/* ============ 工具 ============ */
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
function copyText(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => copyFeedback(btn, true), () => fallbackCopy(text, btn));
  } else { fallbackCopy(text, btn); }
}
function fallbackCopy(text, btn) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    copyFeedback(btn, true);
  } catch (_) { copyFeedback(btn, false); }
}
// #3：复制成功让按钮本身即时变化（移动端 toast 可能不弹/被盖，按钮变色最可靠）
function copyFeedback(btn, ok) {
  if (ok) showToast('已复制，去粘给 AI 吧'); else showToast('复制失败，请手动长按选中复制');
  if (!btn) return;
  if (btn._restoreTimer) clearTimeout(btn._restoreTimer);
  if (!btn._origText) btn._origText = btn.textContent;
  btn.textContent = ok ? '✓ 已复制到剪贴板' : '复制失败，请长按选中';
  btn.classList.toggle('cssw-copied', ok);
  btn._restoreTimer = setTimeout(() => {
    btn.textContent = btn._origText;
    btn.classList.remove('cssw-copied');
  }, 1800);
}
function hideStep(selector) { const s = panelEl && panelEl.querySelector(selector); if (s) { s.hidden = true; s.innerHTML = ''; } }
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { initPanel, openPanel, closePanel };
