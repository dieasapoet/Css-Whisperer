/**
 * CodeMirror 集成 —— 成熟代码编辑器（替代自研 textarea，修抖动/卡顿）
 *
 * 学美化编辑脚本：CodeMirror 5.65.15，从 cdnjs 加载（公共开源库，非侵权）。
 *   - CSS 语法高亮、行号、原生流畅滚动
 *   - 原生 undo/redo（解决"误点撤回能反悔"）
 *   - 搜索用 overlay 高亮全部匹配 + getSearchCursor 逐个跳转，CM 原生渲染不抖不卡
 *
 * ★ 联网说明：首次使用需联网拉 CM（cdnjs）。加载失败时调用方应回退到普通 textarea。
 * ★ 法律红线：只编辑用户自己的 #customCSS；CM 是通用编辑器库，不涉及任何主题 CSS 的收集。
 */

const CM_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/';
let cmLoading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('加载失败: ' + src));
    document.head.appendChild(s);
  });
}
function loadCSS(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve;  // CSS 失败不致命
    document.head.appendChild(l);
  });
}

/**
 * 确保 CodeMirror 及所需 addon 已加载（只加载一次）
 * @returns {Promise<boolean>} 成功 true
 */
function ensureCodeMirror() {
  if (window.CodeMirror) return Promise.resolve(true);
  if (cmLoading) return cmLoading;
  cmLoading = (async () => {
    await loadCSS(CM_BASE + 'codemirror.min.css');
    await loadScript(CM_BASE + 'codemirror.min.js');
    // CSS 语法高亮
    await loadScript(CM_BASE + 'mode/css/css.min.js').catch(() => {});
    // 搜索相关 addon（overlay/searchcursor）
    await loadScript(CM_BASE + 'addon/search/searchcursor.min.js').catch(() => {});
    await loadScript(CM_BASE + 'addon/dialog/dialog.min.js').catch(() => {});
    return !!window.CodeMirror;
  })().catch(() => false);
  return cmLoading;
}

/**
 * 在给定容器里创建一个绑定到 #customCSS 的 CodeMirror 编辑器
 * @param {HTMLElement} host - 挂载容器
 * @param {string} initialValue
 * @param {(v:string)=>void} onChange - 内容变化回调（防抖写回由调用方做）
 * @returns {Promise<Object|null>} 一个封装对象，失败返回 null
 */
async function createEditor(host, initialValue, onChange) {
  const ok = await ensureCodeMirror();
  if (!ok || !window.CodeMirror) return null;

  const CodeMirror = window.CodeMirror;
  const cm = CodeMirror(host, {
    value: initialValue || '',
    mode: 'css',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    theme: 'default',
  });

  cm.on('change', () => { if (onChange) onChange(cm.getValue()); });

  // ---- 搜索高亮：overlay 匹配关键词 ----
  let overlay = null;
  let keyword = '';
  const applyOverlay = () => {
    if (overlay) { cm.removeOverlay(overlay); overlay = null; }
    if (!keyword) return;
    const kw = keyword;
    overlay = {
      token(stream) {
        if (stream.match(kw)) return 'cssw-cm-match';
        // 前进到下一个可能匹配处
        const idx = stream.string.indexOf(kw, stream.pos + 1);
        if (idx === -1) stream.skipToEnd(); else stream.pos = idx;
        return null;
      },
    };
    cm.addOverlay(overlay);
  };

  // 统计匹配数
  const countMatches = () => {
    if (!keyword) return 0;
    const text = cm.getValue();
    let n = 0, i = text.indexOf(keyword, 0);
    while (i !== -1) { n++; i = text.indexOf(keyword, i + keyword.length); }
    return n;
  };

  // 逐个跳转
  let searchCursor = null;
  const findNext = (reset) => {
    if (!keyword) return;
    if (reset || !searchCursor) {
      searchCursor = cm.getSearchCursor(keyword, reset ? { line: 0, ch: 0 } : cm.getCursor());
    }
    if (!searchCursor.findNext()) {
      searchCursor = cm.getSearchCursor(keyword, { line: 0, ch: 0 });
      if (!searchCursor.findNext()) return;
    }
    cm.setSelection(searchCursor.from(), searchCursor.to());
    cm.scrollIntoView({ from: searchCursor.from(), to: searchCursor.to() }, 60);
  };

  return {
    cm,
    getValue: () => cm.getValue(),
    setValue: (v) => cm.setValue(v),
    undo: () => cm.undo(),
    redo: () => cm.redo(),
    historySize: () => cm.historySize(),  // { undo, redo }
    setKeyword: (kw) => { keyword = kw || ''; applyOverlay(); },
    count: countMatches,
    findNext: () => findNext(false),
    refresh: () => cm.refresh(),
    focus: () => cm.focus(),
  };
}

export { ensureCodeMirror, createEditor, CM_BASE };
