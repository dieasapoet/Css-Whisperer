/**
 * 元素现状读取器 —— 当场读，看完即焚
 *
 * v0.9.0 起职责收窄：不再"遍历 styleSheets 猜哪条规则相关"（读不全跨域、算不准简写/层叠，
 * 用户与我都不信任那套提取）。改为只做两件绝对可靠的事：
 *   1. computed —— 用 getComputedStyle 读一批常用属性的"渲染后当前值"（浏览器原生，100% 准）
 *   2. pseudo   —— 读 ::before/::after 的 content（主题常用伪元素画假文字/图标，这个仍要认）
 *
 * "现有 CSS 全文"改由用户 #customCSS 提供（prompt-builder 拼进提问），不再由本文件提取。
 *
 * ★ 法律红线：只在本函数运行期读当前元素的渲染现状，返回对象即用即弃；
 *   不写入任何存储、不 fetch/上传、不汇总建库。
 */

// 给 AI 看的一批常用属性（渲染后当前值）。固定清单，不猜"用户想改哪类"——全给，AI 自取。
const COMMON_PROPS = [
  // 盒子
  'width', 'height', 'padding', 'margin',
  // 背景
  'background-color', 'background-image',
  // 文字
  'color', 'font-size', 'font-family', 'font-weight', 'line-height', 'text-align',
  // 边框 / 圆角
  'border', 'border-radius',
  // 特效
  'box-shadow', 'text-shadow', 'opacity', 'filter', 'backdrop-filter',
  // 布局 / 定位
  'display', 'position',
];

/**
 * 读一个元素的现状
 * @param {Element} el
 * @returns {{ computed: Object, pseudo: Array<{pseudo:string, content:string}> }}
 */
function analyze(el) {
  const result = { computed: {}, pseudo: [] };
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return result;

  // 1. 关键 computed 摘要
  try {
    const cs = window.getComputedStyle(el);
    for (const prop of COMMON_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v.trim() && v.trim() !== 'none' && v.trim() !== 'normal') {
        result.computed[prop] = v.trim();
      }
    }
  } catch (_) {}

  // 2. 伪元素 content（主题常用 ::before/::after 画假文字/图标，用户点的是本体读不到，故单独读）
  for (const pseudo of ['::before', '::after']) {
    try {
      const ps = window.getComputedStyle(el, pseudo);
      const content = ps.getPropertyValue('content');
      if (content && content !== 'none' && content !== 'normal') {
        result.pseudo.push({ pseudo, content: content.trim() });
      }
    } catch (_) {}
  }

  return result;
}

export { analyze, COMMON_PROPS };
