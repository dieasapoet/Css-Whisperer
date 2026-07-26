/**
 * DOM 拾取系统
 *
 * 职责：进入"点选模式"，让用户点击界面任意元素，把选中的 Element 交给面板。
 *   - 只在 click 捕获阶段拦截（不拦 pointerdown），让 ST 顶栏能正常展开
 *   - pointermove 时高亮鼠标下的元素（所见即所选）
 *   - ESC 或点状态条"取消"退出
 *
 * 与 theme-tap 的区别：翻译助手不持久化，故删掉 uid 标记 / selectorPath 回溯。
 * 只保留"选到元素"与"层级链（放大/缩小选择）"两件事。
 *
 * 法律红线：只在运行时读元素结构用于定位/识别，不写入任何存储。
 */

import { STANDARD_SELECTORS } from './semantic.js';

const PICKING_CLASS = 'cssw-picking';
const HIGHLIGHT_CLASS = 'cssw-highlight';
const STATUS_BAR_ID = 'cssw-status-bar';

// 拾取时需跳过的元素（插件自身 UI）
const SELF_SELECTOR = '.cssw-panel, .cssw-highlight-layer, .cssw-status-bar';

let picking = false;
let highlightEl = null;
let statusBarEl = null;
let onPickCallback = null;

function initPicker() {
  if (!document.querySelector('.cssw-highlight-layer')) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'cssw-highlight-layer ' + HIGHLIGHT_CLASS;
    highlightEl.style.display = 'none';
    document.body.appendChild(highlightEl);
  } else {
    highlightEl = document.querySelector('.cssw-highlight-layer');
  }
}

/**
 * 进入拾取模式
 * @param {Function} onPick - 回调，参数为选中的 Element
 */
function enterPickMode(onPick) {
  if (picking) exitPickMode();
  picking = true;
  onPickCallback = onPick;
  document.body.classList.add(PICKING_CLASS);

  document.addEventListener('click', handleClickCapture, true);
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('keydown', handleKeyDown, true);

  showStatusBar();
}

function exitPickMode() {
  if (!picking) return;
  picking = false;
  onPickCallback = null;
  document.body.classList.remove(PICKING_CLASS);
  document.removeEventListener('click', handleClickCapture, true);
  document.removeEventListener('pointermove', handlePointerMove, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  if (highlightEl) highlightEl.style.display = 'none';
  hideStatusBar();
}

function handleKeyDown(e) {
  if (e.key === 'Escape' && picking) {
    e.preventDefault();
    e.stopPropagation();
    exitPickMode();
    showToast('已取消选择');
  }
}

/**
 * 悬浮状态条：屏幕顶部提示"正在选择元素"
 */
function showStatusBar() {
  if (!statusBarEl) {
    statusBarEl = document.createElement('div');
    statusBarEl.id = STATUS_BAR_ID;
    statusBarEl.className = 'cssw-status-bar';
    statusBarEl.innerHTML = `
      <span class="cssw-status-icon">🎯</span>
      <span class="cssw-status-text">正在选择元素 — 点击任意区域拾取</span>
      <button type="button" class="cssw-status-cancel">取消（ESC）</button>
    `;
    statusBarEl.querySelector('.cssw-status-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      exitPickMode();
    });
    document.body.appendChild(statusBarEl);
  }
  statusBarEl.style.display = 'flex';
}

function hideStatusBar() {
  if (statusBarEl) statusBarEl.style.display = 'none';
}

/**
 * 鼠标移动时高亮元素（不阻止事件，保留 ST 的 hover 效果）
 */
function handlePointerMove(e) {
  if (!picking) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return;
  if (el.closest(SELF_SELECTOR)) {
    if (highlightEl) highlightEl.style.display = 'none';
    return;
  }
  showHighlight(el);
}

/**
 * click 捕获阶段拦截：拾取元素
 * 只在 click 拦截（不拦 pointerdown），让 ST 顶栏能正常展开
 */
function handleClickCapture(e) {
  if (!picking) return;

  const el = document.elementFromPoint(e.clientX, e.clientY);

  // 插件自身 UI：不拦截，让它们的 click 正常触发（如"取消"退出）
  if (el && el.closest(SELF_SELECTOR)) return;

  e.preventDefault();
  e.stopPropagation();

  if (!el) return;

  const cb = onPickCallback;
  exitPickMode();
  if (cb) cb(el);
}

/**
 * 获取从"点击的精确元素"到"最浅标准容器"的层级链（用于放大/缩小选择）
 *
 * chain[0] = 用户点击的精确元素本身
 * 之后依次是向上遇到的 ST 标准容器（气泡、聊天区…）
 *
 * @param {Element} el
 * @returns {Element[]} 从细到粗排列（chain[0] 最细）
 */
function getContainerChain(el) {
  const candidates = [];
  const seen = new Set();

  if (el && el.nodeType === Node.ELEMENT_NODE) {
    candidates.push(el);
    seen.add(el);
  }

  let current = el;
  while (current && current !== document.body) {
    if (current.nodeType !== Node.ELEMENT_NODE) {
      current = current.parentElement;
      continue;
    }
    if (isStandardSTContainer(current) && !seen.has(current)) {
      candidates.push(current);
      seen.add(current);
    }
    current = current.parentElement;
  }

  return candidates;
}

function isStandardSTContainer(el) {
  return STANDARD_SELECTORS.some((sel) => {
    try { return el.matches(sel); } catch (_) { return false; }
  });
}

/**
 * 在当前元素子树中找更细粒度的标准容器（"缩小选择"用）
 * @param {Element} el
 * @returns {Element[]}
 */
function findFinerContainers(el) {
  if (!el) return [];
  const result = [];
  const seen = new Set();
  for (const sel of STANDARD_SELECTORS) {
    let matches;
    try {
      matches = el.querySelectorAll(sel);
    } catch (_) { continue; }
    matches.forEach((m) => {
      if (!seen.has(m)) {
        result.push(m);
        seen.add(m);
      }
    });
  }
  return result;
}

function showHighlight(target) {
  if (!highlightEl) return;
  const rect = target.getBoundingClientRect();
  highlightEl.style.display = 'block';
  highlightEl.style.top = (rect.top + window.scrollY) + 'px';
  highlightEl.style.left = (rect.left + window.scrollX) + 'px';
  highlightEl.style.width = rect.width + 'px';
  highlightEl.style.height = rect.height + 'px';
}

function showToast(msg) {
  try {
    const ctx = SillyTavern.getContext();
    if (ctx.toastr) {
      ctx.toastr.info(msg, '点问');
      return;
    }
  } catch (_) {}
  console.log('[css-whisperer]', msg);
}

function isPicking() {
  return picking;
}

export {
  initPicker,
  enterPickMode,
  exitPickMode,
  isPicking,
  getContainerChain,
  findFinerContainers,
  showToast,
};
