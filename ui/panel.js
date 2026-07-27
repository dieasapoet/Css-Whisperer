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
import { readNativeCSS } from '../src/editor.js';

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
      <div class="cssw-step cssw-step-result" hidden></div>
      <div class="cssw-empty">点顶部 🎯 开始：先点界面上想改的地方。</div>
    </div>
    <div class="cssw-footer" hidden>
      <button type="button" class="cssw-gen-btn">💬 生成提问问 AI</button>
    </div>
  `;
}

function bindShellEvents() {
  panelEl.querySelector('.cssw-close').addEventListener('click', closePanel);
  panelEl.querySelector('.cssw-min').addEventListener('click', collapseToOrb);
  panelEl.querySelector('.cssw-tb-pick').addEventListener('click', onPickClick);
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
  hideStep('.cssw-step-result');
  const empty = panelEl.querySelector('.cssw-empty'); if (empty) empty.hidden = true;
  expandPanel();
  renderArea();       // 极简一屏：区域名 + 选择器(可复制) + 有无对应代码 + 诉求框 + 层级链
  showFooter();
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

  // 从 customCSS 全文里挖出"含这个元素(及父级)"的相关规则原文，直接显示 + 给搜索词
  const rules = findRelatedRules(el);
  let codeHtml;
  if (rules.length) {
    codeHtml = `<div class="cssw-rules"><div class="cssw-rules-title">📄 你的自定义CSS里，和这里相关的代码（${rules.length} 段）：</div>`
      + rules.map((r) => `<div class="cssw-rule">`
        + `<pre class="cssw-rule-code">${escapeHtml(r.text)}</pre>`
        + `<div class="cssw-rule-find"><span>去编辑器里搜这段定位：</span><code>${escapeHtml(r.needle)}</code><button type="button" class="cssw-rule-copy" data-needle="${escapeHtml(r.needle)}" title="复制搜索词">📋</button></div>`
        + `</div>`).join('')
      + `</div>`;
  } else {
    codeHtml = `<div class="cssw-has cssw-has-no">⚠️ 你的自定义CSS里还没写这里的样式，需要新加一条（点下面生成提问让 AI 帮你写）</div>`;
  }

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
      ${codeHtml}
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

  step.querySelectorAll('.cssw-rule-copy').forEach((btn) => {
    btn.addEventListener('click', () => copyText(btn.getAttribute('data-needle') || '', btn));
  });

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
    });
  });
}

/* ============ 当前选中元素持续高亮 ============ */
let persistHlEl = null;
let persistTarget = null;
let persistRaf = null;

let persistScheduled = false;
function showPersistentHighlight(el) {
  persistTarget = el;
  if (!persistHlEl) {
    persistHlEl = document.createElement('div');
    persistHlEl.className = 'cssw-persist-highlight';
    document.body.appendChild(persistHlEl);
  }
  positionPersist();
  // #4 卡顿修复：不再每帧 rAF 死循环读 rect；只在滚动/缩放时按需重定位（rAF 节流一次）
  window.addEventListener('scroll', onPersistReflow, true);
  window.addEventListener('resize', onPersistReflow, true);
}
function positionPersist() {
  if (!persistHlEl || !persistTarget) return;
  if (!document.body.contains(persistTarget)) { hidePersistentHighlight(); return; }
  const r = persistTarget.getBoundingClientRect();
  persistHlEl.style.display = 'block';
  persistHlEl.style.top = (r.top + window.scrollY) + 'px';
  persistHlEl.style.left = (r.left + window.scrollX) + 'px';
  persistHlEl.style.width = r.width + 'px';
  persistHlEl.style.height = r.height + 'px';
}
function onPersistReflow() {
  if (persistScheduled) return;
  persistScheduled = true;
  requestAnimationFrame(() => { persistScheduled = false; positionPersist(); });
}
function hidePersistentHighlight() {
  persistTarget = null;
  cancelAnimationFrame(persistRaf);
  window.removeEventListener('scroll', onPersistReflow, true);
  window.removeEventListener('resize', onPersistReflow, true);
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

// 从 #customCSS 全文里挖出"选择器含这个元素(或父级1-2层)id/class"的规则段，整段返回。
// 搜锚点(class/id)而非 computed 值——伪元素文案/类选择器/var() 写的规则，computed 对不上，
// 但源码选择器里必然含它的 class/id。父级也搜：伪元素假文字常写在父容器选择器上。
function findRelatedRules(el) {
  const css = safeReadNativeCSS();
  if (!css) return [];

  // 收集锚点：元素自身 + 父级 1-2 层 的 id / 有意义 class
  const anchors = [];
  let node = el;
  for (let d = 0; d <= 2 && node && node !== document.body; d++) {
    if (node.id) anchors.push('#' + node.id);
    try { node.classList.forEach((c) => { if (!c.startsWith('cssw-') && c.length > 1) anchors.push('.' + c); }); } catch (_) {}
    node = node.parentElement;
  }
  if (!anchors.length) return [];

  // 把 customCSS 切成一条条规则块（selector { ... }），只保留选择器命中锚点的
  const out = [];
  const seen = new Set();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null && out.length < 8) {
    const selector = m[1].trim().replace(/^[\s\S]*?\*\//, '').trim(); // 去掉规则前残留的注释尾
    const body = m[2].trim();
    if (!selector || selector.startsWith('@')) continue;
    // 选择器里是否含任一锚点（作为完整 token，避免 .mes 命中 .message）
    const hit = anchors.find((a) => selectorHasAnchor(selector, a));
    if (!hit) continue;
    const full = `${selector} { ${body} }`;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ text: shorten(full, 400), needle: deriveNeedle(selector, body, hit) });
  }
  return out;
}

// 选择器里是否把锚点当作完整 token 出现（前后是边界符，不是别的类名的一部分）
function selectorHasAnchor(selector, anchor) {
  const i = selector.indexOf(anchor);
  if (i === -1) return false;
  const after = selector[i + anchor.length];
  return after === undefined || /[\s.#:>,+~\[]/.test(after);
}

// 给一段规则挑个"独一无二、好搜"的搜索词：优先 content 的文案，否则用带锚点的选择器串
function deriveNeedle(selector, body, anchor) {
  const cm = body.match(/content\s*:\s*(["'][^"']*["']|var\([^)]*\))/);
  if (cm) return `content: ${cm[1]}`;   // 伪元素文案：content: "曲名" —— 最独特
  // 否则取包含锚点的那一段选择器（如 .mesIDDisplay::before）
  const seg = selector.split(',').find((s) => s.includes(anchor)) || selector;
  return seg.trim().slice(0, 60);
}

function shorten(s, n) { return s.length > n ? s.slice(0, n) + ' …' : s; }


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
  hideStep('.cssw-step-result');
  hideFooter();
  hidePersistentHighlight();
  const empty = panelEl.querySelector('.cssw-empty');
  if (empty) { empty.hidden = false; empty.textContent = '已清空。点顶部 🎯 重新选择要改的地方。'; }
  showToast('已清空，可以重新开始');
}

/* ============ 工具 ============ */
/**
 * 生成"尽量唯一又尽量短、可读"的选择器。优先级：
 *   1. 自身唯一 id
 *   2. 自身 class 组合（若在全页唯一）
 *   3. 最近的"有意义 class/id"祖先 做锚点 + 自身 class 或短路径
 *   4. 实在没有 → 短 nth-of-type 路径（限深 3 层，不拼到 body）
 * 避免截图那种 `#chat div:nth-of-type(2)>div:nth-of-type(4)>...` 又长又脆。
 */
function buildUniqueSelector(el) {
  try {
    if (!el || el.nodeType !== 1) return '';
    const esc = (s) => CSS.escape(s);
    const uniq = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; } };

    // 1. 自身唯一 id
    if (el.id && uniq('#' + esc(el.id))) return '#' + esc(el.id);

    // 2. 自身 class 组合唯一
    const ownClasses = meaningfulClasses(el);
    if (ownClasses.length) {
      const bySelf = el.tagName.toLowerCase() + ownClasses.map((c) => '.' + esc(c)).join('');
      if (uniq(bySelf)) return bySelf;
      const byClassOnly = ownClasses.map((c) => '.' + esc(c)).join('');
      if (uniq(byClassOnly)) return byClassOnly;
    }

    // 3. 找最近的"锚点"祖先（唯一 id 或有意义 class），锚点 + 自身特征
    const selfPart = ownClasses.length
      ? el.tagName.toLowerCase() + ownClasses.map((c) => '.' + esc(c)).join('')
      : tagWithNth(el);
    let anchor = el.parentElement;
    let depth = 0;
    while (anchor && anchor !== document.body && depth < 4) {
      if (anchor.id && uniq('#' + esc(anchor.id))) {
        const sel = '#' + esc(anchor.id) + ' ' + selfPart;
        return uniq(sel) ? sel : '#' + esc(anchor.id) + ' ' + tagWithNth(el);
      }
      const ac = meaningfulClasses(anchor);
      if (ac.length) {
        const anchorSel = '.' + esc(ac[0]);
        if (uniq(anchorSel + ' ' + selfPart)) return anchorSel + ' ' + selfPart;
      }
      anchor = anchor.parentElement;
      depth++;
    }

    // 4. 兜底：自身特征（可能不唯一，但短、可读，好过超长 nth 链）
    return selfPart;
  } catch (_) { return ''; }
}

// 取元素"有意义的" class：排除本插件类、疑似动态生成的(纯数字/长哈希/含随机段)
function meaningfulClasses(el) {
  const out = [];
  try {
    el.classList.forEach((c) => {
      if (c.startsWith('cssw-')) return;
      if (/^[0-9]/.test(c)) return;                 // 数字开头
      if (/^[a-z0-9]{8,}$/i.test(c) && !/[-_]/.test(c)) return;  // 无分隔的长串，疑似哈希
      if (c.length > 30) return;
      out.push(c);
    });
  } catch (_) {}
  return out.slice(0, 3);
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
