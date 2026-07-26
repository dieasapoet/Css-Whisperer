/**
 * CSS 编辑器 —— 轻量搜索 + 实时保存（对标社区"美化编辑脚本"的合法范式）
 *
 * 定位：这不是重造 IDE，只做三件事，帮用户把 AI 给的代码贴进去、搜到位置、存下来：
 *   1. 镜像 ST 原生 #customCSS —— 文本框内容 = ST 那个框的内容（同一份，不产生第二份 CSS）
 *   2. 搜索 —— 输入词，跳到第一个匹配处并选中，方便定位 AI 让你搜的片段
 *   3. 实时写回 —— 编辑即 $('#customCSS').val(v).trigger('input')，ST 原生持久化、刷新保留
 *
 * ★ 法律红线：只操作用户自己的 #customCSS（用户自己的设置），不碰作者主题文件、不建库、不上传。
 */

const NATIVE_ID = 'customCSS';  // ST 原生自定义CSS textarea 的 id

/**
 * 读取 ST 原生 #customCSS 当前内容
 */
function readNativeCSS() {
  const el = document.getElementById(NATIVE_ID);
  return el ? (el.value || '') : '';
}

/**
 * 写回 ST 原生 #customCSS 并触发 ST 保存（input 事件）
 * 用 jQuery 触发（ST 监听的是 jQuery 事件）；没有 jQuery 时退回原生事件。
 */
function writeNativeCSS(value) {
  const el = document.getElementById(NATIVE_ID);
  if (!el) return false;
  el.value = value;
  try {
    if (typeof $ !== 'undefined') {
      $(el).val(value).trigger('input');
      return true;
    }
  } catch (_) {}
  // 退回原生事件
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function nativeExists() {
  return !!document.getElementById(NATIVE_ID);
}

/**
 * 在文本框里搜索关键词：跳到第一个匹配处并选中高亮
 * @param {HTMLTextAreaElement} textarea
 * @param {string} keyword
 * @param {number} fromIndex - 从哪个位置往后找（支持"查找下一个"）
 * @returns {number} 匹配到的位置（-1 表示没找到）
 */
function searchInTextarea(textarea, keyword, fromIndex) {
  if (!textarea || !keyword) return -1;
  const text = textarea.value;
  let idx = text.indexOf(keyword, fromIndex || 0);
  // 到末尾没找到，从头再找一次（循环搜索）
  if (idx === -1 && fromIndex) idx = text.indexOf(keyword, 0);
  if (idx === -1) return -1;
  textarea.focus();
  textarea.setSelectionRange(idx, idx + keyword.length);
  // 让选中处滚动到可见：用 scroll 估算（textarea 没有直接 API）
  scrollToSelection(textarea, idx);
  return idx;
}

/**
 * 粗略把选中行滚动到可见位置
 */
function scrollToSelection(textarea, idx) {
  const before = textarea.value.slice(0, idx);
  const line = before.split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
  textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
}

export { readNativeCSS, writeNativeCSS, nativeExists, searchInTextarea };
