/**
 * 提问生成器 —— 把"点选的元素 + 用户一句话诉求 + 元素现状 + 用户自定义CSS全文"
 * 翻译成一段能直接发给 AI 的提问。
 *
 * v0.9.0 定位（重构）：工具不再"提取相关规则"（那套读不全、算不准，用户不信任）。
 *   改为：点选给出精确选择器 + 现状 → 提问里**直接拼进用户 #customCSS 全文** →
 *   AI 对着全文自己找那段独一无二的代码；全文里没有就从零写一条加进 custom_css。
 *   支柱是"点选精确定位到页面这个元素"（截图不精确、纯文字说不清）。
 *
 * ★ 法律红线：只读用户自己的 #customCSS 拼进提问（用户手动复制去问 AI），不碰作者主题文件、不上传。
 */

/**
 * 生成给 AI 的提问（单个元素）
 * @param {Object} p
 * @param {string}  p.areaName   区域中文名（semantic.identify）
 * @param {string}  p.areaAiName 给 AI 的精确身份（英文功能名/选择器），可空
 * @param {string}  p.selector   精确选择器（buildUniqueSelector）
 * @param {Object}  p.computed   元素现状 { prop: value }
 * @param {Array}   p.pseudo     伪元素 [{ pseudo, content }]
 * @param {string}  p.userText   用户一句话诉求
 * @param {string}  p.customCss  用户 #customCSS 全文（readNativeCSS）
 * @returns {string}
 */
function buildPrompt(p) {
  const {
    areaName = '', areaAiName = '', selector = '',
    computed = {}, pseudo = [], userText = '', customCss = '',
  } = p || {};

  const lines = [];

  // 开头：AI 角色 + 说明数据来源
  lines.push('你是 SillyTavern（俗称"酒馆"）前端主题美化的资深 CSS 专家，帮我这个新手改界面样式。');
  lines.push('下面的"精确选择器 / 元素现状 / 我的自定义CSS"都是一个点选工具当场从我的页面上读出来的，可以直接当依据。');
  lines.push('');

  // ## 要改的位置
  lines.push('## 要改的位置');
  const areaLabel = areaAiName && areaAiName !== areaName ? `${areaName}（${areaAiName}）` : areaName;
  if (areaLabel) lines.push(`区域：${areaLabel}`);
  if (selector) lines.push(`精确选择器（只锁这一个，别动同类的其它元素）：${selector}`);
  const compEntries = Object.entries(computed);
  if (compEntries.length) {
    lines.push('它现在的样子（渲染后的实际值）：');
    lines.push('```css');
    compEntries.forEach(([k, v]) => lines.push(`  ${k}: ${v};`));
    lines.push('```');
  }
  if (pseudo && pseudo.length) {
    lines.push('它还用了伪元素画东西（有些"文字/图标"其实是伪元素 content 画的，要改得改 content）：');
    pseudo.forEach((ps) => lines.push(`  ${ps.pseudo} content: ${ps.content}`));
  }
  lines.push('');

  // ## 我想怎么改
  lines.push('## 我想怎么改');
  lines.push(userText && userText.trim() ? userText.trim() : '（我会补充说明，请先看下面的现状和我的自定义CSS）');
  lines.push('');

  // ## 我当前的自定义CSS（全文拼入，用户一键复制整段即可发，无需自己拼）
  lines.push('## 我当前的「自定义CSS」全文');
  if (customCss && customCss.trim()) {
    lines.push('（这是我自己在 SillyTavern 自定义CSS框里的全部内容，请在里面找和上面选择器相关的规则来改；');
    lines.push('如果这里没有针对上面那个选择器的规则，说明我还没给它写过样式，请从零写一条新的加进来。）');
    lines.push('```css');
    lines.push(customCss.trim());
    lines.push('```');
  } else {
    lines.push('（我的自定义CSS现在是空的。请直接为上面那个选择器从零写一条新样式，让我加进自定义CSS框。）');
  }
  lines.push('');

  // ## 请这样回我
  lines.push('## 请这样回我');
  lines.push('- 回答尽量精简：直接给关键步骤和最终代码就好，别长篇大论、别展开讲原理，我是新手看太长会累；');
  lines.push('- 用简单的大白话讲，别堆术语；');
  lines.push('- 我会在「自定义CSS」框里用搜索找要改的地方。请给我一小段独一无二的原文片段当搜索词（比如一整句 `color: var(--xxx)`），别只给类名——类名会搜到一大堆我找不准；');
  lines.push('- 只改我点中的这一个（用上面那个精确选择器），别动同类的其它元素；');
  lines.push('- 我加的代码要能盖过主题原有样式才生效。如果加了不起作用，请把选择器写得更具体（提高特异性），必要时给关键属性加 `!important`；但别滥用 `!important`，能靠更具体的选择器解决就优先那样；');
  lines.push('- 最后把我要粘贴的完整代码单独放一个代码块，让我一次性整段复制。');
  lines.push('');
  lines.push('（补充：如果你还需要更全的上下文，比如主题的颜色变量，我可以另外把导出的主题 JSON 文件发给你。）');

  return lines.join('\n');
}

export { buildPrompt };
