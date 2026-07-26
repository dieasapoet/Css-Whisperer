/**
 * 面板 —— 引导式问答（翻译助手的主界面）
 *
 * 两态设计：
 *   - 收起态：一个可拖拽的小圆球（默认停右侧边缘），点它展开面板。占地极小、不挡视线。
 *   - 展开态：完整问答面板（点选→区域→改什么→怎么改→生成提问→复制）。
 *   进入选择模式时面板自动收成圆球并半透明让位，圆球脉冲高亮反馈"正在选择"。
 *
 * ★ 防抽屉收起（沿用 theme-tap 验证过的方案）：
 *   ST 会"点到抽屉外部就自动收起抽屉"。若不处理，用户展开角色面板后一点插件，
 *   面板就被收起，永远选不到抽屉里的元素（如角色头像大小）。
 *   解法：圆球和面板都吞掉自己的 click + mousedown（stopPropagation），
 *   让 ST 收不到"外部点击"，抽屉保持展开。
 *   配合 picker 只拦 click 不拦 pointerdown，用户可"先展开抽屉再进选择模式点里面"。
 *
 * 皮肤：磨砂 / Claude 两套，下拉选择。只影响本面板外观，不碰作者主题。
 */

import { enterPickMode, exitPickMode, isPicking, getContainerChain, showToast } from '../src/picker.js';
import { identify } from '../src/semantic.js';
import { analyze } from '../src/analyzer.js';
import { WHAT_OPTIONS, getHowOptions, buildPrompt } from '../src/prompt-builder.js';

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

// 当前选择状态
let containerChain = [];
let chainIndex = 0;
let currentTarget = null;
let sel = { whatKey: null, whatLabel: null, howKey: null, howLabel: null, customText: '' };

/* ============ 皮肤 ============ */

function getSkinClass() {
  return currentSkin === 'claude' ? SKIN_CLAUDE : SKIN_FROSTED;
}

function loadSkin() {
  try {
    const s = localStorage.getItem(SKIN_STORAGE_KEY);
    if (s === 'frosted' || s === 'claude') return s;
  } catch (_) {}
  return 'frosted';
}

function persistSkin(skin) {
  try { localStorage.setItem(SKIN_STORAGE_KEY, skin); } catch (_) {}
}

function applySkin() {
  const cls = getSkinClass();
  [panelEl, orbEl].forEach((el) => {
    if (!el) return;
    el.classList.remove(SKIN_FROSTED, SKIN_CLAUDE);
    el.classList.add(cls);
  });
}

/* ============ 初始化 ============ */

function initPanel() {
  currentSkin = loadSkin();
}

/* ============ 圆球（收起态） ============ */

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

  // 拖拽（Pointer Events + 5px 阈值区分点击/拖动）
  orbEl.addEventListener('pointerdown', onOrbPointerDown);
  orbEl.addEventListener('pointermove', onOrbPointerMove);
  orbEl.addEventListener('pointerup', onOrbPointerUp);
  orbEl.addEventListener('pointercancel', () => { orbGesture = null; });

  // ★ 防抽屉收起：吞掉 click + mousedown，别让 ST 当成"外部点击"
  orbEl.addEventListener('click', (e) => e.stopPropagation());
  orbEl.addEventListener('mousedown', (e) => e.stopPropagation());

  return orbEl;
}

function onOrbPointerDown(e) {
  if (!e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  orbGesture = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startRect: e.currentTarget.getBoundingClientRect(),
    dragging: false,
  };
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
    // 点击圆球 → 展开面板
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
  try {
    const raw = localStorage.getItem(ORB_POS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (typeof d.fx === 'number' && typeof d.fy === 'number') return d;
    }
  } catch (_) {}
  return { fx: 0.86, fy: 0.72 };  // 默认停右下角，避开顶栏和中间内容
}

function saveOrbPos(pos) {
  try { localStorage.setItem(ORB_POS_KEY, JSON.stringify(pos)); } catch (_) {}
}

function showOrb() { ensureOrb().style.display = 'flex'; }
function hideOrb() { if (orbEl) orbEl.style.display = 'none'; }

/* ============ 面板（展开态） ============ */

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

function renderShell() {
  return `
    <div class="cssw-header">
      <span class="cssw-title">点问 · CSS Whisperer</span>
      <div class="cssw-header-right">
        <select class="cssw-skin-select" title="面板皮肤">
          <option value="frosted">磨砂</option>
          <option value="claude">Claude</option>
        </select>
        <button type="button" class="cssw-min" title="收起成小球">－</button>
        <button type="button" class="cssw-close" title="关闭">✕</button>
      </div>
    </div>
    <div class="cssw-body">
      <div class="cssw-step cssw-step-pick">
        <button type="button" class="cssw-pick-btn">🎯 点选界面上要改的地方</button>
        <p class="cssw-tip">点按钮后去点任意位置。要改展开面板里的东西（如角色头像），先展开它再点选。</p>
      </div>
      <div class="cssw-step cssw-step-area" hidden></div>
      <div class="cssw-step cssw-step-what" hidden></div>
      <div class="cssw-step cssw-step-how" hidden></div>
      <div class="cssw-step cssw-step-result" hidden></div>
    </div>
  `;
}

function bindShellEvents() {
  panelEl.querySelector('.cssw-close').addEventListener('click', closePanel);
  panelEl.querySelector('.cssw-min').addEventListener('click', collapseToOrb);

  const skinSel = panelEl.querySelector('.cssw-skin-select');
  skinSel.value = currentSkin;
  skinSel.addEventListener('change', (e) => {
    currentSkin = e.target.value === 'claude' ? 'claude' : 'frosted';
    persistSkin(currentSkin);
    applySkin();
  });

  panelEl.querySelector('.cssw-pick-btn').addEventListener('click', onPickClick);

  // ★ 防抽屉收起：面板吞掉自己的 click + mousedown
  panelEl.addEventListener('click', (e) => e.stopPropagation());
  panelEl.addEventListener('mousedown', (e) => e.stopPropagation());
}

/* ============ 两态切换 ============ */

// 外部入口（魔棒菜单点击）：默认展开面板
function openPanel() {
  expandPanel();
  maybeShowFirstRunNotice();
}

// 首次使用提醒一次（尊重作者授权），之后不再出现
function maybeShowFirstRunNotice() {
  try {
    if (localStorage.getItem(NOTICE_KEY)) return;
    localStorage.setItem(NOTICE_KEY, '1');
  } catch (_) {}
  showToast('本工具帮你把想改的地方翻译成给 AI 的提问。请尊重主题作者的授权，仅在允许的范围内修改。');
}

// 展开：显示面板，隐藏圆球
function expandPanel() {
  ensurePanel();
  applySkin();
  panelEl.querySelector('.cssw-skin-select').value = currentSkin;
  panelEl.setAttribute('data-open', 'true');
  hideOrb();
}

// 收起成圆球：隐藏面板，显示圆球
function collapseToOrb() {
  if (panelEl) panelEl.setAttribute('data-open', 'false');
  showOrb();
}

// 关闭：面板和圆球都收起（回到魔棒菜单入口）
function closePanel() {
  if (isPicking()) exitPickMode();
  if (panelEl) panelEl.setAttribute('data-open', 'false');
  hideOrb();
}

/* ============ 点选 ============ */

function onPickClick() {
  if (isPicking()) {
    exitPickMode();
    onPickModeExit();
    return;
  }
  // 进入选择模式：面板收成圆球让位 + 圆球脉冲反馈
  enterPickMode((el) => {
    onPickModeExit();
    onElementPicked(el);
  });
  onPickModeEnter();
}

// 进入选择模式：面板缩成圆球并高亮脉冲，让出视线
function onPickModeEnter() {
  if (panelEl) panelEl.setAttribute('data-open', 'false');
  showOrb();
  if (orbEl) orbEl.classList.add('cssw-orb-picking');
}

// 退出选择模式：去掉圆球脉冲
function onPickModeExit() {
  if (orbEl) orbEl.classList.remove('cssw-orb-picking');
}

function onElementPicked(el) {
  currentTarget = el;
  containerChain = getContainerChain(el);
  chainIndex = 0;
  sel = { whatKey: null, whatLabel: null, howKey: null, howLabel: null, customText: '' };
  // 选完自动展开面板到结果
  expandPanel();
  renderArea();
  renderWhat();
  hideStep('.cssw-step-how');
  hideStep('.cssw-step-result');
}

/* ============ 步骤：区域 + 放大/缩小 ============ */

function renderArea() {
  const el = containerChain[chainIndex] || currentTarget;
  const info = identify(el);
  const step = panelEl.querySelector('.cssw-step-area');

  let chainButtons = '';
  if (containerChain.length > 1) {
    chainButtons = containerChain.map((node, i) => {
      const ci = identify(node);
      const label = ci.note ? `${ci.name}（${ci.note}）` : ci.name;
      const active = i === chainIndex ? ' active' : '';
      return `<button type="button" class="cssw-chain-item${active}" data-idx="${i}">${escapeHtml(label)}</button>`;
    }).join('');
    chainButtons = `<div class="cssw-chain">
        <div class="cssw-chain-hint">选大一点 / 小一点：</div>
        <div class="cssw-chain-list">${chainButtons}</div>
      </div>`;
  }

  const nameLabel = info.note
    ? `<b>${escapeHtml(info.name)}</b><span class="cssw-area-note">（${escapeHtml(info.note)}）</span>`
    : `<b>${escapeHtml(info.name)}</b>`;
  step.innerHTML = `
    <div class="cssw-area-name">这是：${nameLabel}</div>
    ${chainButtons}
    <button type="button" class="cssw-repick">↺ 重新点选</button>
  `;
  step.hidden = false;

  step.querySelectorAll('.cssw-chain-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      chainIndex = parseInt(btn.getAttribute('data-idx'), 10) || 0;
      renderArea();
    });
  });
  step.querySelector('.cssw-repick').addEventListener('click', onPickClick);
}

/* ============ 步骤：改什么 ============ */

function renderWhat() {
  const step = panelEl.querySelector('.cssw-step-what');
  const btns = WHAT_OPTIONS.map((o) =>
    `<button type="button" class="cssw-opt" data-key="${o.key}" data-label="${escapeHtml(o.label)}">${escapeHtml(o.label)}</button>`
  ).join('');
  step.innerHTML = `<div class="cssw-q">想改什么？</div><div class="cssw-opts">${btns}</div>`;
  step.hidden = false;

  step.querySelectorAll('.cssw-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      sel.whatKey = btn.getAttribute('data-key');
      sel.whatLabel = btn.getAttribute('data-label');
      markActive(step, btn);
      renderHow();
    });
  });
}

/* ============ 步骤：怎么改（+ 自定义） ============ */

function renderHow() {
  const step = panelEl.querySelector('.cssw-step-how');
  const opts = getHowOptions(sel.whatKey);
  const btns = opts.map((o) =>
    `<button type="button" class="cssw-opt" data-key="${o.key}" data-label="${escapeHtml(o.label)}">${escapeHtml(o.label)}</button>`
  ).join('');
  step.innerHTML = `
    <div class="cssw-q">想怎么改？</div>
    <div class="cssw-opts">${btns}</div>
    <textarea class="cssw-custom" placeholder="也可以自己描述，例如：改成半透明的深蓝色，圆角大一点"></textarea>
    <button type="button" class="cssw-gen-btn" disabled>生成给 AI 的提问 →</button>
  `;
  step.hidden = false;
  hideStep('.cssw-step-result');

  const genBtn = step.querySelector('.cssw-gen-btn');
  const customBox = step.querySelector('.cssw-custom');

  step.querySelectorAll('.cssw-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      sel.howKey = btn.getAttribute('data-key');
      sel.howLabel = btn.getAttribute('data-label');
      markActive(step, btn);
      genBtn.disabled = false;
    });
  });

  customBox.addEventListener('input', () => {
    sel.customText = customBox.value;
    genBtn.disabled = !(sel.howKey || customBox.value.trim());
  });

  genBtn.addEventListener('click', onGenerate);
}

/* ============ 生成结果 ============ */

function onGenerate() {
  const el = containerChain[chainIndex] || currentTarget;
  if (!el) return;

  const info = identify(el);
  let analysis;
  try {
    analysis = analyze(el, sel.whatKey);
  } catch (e) {
    console.error('[css-whisperer] 分析失败', e);
    analysis = { relevantRules: [], pseudo: [], variables: [], computed: {}, authoredHere: false, partialUnreadable: true };
  }

  const locator = buildLocator(el, info.standardSelector);
  const text = buildPrompt({
    areaName: info.note ? `${info.name}（${info.note}）` : info.name,
    whatKey: sel.whatKey,
    whatLabel: sel.whatLabel || '样式',
    howLabel: sel.howLabel || '（见下方描述）',
    customText: sel.customText,
    analysis,
    locator,
  });

  renderResult(text);
}

function renderResult(text) {
  const step = panelEl.querySelector('.cssw-step-result');
  step.innerHTML = `
    <div class="cssw-q">复制下面这段，发给 AI（比如 ChatGPT / Claude）：</div>
    <textarea class="cssw-result-text" readonly></textarea>
    <button type="button" class="cssw-copy-btn">📋 一键复制</button>
  `;
  step.hidden = false;
  step.querySelector('.cssw-result-text').value = text;

  step.querySelector('.cssw-copy-btn').addEventListener('click', () => {
    copyText(text);
  });

  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============ 工具 ============ */

function buildLocator(el, standardSelector) {
  const classes = [];
  try {
    el.classList.forEach((c) => { if (!c.startsWith('cssw-')) classes.push(c); });
  } catch (_) {}
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : '',
    id: el.id || '',
    classes: classes.slice(0, 6),
    standardSelector: standardSelector || '',
  };
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('已复制，去粘给 AI 吧'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制，去粘给 AI 吧');
  } catch (_) {
    showToast('复制失败，请手动长按选中文字复制');
  }
}

function markActive(container, btn) {
  container.querySelectorAll('.cssw-opt').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

function hideStep(selector) {
  const s = panelEl.querySelector(selector);
  if (s) { s.hidden = true; s.innerHTML = ''; }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { initPanel, openPanel, closePanel };
