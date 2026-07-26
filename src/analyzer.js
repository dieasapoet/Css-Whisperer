/**
 * CSS 分析器 —— 当场读，看完即焚
 *
 * 输入一个元素，输出一个纯内存对象，供 prompt-builder 组装给 AI 的提问：
 *   - 命中规则：遍历 document.styleSheets，收集选择器能匹配该元素的规则文本
 *   - 变量来源：命中规则里出现的 var(--x)，取其当前计算值 + fallback
 *   - 关键 computed：color/background/border/radius/padding/margin/font/尺寸
 *
 * ★ 法律红线（本文件的存在理由，务必守住）：
 *   - 只在本函数运行期间读取当前页面的 CSSOM，用于分析用户此刻选中的这一个元素
 *   - 返回的对象交给面板即用即弃；绝不写入 extension_settings / localStorage
 *   - 绝不 fetch/上传，绝不把任何主题 CSS 汇总、分类、建库
 *   - 对标社区公认的"美化编辑脚本"：只当编辑器/分析器，不做知识蒸馏
 */

// 我们关心的关键计算样式（给用户和 AI 看的摘要）
const KEY_COMPUTED_PROPS = [
  'color',
  'background-color',
  'background',
  'border',
  'border-radius',
  'padding',
  'margin',
  'font-size',
  'font-family',
  'font-weight',
  'width',
  'height',
  'box-shadow',
  'opacity',
];

/**
 * 分析一个元素
 * @param {Element} el
 * @returns {{
 *   matchedRules: Array<{ selectorText: string, cssText: string, source: string }>,
 *   variables: Array<{ name: string, value: string, fallback: string|null }>,
 *   computed: Object,
 *   partialUnreadable: boolean
 * }}
 */
function analyze(el) {
  const result = {
    matchedRules: [],
    variables: [],
    computed: {},
    partialUnreadable: false,  // 有跨域样式表读不到时置 true
  };
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return result;

  // 1. 关键 computed 摘要
  let computed = null;
  try {
    computed = window.getComputedStyle(el);
    for (const prop of KEY_COMPUTED_PROPS) {
      const v = computed.getPropertyValue(prop);
      if (v && v.trim()) result.computed[prop] = v.trim();
    }
  } catch (_) {}

  // 2. 遍历样式表，收集命中该元素的规则
  const varNames = new Set();
  collectMatchedRules(el, result, varNames);

  // 3. 解析变量当前值（在元素作用域下取，覆盖 :root / 父级主题类）
  if (computed) {
    for (const raw of varNames) {
      const parsed = parseVarRef(raw);  // { name, fallback }
      if (!parsed) continue;
      let value = '';
      try {
        value = computed.getPropertyValue(parsed.name).trim();
      } catch (_) {}
      result.variables.push({
        name: parsed.name,
        value: value || '(未取到)',
        fallback: parsed.fallback,
      });
    }
  }

  return result;
}

/**
 * 遍历 document.styleSheets，收集选择器命中 el 的规则
 * 跨域样式表读 cssRules 会抛异常，try/catch 跳过并标记 partialUnreadable
 */
function collectMatchedRules(el, result, varNames) {
  const sheets = document.styleSheets;
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    let rules;
    try {
      rules = sheet.cssRules;  // 跨域时抛 SecurityError
    } catch (_) {
      result.partialUnreadable = true;
      continue;
    }
    if (!rules) continue;
    const source = sheetSource(sheet);
    walkRules(rules, el, result, varNames, source);
  }
}

/**
 * 递归处理规则列表（支持 @media 内嵌规则）
 */
function walkRules(rules, el, result, varNames, source) {
  for (let j = 0; j < rules.length; j++) {
    const rule = rules[j];

    // 样式规则（有 selectorText）
    if (rule.selectorText) {
      if (elementMatchesSelector(el, rule.selectorText)) {
        result.matchedRules.push({
          selectorText: rule.selectorText,
          cssText: rule.cssText,
          source,
        });
        extractVars(rule.cssText, varNames);
      }
      continue;
    }

    // @media / @supports 等含子规则的分组
    if (rule.cssRules) {
      walkRules(rule.cssRules, el, result, varNames, source);
    }
  }
}

/**
 * 判断元素是否匹配某条规则的选择器（选择器可能含逗号分组、伪类）
 * 用 el.matches 逐段测试；伪元素/伪类可能抛错，忽略
 */
function elementMatchesSelector(el, selectorText) {
  const parts = selectorText.split(',');
  for (let p of parts) {
    let sel = p.trim();
    if (!sel) continue;
    // 去掉伪元素（::before 等）再测——它们让 matches 抛错但确实作用于该元素
    const cleaned = sel.replace(/::?(before|after|placeholder|first-line|first-letter|selection|marker)\b/gi, '');
    try {
      if (el.matches(cleaned || sel)) return true;
    } catch (_) {}
  }
  return false;
}

/**
 * 从 cssText 里抽取 var(--x) 变量引用（原样，含可能的 fallback）
 */
function extractVars(cssText, varNames) {
  const re = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    // 存原始片段，parseVarRef 再拆
    const name = m[1];
    const fallback = m[2] ? m[2].trim() : '';
    varNames.add(fallback ? `${name}||${fallback}` : name);
  }
}

/**
 * 把 extractVars 存的 "name||fallback" 或 "name" 拆回结构
 */
function parseVarRef(raw) {
  if (!raw) return null;
  const idx = raw.indexOf('||');
  if (idx >= 0) {
    return { name: raw.slice(0, idx), fallback: raw.slice(idx + 2) || null };
  }
  return { name: raw, fallback: null };
}

/**
 * 给样式表一个人话来源标签（不含具体作者信息，仅用于提示"来自哪层"）
 */
function sheetSource(sheet) {
  try {
    if (sheet.ownerNode) {
      const node = sheet.ownerNode;
      if (node.id === 'customCSS' || node.id === 'custom-style') return '你的自定义CSS';
      if (node.tagName === 'STYLE') return '主题内联样式';
      if (node.tagName === 'LINK') return 'ST内置样式';
    }
  } catch (_) {}
  return '样式表';
}

export { analyze, KEY_COMPUTED_PROPS };
