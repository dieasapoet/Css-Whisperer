/**
 * 提问生成器 —— 把"点选 + 用户选择 + 分析结果"翻译成给 AI 的一段提问
 *
 * 设计原则（本插件的核心价值）：
 *   工具自己不产出样式（theme-tap 证明工具自产 CSS 不好看），
 *   只把"我想改这里"翻译成 AI 能精确听懂的提问，让 AI/懂行的人写好看的代码。
 *
 * 两种情形：
 *   A. analyzer 命中了相关规则 → 给三种做法（改数值 / 整段替换 / 追加覆盖）
 *   B. analyzer 没命中任何规则（作者没设计这里）→ 请 AI 从零生成新 CSS 加进 customCSS
 */

// "改什么"选项（一级）
const WHAT_OPTIONS = [
  { key: 'color', label: '颜色' },
  { key: 'size', label: '大小' },
  { key: 'position', label: '位置' },
  { key: 'custom', label: '自定义' },
];

// "怎么改"选项（二级，按一级 key 取）
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
  custom: [
    { key: 'custom', label: '自己描述' },
  ],
};

/**
 * 取某一级下的二级选项
 */
function getHowOptions(whatKey) {
  return HOW_OPTIONS[whatKey] || HOW_OPTIONS.custom;
}

/**
 * 把用户的一级/二级选择 + 自定义文本，组装成一句"我想…"的诉求
 */
function describeIntent(whatLabel, howLabel, customText) {
  if (customText && customText.trim()) {
    return customText.trim();
  }
  return `把它的【${whatLabel}】改得【${howLabel}】`;
}

/**
 * 生成给 AI 的提问文字
 * @param {Object} p
 * @param {string} p.areaName - 区域名（如"消息气泡"）
 * @param {string} p.whatLabel - "改什么"的中文（如"颜色"）
 * @param {string} p.howLabel - "怎么改"的中文（如"更透明"）
 * @param {string} p.customText - 用户自定义补充（可空）
 * @param {Object} p.analysis - analyzer.analyze 的返回
 * @returns {string}
 */
function buildPrompt(p) {
  const { areaName, whatLabel, howLabel, customText, analysis } = p;
  const intent = describeIntent(whatLabel, howLabel, customText);
  const hasRules = analysis && analysis.matchedRules && analysis.matchedRules.length > 0;

  const lines = [];
  lines.push('我在改一个 SillyTavern 的美化主题。');
  lines.push(`我想给【${areaName}】做这个调整：${intent}。`);
  lines.push('');

  if (hasRules) {
    // 情形 A：作者写了这里
    lines.push('影响这个位置的 CSS 代码是：');
    lines.push('```css');
    analysis.matchedRules.slice(0, 8).forEach((r) => {
      lines.push(`/* 来自：${r.source} */`);
      lines.push(r.cssText);
    });
    if (analysis.variables && analysis.variables.length) {
      lines.push('');
      lines.push('/* 相关 CSS 变量的当前值： */');
      analysis.variables.slice(0, 12).forEach((v) => {
        const fb = v.fallback ? `（默认值 ${v.fallback}）` : '';
        lines.push(`${v.name}: ${v.value};${fb}`);
      });
    }
    lines.push('```');
    if (analysis.partialUnreadable) {
      lines.push('（注：部分外部样式表读不到，以上可能不完整。）');
    }
    lines.push('');
    lines.push('请给我三种做法，让我照着做：');
    lines.push('① 教我改哪个数值——告诉我在上面哪一行、改成多少；');
    lines.push('② 找到那段 → 整段替换：把要替换的原代码和新代码都完整给我；');
    lines.push('③ 如果上面的规则不好直接改，给我一段可以加进「自定义CSS」的覆盖代码。');
  } else {
    // 情形 B：作者没设计这里，从零生成
    lines.push('但当前主题好像没有专门针对这里的样式，需要从零加。');
    lines.push('这个元素的定位信息是：');
    lines.push('```');
    lines.push(elementLocatorText(analysis, p.locator));
    lines.push('```');
    if (analysis && analysis.partialUnreadable) {
      lines.push('（注：部分外部样式表读不到，可能有我没找到的规则。）');
    }
    lines.push('');
    lines.push('请直接给我一段全新的 CSS，让我加进 SillyTavern 的「自定义CSS」框里就能生效，');
    lines.push('并告诉我：把这段代码粘到「用户设置 → 自定义CSS」里保存即可。');
  }

  return lines.join('\n');
}

/**
 * 情形 B 用的元素定位描述（不依赖作者规则，只用结构 + computed）
 */
function elementLocatorText(analysis, locator) {
  const out = [];
  if (locator) {
    if (locator.tag) out.push(`标签：${locator.tag}`);
    if (locator.standardSelector) out.push(`ST标准选择器：${locator.standardSelector}`);
    if (locator.id) out.push(`id：#${locator.id}`);
    if (locator.classes && locator.classes.length) out.push(`class：.${locator.classes.join(' .')}`);
  }
  if (analysis && analysis.computed) {
    out.push('当前实际样式（渲染后）：');
    Object.entries(analysis.computed).forEach(([k, v]) => {
      out.push(`  ${k}: ${v};`);
    });
  }
  return out.join('\n') || '（无法获取定位信息）';
}

export { WHAT_OPTIONS, getHowOptions, buildPrompt };
