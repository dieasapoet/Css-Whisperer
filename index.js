/**
 * 点问 CSS Whisperer — 扩展入口
 *
 * 定位：翻译助手，不是编辑器。
 *   用户点一下界面某处 → 认出区域 + 当场读这一处相关 CSS
 *   → 生成一段"能直接发给 AI"的提问文字 → 用户手动复制去问 AI。
 *   工具自己不改 CSS、不保存修改。
 *
 * 打开方式：魔棒菜单 #extensionsMenu 注入按钮，点击打开面板。
 *
 * 初始化时序（沿用 theme-tap 成熟做法，处理竞态）：
 *   - 优先用 APP_READY 事件初始化（ST 官方推荐时机）
 *   - APP_READY 已触发时用 setTimeout 兜底
 *   - getContext 不可用时每 200ms 重试，最多 50 次
 *
 * 法律红线：
 *   - 可当场读当前页面 CSS 规则用于分析（对标社区"美化编辑脚本"）
 *   - 绝不蒸馏建库、绝不上传、绝不持久化存作者 CSS（看完即焚）
 */
import { initPicker } from './src/picker.js';
import { initPanel, openPanel } from './ui/panel.js';

const WAND_BUTTON_ID = 'css_whisperer_wand';

let initialized = false;

function getCtx() {
  if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
    throw new Error('SillyTavern.getContext 不可用');
  }
  return SillyTavern.getContext();
}

/**
 * 初始化入口：优先 APP_READY，带兜底与重试
 */
function setupInit() {
  console.log('[css-whisperer] setupInit 开始注册初始化钩子');
  try {
    const ctx = getCtx();
    if (ctx.eventSource && ctx.eventTypes && ctx.eventTypes.APP_READY) {
      ctx.eventSource.once(ctx.eventTypes.APP_READY, () => {
        console.log('[css-whisperer] 收到 APP_READY，开始初始化');
        initOnce();
      });
      console.log('[css-whisperer] 已注册 APP_READY 监听');
      setTimeout(() => {
        if (!initialized) {
          console.warn('[css-whisperer] APP_READY 1.5 秒未触发，强制初始化');
          initOnce();
        }
      }, 1500);
    } else {
      console.warn('[css-whisperer] eventSource 不可用，立即初始化');
      initOnce();
    }
  } catch (e) {
    console.warn('[css-whisperer] getCtx 失败，延迟重试:', e.message);
    let retries = 0;
    const timer = setInterval(() => {
      retries++;
      try {
        const ctx = getCtx();
        clearInterval(timer);
        console.log('[css-whisperer] 第 ' + retries + ' 次重试成功，开始初始化');
        ctx.eventSource.once(ctx.eventTypes.APP_READY, initOnce);
        setTimeout(() => {
          if (!initialized) initOnce();
        }, 1500);
      } catch (_) {
        if (retries >= 50) {
          clearInterval(timer);
          console.error('[css-whisperer] 10 秒内 getContext 一直失败，放弃初始化');
        }
      }
    }, 200);
  }
}

async function initOnce() {
  if (initialized) return;
  initialized = true;
  console.log('[css-whisperer] === 开始初始化 ===');
  try {
    await init();
    console.log('[css-whisperer] === 初始化完成 ===');
  } catch (e) {
    console.error('[css-whisperer] === 初始化失败 ===', e);
    initialized = false;  // 允许重试
  }
}

async function init() {
  // 1. 初始化点选系统与面板（不挂业务 DOM，只准备内部状态）
  initPicker();
  initPanel();

  // 2. 注入魔棒菜单按钮（APP_READY 后 DOM 一定就绪）
  injectWandButton();
}

/**
 * 注入魔棒菜单按钮
 */
function injectWandButton() {
  if ($('#extensionsMenu').length === 0) {
    console.warn('[css-whisperer] #extensionsMenu 不存在，跳过魔棒按钮注入');
    return;
  }
  if ($('#' + WAND_BUTTON_ID).length) return;

  const button = $(
    '<div id="' + WAND_BUTTON_ID + '" class="list-group-item flex-container flexGap5">' +
    '  <div class="fa-solid fa-comment-dots extensionsMenuExtensionButton" title="点问 CSS Whisperer"></div>' +
    '  <span data-i18n="点问">点问</span>' +
    '</div>'
  );

  button.on('click', function () {
    openPanel();
  });

  $('#extensionsMenu').append(button);
  console.log('[css-whisperer] 魔棒按钮已注入');
}

// 启动
setupInit();
console.log('[css-whisperer] index.js 模块已加载');
