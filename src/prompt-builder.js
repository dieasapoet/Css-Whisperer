/**
 * 提问生成器 —— 把"点选 + 用户选择 + 分析结果"翻译成给 AI 的一段提问
 *
 * 设计原则（本插件的核心价值）：
 *   工具自己不产出样式（theme-tap 证明工具自产 CSS 不好看），
 *   只把"我想改这里"翻译成 AI 能精确听懂的提问，让 AI/懂行的人写好看的代码。
 *   相比"截图发给 AI"，本工具的不可替代之处在于给出精确选择器、原规则、变量、伪元素。
 *
 * 两种情形（由 analysis.authoredHere 判定，而非"有没有命中任何规则"）：
 *   A. 主题/自定义CSS 声明了这组属性 → 给三种做法（改数值 / 整段替换 / 追加覆盖）
 *   B. 作者没针对这里写样式 → 请 AI 从零生成新 CSS 加进 customCSS
 */

// "改什么"选项（一级）——key 与 analyzer.PROP_GROUPS 对齐
const WHAT_OPTIONS = [
  { key: 'color', label: '颜色' },
  { key: 'size', label: '大小' },
  { key: 'position', label: '位置' },
  { key: 'text', label: '文字' },
  { key: 'font', label: '字体' },
  { key: 'icon', label: '图标/图案' },
  { key: 'custom', label: '自定义' },
];

// "怎么改"选项（二级）
const HOW_OPTIONS = {
  color: [
    { key: 'more-transparent', label: '更透明' },
    { key: 'change-color', label: '换个颜色' },
    { key: 'darker', label: '更深' },
    { key: 'lighter', label: '更浅' },
    { key: 'custom', label: '自己描述' },
  ],
  size: [
    { key: 'bigger', label: '变大' },
    { key: 'smaller', label: '变小' },
    { key: 'rounder', label: '圆角更大' },
    { key: 'custom', label: '自己描述' },
  ],
  position: [
    { key: 'move', label: '移动位置' },
    { key: 'center', label: '居中' },
    { key: 'spacing', label: '调整间距' },
    { key: 'custom', label: '自己描述' },
  ],
  text: [
    { key: 'change-text', label: '改成别的字' },
    { key: 'bigger-text', label: '字变大' },
    { key: 'text-color', label: '改字的颜色' },
    { key: 'custom', label: '自己描述' },
  ],
  // 字体：二级选项就是"改全局 / 只改这里"——复用现有选项行，不加新模块
  font: [
    { key: 'font-global', label: '换字体（全站）' },
    { key: 'font-local', label: '只换这里的字体' },
    { key: 'custom', label: '自己描述' },
  ],
  icon: [
    { key: 'change-icon', label: '换个图标' },
    { key: 'change-image', label: '换成图片' },
    { key: 'icon-color', label: '改图标颜色' },
    { key: 'custom', label: '自己描述' },
  ],
  custom: [
    { key: 'custom', label: '自己描述' },
  ],
};

function getHowOptions(whatKey) {
  return HOW_OPTIONS[whatKey] || HOW_OPTIONS.custom;
}

/**
 * 生成给 AI 的提问文字
 * @param {Object} p
 * @param {string} p.areaName
 * @param {Array<{whatKey,whatLabel,howKey,howLabel}>} p.intents - 用户勾选的多个诉求
 * @param {string} p.customText - 额外自由描述（可空）
 * @param {Object} p.analysis
 * @param {Object} p.locator
 */
function buildPrompt(p) {
  const lines = [];
  lines.push('我在改一个 SillyTavern 的美化主题。');
  lines.push(...regionBlock(p, false));
  lines.push(pushHint({ intents: p.intents }));
  return lines.join('\n');
}

/**
 * 购物车模式：一次生成多个区域的诉求
 * @param {Array} items - 每项 { areaName, intents, customText, analysis, locator }
 */
function buildMultiPrompt(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return buildPrompt(list[0]);

  const lines = [];
  lines.push('我在改一个 SillyTavern 的美化主题，想一次改好几个地方。');
  lines.push('');
  list.forEach((p, i) => {
    lines.push(`【第 ${i + 1} 处】`);
    lines.push(...regionBlock(p, true));
    lines.push('');
  });
  // 汇总所有诉求涉及的属性，决定收尾提示
  const allIntents = list.flatMap((p) => p.intents || []);
  lines.push(pushHint({ intents: allIntents }));
  return lines.join('\n');
}

/**
 * 生成"单个区域"的正文段落（不含总开头、不含收尾要求）
 * @param {Object} p
 * @param {boolean} multi - 是否处于多区域模式（措辞略不同）
 * @returns {string[]}
 */
function regionBlock(p, multi) {
  const { areaName, analysis } = p;
  const intents = p.intents && p.intents.length ? p.intents : [{ whatKey: 'custom', whatLabel: '样式', howLabel: '（见下方描述）' }];
  const whatKeys = intents.map((it) => it.whatKey);
  const lines = [];

  // 诉求
  if (intents.length === 1 && !p.customText) {
    lines.push(`${multi ? '' : '我想'}给【${areaName}】做这个调整：把它的【${intents[0].whatLabel}】改得【${intents[0].howLabel}】。`);
  } else {
    lines.push(`${multi ? '' : '我想'}给【${areaName}】做这几个调整：`);
    intents.forEach((it) => lines.push(`- ${it.whatLabel}：${it.howLabel}`));
    if (p.customText && p.customText.trim()) lines.push(`- 另外：${p.customText.trim()}`);
  }
  if (intents.length === 1 && p.customText && p.customText.trim()) {
    lines.push(`补充：${p.customText.trim()}`);
  }

  // 字体全局/局部说明
  if (whatKeys.includes('font')) {
    const fontIntent = intents.find((it) => it.whatKey === 'font');
    if (fontIntent && fontIntent.howKey === 'font-global') {
      lines.push('（字体这项我要换整个界面的。字体一般是全局变量控制的，请告诉我改哪个全局设置能全站生效。）');
    } else if (fontIntent && fontIntent.howKey === 'font-local') {
      lines.push('（字体这项我只想改这一处，别影响别处。）');
    } else if (analysis && analysis.fontIsGlobalVar) {
      lines.push('（注意：这里字体看起来是全局变量控制的，改它可能影响整个界面。请说明是改全局还是只改这一处。）');
    }
  }
  if (whatKeys.includes('icon')) {
    lines.push('（图标这项：它可能是伪元素 content 画的图标码或背景图，请告诉我怎么换成别的图标或图片。）');
  }
  lines.push('');

  if (analysis && analysis.authoredHere) {
    lines.push('影响这个位置的 CSS 代码是（已挑出和这次调整相关的规则）：');
    lines.push('```css');
    analysis.relevantRules.slice(0, 6).forEach((r) => {
      lines.push(`/* 来自：${r.source} */`);
      lines.push(r.cssText);
    });
    if (p.locator && p.locator.uniqueSelector) {
      lines.push('');
      lines.push(`/* 我点中的就这一个元素，精确选择器：${p.locator.uniqueSelector}`);
      lines.push('   如果上面规则用的是通用类（会影响一整批同类），改的时候请改成只针对上面这个精确选择器。 */');
    }
    if (analysis.pseudo && analysis.pseudo.length) {
      lines.push('');
      lines.push('/* 这个位置还用了伪元素画东西（尾巴/装饰/假文字等）。');
      lines.push('   注意：界面上有些"文字"其实是伪元素 content 画上去的，改它要改 content： */');
      analysis.pseudo.forEach((ps) => {
        const hint = ps.selectorHint ? ` 选择器约为 ${ps.selectorHint}` : '';
        lines.push(`/* ${ps.pseudo}${hint} */`);
        Object.entries(ps.styles).forEach(([k, v]) => lines.push(`  ${k}: ${v};`));
      });
    }
    if (analysis.variables && analysis.variables.length) {
      lines.push('');
      lines.push('/* 相关 CSS 变量的当前值： */');
      analysis.variables.slice(0, 12).forEach((v) => {
        const fb = v.fallback ? `（默认值 ${v.fallback}）` : '';
        lines.push(`${v.name}: ${v.value};${fb}`);
      });
    }
    lines.push('```');
    if (analysis.partialUnreadable) lines.push('（注：部分外部样式表读不到，以上可能不完整。）');
    lines.push('');
    lines.push('请给我三种做法：');
    lines.push('① 改数值：告诉我上面哪一行、把哪个数字改成多少；');
    lines.push('② 整段替换：把原来那段和替换后的完整代码都给我；');
    lines.push('③ 覆盖：给我一段能加进「自定义CSS」的代码。');
  } else {
    lines.push('但当前主题好像没有专门针对这里的样式，需要从零加。');
    if (analysis && analysis.pseudo && analysis.pseudo.length) lines.push('（注意：这个位置有伪元素，见下方。）');
    lines.push('这个元素的定位信息是：');
    lines.push('```');
    lines.push(elementLocatorText(analysis, p.locator));
    lines.push('```');
    if (analysis && analysis.partialUnreadable) lines.push('（注：部分外部样式表读不到，可能有我没找到的规则。）');
    lines.push('');
    lines.push('请给我一段全新的 CSS，加进 SillyTavern 的「自定义CSS」框里就能生效。');
  }
  return lines;
}

/**
 * 给 AI 的统一收尾要求：说人话、教数值方向、最终代码单独放一块方便一键复制。
 * 数值方向要求只在"大小/位置"类调整时加（改数值方向对小白最容易懵）。
 */
function pushHint(p) {
  const whatKeys = (p.intents && p.intents.length ? p.intents.map((it) => it.whatKey) : [p.whatKey]).filter(Boolean);
  const parts = [];
  parts.push('');
  parts.push('几个要求：');
  parts.push('- 用简单的大白话讲，别太长，别堆术语，我是新手；');
  if (whatKeys.includes('size') || whatKeys.includes('position')) {
    parts.push('- 凡是要我改数字的，告诉我「改大是往哪边/变什么，改小是往哪边/变什么」，比如“这个数字越大字越大”“上边距越大越往下”；');
  }
  parts.push('- 我会在「自定义CSS」框里用搜索找到要改的地方。请给我一小段独一无二的原文片段当搜索词（比如一整句 `background-color: var(--xxx)`），别只给类名——类名会搜到一大堆，我找不准。搜索词越短越好，但要能精确定位；');
  parts.push('- 重要：我只想改我点中的这一个地方，别动同类的其它元素。请用能精确锁定这一个的选择器（优先用它自己的 id，或"某个祖先 id + 后代"的组合），不要用像 `.drawer-icon`、`.mes_button` 这种一改就改一整批的通用类；');
  parts.push('- 最后把我要粘贴的完整代码单独放一个代码块，让我能一次性整段复制，不用自己拼。');
  return parts.join('\n');
}

function elementLocatorText(analysis, locator) {
  const out = [];
  if (locator) {
    if (locator.uniqueSelector) out.push(`精确选择器（就指这一个）：${locator.uniqueSelector}`);
    if (locator.tag) out.push(`标签：${locator.tag}`);
    if (locator.standardSelector) out.push(`ST标准选择器（注意：可能匹配多个同类）：${locator.standardSelector}`);
    if (locator.id) out.push(`id：#${locator.id}`);
    if (locator.classes && locator.classes.length) out.push(`class：.${locator.classes.join(' .')}`);
  }
  if (analysis && analysis.computed) {
    out.push('当前实际样式（渲染后）：');
    Object.entries(analysis.computed).forEach(([k, v]) => out.push(`  ${k}: ${v};`));
  }
  if (analysis && analysis.pseudo && analysis.pseudo.length) {
    analysis.pseudo.forEach((ps) => {
      const hint = ps.selectorHint ? `（${ps.selectorHint}）` : '';
      out.push(`伪元素 ${ps.pseudo}${hint}：`);
      Object.entries(ps.styles).forEach(([k, v]) => out.push(`  ${k}: ${v};`));
    });
  }
  return out.join('\n') || '（无法获取定位信息）';
}

export { WHAT_OPTIONS, getHowOptions, buildPrompt, buildMultiPrompt };
