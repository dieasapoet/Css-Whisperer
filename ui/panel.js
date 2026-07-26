/**
 * 面板 —— 引导式问答（翻译助手的主界面）
 *
 * 流程：
 *   打开面板 → 点「点选元素」→ 在页面点一处
 *   → 面板显示"这是【区域名】"（可放大/缩小选择）
 *   → 选"改什么"（颜色/大小/位置/自定义）
 *   → 选"怎么改"（+ 可选自定义补充）
 *   → 当场分析该处 CSS → 生成给 AI 的提问文字 → 一键复制
 *
 * 皮肤：磨砂 / Claude 两套，用下拉栏选择（为将来"用户自装主题"留扩展位）。
 * 皮肤只影响本面板自身外观，不碰作者主题。
 */

import { enterPickMode, exitPickMode, isPicking, getContainerChain, showToast } from '../src/picker.js';
import { identify } from '../src/semantic.js';
import { analyze } from '../src/analyzer.js';
import { WHAT_OPTIONS, getHowOptions, buildPrompt } from '../src/prompt-builder.js';

const PANEL_ID = 'cssw-panel';
const SKIN_FROSTED = 'cssw-skin-frosted';
const SKIN_CLAUDE = 'cssw-skin-claude';
const SKIN_STORAGE_KEY = 'css-whisperer:skin';

let panelEl = null;
let currentSkin = 'frosted';

// 当前选择状态
let containerChain = [];   // 从细到粗的层级链
let chainIndex = 0;        // 当前选中层级
let currentTarget = null;  // 当前元素
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
  if (!panelEl) return;
  panelEl.classList.remove(SKIN_FROSTED, SKIN_CLAUDE);
  panelEl.classList.add(getSkinClass());
}

/* ============ 初始化 ============ */

function initPanel() {
  currentSkin = loadSkin();
}

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

/* ============ 骨架 ============ */

function renderShell() {
  return `
    <div class="cssw-header">
      <span class="cssw-title">点问 · CSS Whisperer</span>
      <div class="cssw-header-right">
        <select class="cssw-skin-select" title="面板皮肤">
          <option value="frosted">磨砂</option>
          <option value="claude">Claude</option>
        </select>
        <button type="button" class="cssw-close" title="关闭">✕</button>
      </div>
    </div>
    <div class="cssw-body">
      <div class="cssw-step cssw-step-pick">
        <button type="button" class="cssw-pick-btn">🎯 点选界面上要改的地方</button>
        <p class="cssw-tip">点一下按钮，然后去点消息气泡、头像、输入框……任意位置。</p>
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

  const skinSel = panelEl.querySelector('.cssw-skin-select');
  skinSel.value = currentSkin;
  skinSel.addEventListener('change', (e) => {
    currentSkin = e.target.value === 'claude' ? 'claude' : 'frosted';
    persistSkin(currentSkin);
    applySkin();
  });

  panelEl.querySelector('.cssw-pick-btn').addEventListener('click', onPickClick);
}

/* ============ 打开 / 关闭 ============ */

function openPanel() {
  ensurePanel();
  applySkin();
  panelEl.querySelector('.cssw-skin-select').value = currentSkin;
  panelEl.setAttribute('data-open', 'true');
}

function closePanel() {
  if (isPicking()) exitPickMode();
  if (panelEl) panelEl.setAttribute('data-open', 'false');
}

/* ============ 点选 ============ */

function onPickClick() {
  if (isPicking()) {
    exitPickMode();
    return;
  }
  enterPickMode((el) => {
    onElementPicked(el);
  });
}

function onElementPicked(el) {
  currentTarget = el;
  containerChain = getContainerChain(el);
  chainIndex = 0;
  // 重置后续选择
  sel = { whatKey: null, whatLabel: null, howKey: null, howLabel: null, customText: '' };
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
      const nm = identify(node).name;
      const active = i === chainIndex ? ' active' : '';
      return `<button type="button" class="cssw-chain-item${active}" data-idx="${i}">${escapeHtml(nm)}</button>`;
    }).join('');
    chainButtons = `<div class="cssw-chain">
        <div class="cssw-chain-hint">选大一点 / 小一点：</div>
        <div class="cssw-chain-list">${chainButtons}</div>
      </div>`;
  }

  step.innerHTML = `
    <div class="cssw-area-name">这是：<b>${escapeHtml(info.name)}</b></div>
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
    // 有自定义文字时也能直接生成
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
    analysis = analyze(el, sel.whatKey);   // 当场读 CSS，看完即焚；按"改什么"过滤属性
  } catch (e) {
    console.error('[css-whisperer] 分析失败', e);
    analysis = { relevantRules: [], pseudo: [], variables: [], computed: {}, authoredHere: false, partialUnreadable: true };
  }

  const locator = buildLocator(el, info.standardSelector);
  const text = buildPrompt({
    areaName: info.name,
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

  // 滚到结果
  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============ 工具 ============ */

/**
 * 从元素提取定位信息（情形 B 用）——纯运行时结构，不持久化
 */
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
