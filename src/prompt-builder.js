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
  custom: [
    { key: 'custom', label: '自己描述' },
  ],
};

function getHowOptions(whatKey) {
  return HOW_OPTIONS[whatKey] || HOW_OPTIONS.custom;
}

function describeIntent(whatLabel, howLabel, customText) {
  if (customText && customText.trim()) return customText.trim();
  return `把它的【${whatLabel}】改得【${howLabel}】`;
}

/**
 * 生成给 AI 的提问文字
 */
function buildPrompt(p) {
  const { areaName, whatLabel, howLabel, customText, analysis } = p;
  const intent = describeIntent(whatLabel, howLabel, customText);

  const lines = [];
  lines.push('我在改一个 SillyTavern 的美化主题。');
  lines.push(`我想给【${areaName}】做这个调整：${intent}。`);
  lines.push('');

  if (analysis && analysis.authoredHere) {
    // ===== 情形 A：作者/自定义CSS 写了这里 =====
    lines.push('影响这个位置的 CSS 代码是（已挑出和这次调整相关的规则）：');
    lines.push('```css');
    analysis.relevantRules.slice(0, 6).forEach((r) => {
      lines.push(`/* 来自：${r.source} */`);
      lines.push(r.cssText);
    });

    // 伪元素（气泡尾巴/装饰线等）
    if (analysis.pseudo && analysis.pseudo.length) {
      lines.push('');
      lines.push('/* 这个位置还用了伪元素画东西（尾巴/装饰/图标等），当前样式： */');
      analysis.pseudo.forEach((ps) => {
        lines.push(`/* ${ps.pseudo} */`);
        Object.entries(ps.styles).forEach(([k, v]) => lines.push(`  ${k}: ${v};`));
      });
    }

    // 相关变量
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
    // ===== 情形 B：作者没针对这里写样式，从零生成 =====
    lines.push('但当前主题好像没有专门针对这里的样式，需要从零加。');
    if (analysis && analysis.pseudo && analysis.pseudo.length) {
      lines.push('（注意：这个位置有伪元素，见下方。）');
    }
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

  // ===== 作者授权提醒（法律/道德，交给用户判断）=====
  lines.push('');
  lines.push('———');
  lines.push('温馨提示：以上 CSS 可能来自主题作者的作品。若作者声明「不允许二次修改」，');
  lines.push('请不要这样做；是否把这些代码发给 AI，请你自己确认后再操作。');

  return lines.join('\n');
}

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
    Object.entries(analysis.computed).forEach(([k, v]) => out.push(`  ${k}: ${v};`));
  }
  if (analysis && analysis.pseudo && analysis.pseudo.length) {
    analysis.pseudo.forEach((ps) => {
      out.push(`伪元素 ${ps.pseudo}：`);
      Object.entries(ps.styles).forEach(([k, v]) => out.push(`  ${k}: ${v};`));
    });
  }
  return out.join('\n') || '（无法获取定位信息）';
}

export { WHAT_OPTIONS, getHowOptions, buildPrompt };
