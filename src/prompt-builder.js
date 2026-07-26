/**
 * 提问生成器 —— 把"点选 + 用户选择 + 分析结果"翻译成给 AI 的一段提问
 *
 * 设计原则（本插件的核心价值）：
 *   工具自己不产出样式（theme-tap 证明工具自产 CSS 不好看），
 *   只把"我想改这里"翻译成 AI 能精确听懂的提问，让 AI/懂行的人写好看的代码。
 *   相比"截图发给 AI"，本工具的不可替代之处在于给出精确选择器、原规则、变量、伪元素。
 *
 * 提问结构（v0.8.0：分区块带标题，LLM 解析更稳）：
 *   开头声明 AI 角色 → ## 要改的位置 → ## 我想改的部位和效果 → ## 现在影响这里的 CSS → ## 请按这个格式回我
 *
 * 两种情形（由 analysis.authoredHere 判定，而非"有没有命中任何规则"）：
 *   A. 主题/自定义CSS 声明了这组属性 → 现状块给相关规则+变量；做法①②③都可用
 *   B. 作者没针对这里写样式 → 现状块给 computed 现状+定位；用做法③从零生成
 */

// ★ 三键契约（务必守住）：
//   WHAT_OPTIONS[].key（部位） == HOW_OPTIONS 的 key == analyzer.PROP_GROUPS 的 key，一一对应。
//   HOW_OPTIONS 每项的 props 是"给 AI 点名的细粒度属性"；
//   PROP_GROUPS[部位] = 该部位所有二级 props 的并集。改任一处必须同步另两处。

// "改什么"选项（一级：点中元素的视觉子部位，按小白使用频率排序）
const WHAT_OPTIONS = [
  { key: 'background', label: '背景', note: '这一块的底色、背景图、透明度' },
  { key: 'text', label: '文字', note: '字的大小、颜色、粗细、字体，以及显示的文案' },
  { key: 'border', label: '边框', note: '外面那圈边、描边，还有圆角' },
  { key: 'box', label: '尺寸和间距', note: '宽高、内部留白、跟周围的距离、位置' },
  { key: 'icon', label: '图标', note: '换图标、换成图片、图标颜色和大小' },
  { key: 'effect', label: '特效', note: '阴影、发光、毛玻璃模糊' },
  { key: 'custom', label: '自定义', note: '都不合适，自己一句话描述' },
];

// "怎么改"选项（二级）：每项 { key, label, props }，props 为该做法涉及的细粒度属性
// 均保留 custom 兜底（自己描述）。props 为空的选项（custom）在提问里不点名属性，只带用户描述。
const HOW_OPTIONS = {
  background: [
    { key: 'bg-color', label: '换背景颜色', props: ['background-color', 'background'] },
    { key: 'bg-image', label: '换背景图', props: ['background-image', 'background', 'background-size', 'background-position'] },
    { key: 'bg-transparent', label: '更透明/半透明', props: ['opacity', 'background-color', 'background'] },
    { key: 'bg-remove', label: '去掉背景', props: ['background', 'background-color', 'background-image'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  text: [
    { key: 'text-color', label: '改文字颜色', props: ['color', 'text-shadow'] },
    { key: 'text-bigger', label: '字变大', props: ['font-size'] },
    { key: 'text-smaller', label: '字变小', props: ['font-size'] },
    { key: 'text-bold', label: '加粗/变细', props: ['font-weight'] },
    { key: 'text-font', label: '换字型', props: ['font-family'] },
    { key: 'text-spacing', label: '行距/字间距', props: ['line-height', 'letter-spacing'] },
    { key: 'text-content', label: '改成别的字（改文案）', props: ['content'] },
    { key: 'text-global-font', label: '换整站字体', props: ['font-family'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  border: [
    { key: 'border-color', label: '边框颜色', props: ['border-color', 'border', 'outline-color'] },
    { key: 'border-width', label: '边框粗细（加/去边框）', props: ['border-width', 'border', 'border-style'] },
    { key: 'border-radius', label: '圆角（变圆/变方）', props: ['border-radius'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  box: [
    { key: 'box-width', label: '改宽度（变宽/变窄）', props: ['width', 'min-width', 'max-width'] },
    { key: 'box-height', label: '改高度（变高/变矮）', props: ['height', 'min-height', 'max-height'] },
    { key: 'box-padding', label: '内边距（内部留白）', props: ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
    { key: 'box-margin', label: '外边距（跟周围的距离）', props: ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
    { key: 'box-position', label: '移动位置/对齐', props: ['position', 'top', 'right', 'bottom', 'left', 'text-align', 'justify-content', 'align-items', 'gap'] },
    { key: 'box-scale', label: '整体变大/变小', props: ['width', 'height', 'transform', 'font-size'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  icon: [
    { key: 'icon-change', label: '换个图标', props: ['content', 'font-family', 'mask', '-webkit-mask'] },
    { key: 'icon-image', label: '换成图片', props: ['background-image', 'content', 'background-size', 'mask'] },
    { key: 'icon-color', label: '图标颜色', props: ['color', 'fill', 'stroke', 'background-color'] },
    { key: 'icon-size', label: '图标大小', props: ['font-size', 'width', 'height'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  effect: [
    { key: 'effect-shadow', label: '加/改阴影', props: ['box-shadow', 'text-shadow'] },
    { key: 'effect-glow', label: '发光效果', props: ['box-shadow', 'text-shadow', 'filter'] },
    { key: 'effect-blur', label: '毛玻璃/模糊', props: ['backdrop-filter', '-webkit-backdrop-filter', 'filter'] },
    { key: 'effect-remove', label: '去掉阴影/特效', props: ['box-shadow', 'text-shadow', 'filter', 'backdrop-filter'] },
    { key: 'custom', label: '自己描述', props: [] },
  ],
  custom: [
    { key: 'custom', label: '自己描述', props: [] },
  ],
};

function getHowOptions(whatKey) {
  return HOW_OPTIONS[whatKey] || HOW_OPTIONS.custom;
}

// 回查某个"部位+做法"涉及的细粒度属性（给提问点名用）。panel 不带 props，这里按 howKey 查回。
function getHowProps(whatKey, howKey) {
  const opts = HOW_OPTIONS[whatKey];
  if (!opts) return [];
  const found = opts.find((o) => o.key === howKey);
  return found && found.props ? found.props : [];
}

/**
 * 把 analyzer 的来源标签转成给 AI 看的清楚措辞。
 * 关键：analyzer 里 '你的自定义CSS' 指的就是用户自己 #customCSS 框里的内容，
 * 但直接写进注释读着像"别人给的"，故改成明确第一人称。
 */
function sourceLabel(source) {
  switch (source) {
    case '你的自定义CSS': return '我自己在「自定义CSS」框里写的';
    case '主题内联样式': return '当前主题自带的';
    case 'ST内置样式': return 'SillyTavern 内置的';
    default: return source || '某个样式表';
  }
}

// 开头：声明 AI 角色 + 说明以下内容是点选工具当场读的现状
function roleIntro(multi) {
  const lines = [];
  lines.push('你是 SillyTavern（俗称"酒馆"）前端主题美化的资深 CSS 专家，帮我这个新手改界面样式。');
  lines.push('下面的"精确选择器 / CSS 规则 / 变量 / 伪元素"都是一个点选工具当场从我的页面上读出来的现状，不是我手写的，可以直接当依据。');
  if (multi) lines.push('我想一次改好几个地方，请逐处回我。');
  return lines;
}

/**
 * 生成给 AI 的提问文字（单个区域）
 * @param {Object} p { areaName, areaAiName, intents:[{whatKey,whatLabel,howKey,howLabel}], customText?, analysis, locator }
 */
function buildPrompt(p) {
  const lines = [];
  lines.push(...roleIntro(false));
  lines.push('');
  lines.push(...regionBlock(p));
  lines.push(closingSection(p.intents || [], false));
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
  lines.push(...roleIntro(true));
  lines.push('');
  list.forEach((p, i) => {
    lines.push(`# 第 ${i + 1} 处`);
    lines.push(...regionBlock(p));
  });
  const allIntents = list.flatMap((p) => p.intents || []);
  lines.push(closingSection(allIntents, true));
  return lines.join('\n');
}

/**
 * 生成"单个区域"的分区块正文（## 要改的位置 / ## 我想改的部位和效果 / ## 现在影响这里的 CSS）
 * 不含开头角色声明、不含收尾"请按这个格式回我"（那两块由 build* 统一加，多区域只出一次）。
 * @returns {string[]}
 */
function regionBlock(p) {
  const { areaName, analysis } = p;
  const aiName = p.areaAiName && p.areaAiName !== areaName ? p.areaAiName : '';
  const areaLabel = aiName ? `${areaName}（${aiName}）` : areaName;
  const intents = p.intents && p.intents.length
    ? p.intents
    : [{ whatKey: 'custom', whatLabel: '样式', howKey: 'custom', howLabel: '（见下方描述）' }];
  const whatKeys = intents.map((it) => it.whatKey);
  const howKeys = intents.map((it) => it.howKey).filter(Boolean);
  const lines = [];

  // ── ## 要改的位置：中文名 + 精确身份 aiName + 只锁这一个的精确选择器
  lines.push('## 要改的位置');
  lines.push(`区域：${areaLabel}`);
  if (p.locator && p.locator.uniqueSelector) {
    lines.push(`只锁这一个的精确选择器：${p.locator.uniqueSelector}`);
  }
  lines.push('');

  // ── ## 我想改的部位和效果：每条点名涉及属性 + 按条件插特别提示
  lines.push('## 我想改的部位和效果');
  intents.forEach((it) => {
    const props = getHowProps(it.whatKey, it.howKey);
    const tail = props.length ? ` —— 涉及属性：${props.join(', ')}` : '';
    lines.push(`- 【${it.whatLabel}】${it.howLabel}${tail}`);
  });
  if (p.customText && p.customText.trim()) lines.push(`补充：${p.customText.trim()}`);

  // 特别提示（按二级/分析结果条件插入，避免噪音）
  const pickedGlobalFont = howKeys.includes('text-global-font');
  const pickedFontFamily = howKeys.includes('text-font');
  const pickedContent = howKeys.includes('text-content');
  const hasIcon = whatKeys.includes('icon');
  const iconHasPseudoContent = hasIcon && analysis && analysis.pseudo
    && analysis.pseudo.some((ps) => ps.styles && ps.styles.content);
  if (pickedGlobalFont) {
    lines.push('（我要换的是整个界面的字体。字体通常由全局 CSS 变量控制，请告诉我改哪个全局变量/设置能让全站生效。）');
  } else if (pickedFontFamily && analysis && analysis.fontIsGlobalVar) {
    lines.push('（注意：这里的字体看起来是全局变量控制的，改它可能波及整个界面。我只想改点中的这一处，请别动全局变量。）');
  }
  if (pickedContent || iconHasPseudoContent) {
    lines.push('（提示：界面上有些"文字/图标"其实是伪元素 content 画上去的，要改就得改 content 属性，而不是页面里的普通文本。）');
  }
  if (hasIcon) {
    lines.push('（图标这项：它可能是 Font Awesome 之类的图标字体（伪元素 content 里是图标编码），也可能是一张背景图，请根据下面的现状判断，告诉我怎么换成别的图标或图片。）');
  }
  lines.push('');

  // ── ## 现在影响这里的 CSS：情形 A 给相关规则+变量；情形 B 给 computed 现状+定位
  lines.push('## 现在影响这里的 CSS');
  if (analysis && analysis.authoredHere) {
    lines.push('（主题或我自己已经写过相关样式，下面是挑出来和这次调整相关的规则）');
    lines.push('```css');
    (analysis.relevantRules || []).slice(0, 6).forEach((r) => {
      lines.push(`/* 出处：${sourceLabel(r.source)} */`);
      lines.push(r.cssText);
    });
    if (analysis.pseudo && analysis.pseudo.length) {
      lines.push('');
      lines.push('/* 这个位置还用了伪元素画东西（尾巴/装饰/假文字/图标等）： */');
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
  } else {
    lines.push('（当前主题好像没有专门针对这里写样式，需要从零加。下面是这个元素的现状和定位）');
    lines.push('```');
    lines.push(elementLocatorText(analysis, p.locator));
    lines.push('```');
    if (analysis && analysis.partialUnreadable) lines.push('（注：部分外部样式表读不到，可能有我没找到的规则。）');
  }
  lines.push('');
  return lines;
}

/**
 * 收尾：## 请按这个格式回我 —— 三种做法 + 统一要求（说人话/搜索词/精确选择器/数值方向/代码块）
 * 数值方向说明只在"改数字"类调整时加（尺寸间距整块，或字变大/变小、行距字距、图标大小、整体缩放）。
 * @param {Array} allIntents 全部诉求（多区域时汇总）
 * @param {boolean} multi 是否多区域
 */
function closingSection(allIntents, multi) {
  const howKeys = (allIntents || []).map((it) => it.howKey).filter(Boolean);
  const whatKeys = (allIntents || []).map((it) => it.whatKey).filter(Boolean);
  const numericDir = whatKeys.includes('box')
    || howKeys.some((k) => ['text-bigger', 'text-smaller', 'text-spacing', 'icon-size', 'box-scale'].includes(k));

  const lines = [];
  lines.push('## 请按这个格式回我');
  lines.push('请针对上面每一处，用下面三种做法回我（哪种合适给哪种，也可以都给）：');
  lines.push('① 改数值：指出上面哪一行、把哪个数字或颜色改成什么；');
  lines.push('② 整段替换：把原来那段和替换后的完整代码都给我；');
  lines.push('③ 追加覆盖：给我一段能直接加进「自定义CSS」框的代码；如果某处现在没有相关样式，就用这种从零写。');
  if (multi) lines.push('（我上面列了好几处，请每一处分别给，各自用独立代码块并标明是第几处。）');
  lines.push('');
  lines.push('另外几个要求：');
  lines.push('- 回答尽量精简：直接给关键步骤和最终代码就好，别长篇大论、别展开讲原理，我看太长会累；');
  lines.push('- 用简单的大白话讲，别堆术语，我是新手；');
  if (numericDir) {
    lines.push('- 凡是要我改数字的，告诉我"改大是往哪边/变什么，改小是往哪边/变什么"，比如"这个数越大字越大""上边距越大越往下"；');
  }
  lines.push('- 我会在「自定义CSS」框里用搜索找要改的地方。请给我一小段独一无二的原文片段当搜索词（比如一整句 `background-color: var(--xxx)`），别只给类名——类名会搜到一大堆，我找不准。搜索词越短越好，但要能精确定位；');
  lines.push('- 重要：我只想改我点中的这一个地方，别动同类的其它元素。请用能精确锁定这一个的选择器（优先它自己的 id，或"某个祖先 id + 后代"的组合），不要用像 `.drawer-icon`、`.mes_button` 这种一改就改一整批的通用类；');
  lines.push('- 我加在「自定义CSS」的代码要能盖过主题原有样式才生效。如果原样式优先级高、我加了不起作用，请把选择器写得更具体（提高特异性），必要时给关键属性加 `!important` 确保生效；但别滥用 `!important`，能靠更具体的选择器解决就优先那样；');
  lines.push('- 最后把我要粘贴的完整代码单独放一个代码块，让我能一次性整段复制，不用自己拼。');
  return lines.join('\n');
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
