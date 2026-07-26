/**
 * CSS 分析器 —— 当场读，看完即焚
 *
 * 输入：一个元素 + 用户想改的"属性组"（颜色/大小/位置…）
 * 输出：一个纯内存对象，供 prompt-builder 组装给 AI 的提问：
 *   - relevantRules：只保留"声明了用户关心属性"的规则，按来源排序（自定义CSS/主题优先）
 *   - allMatchedCount：命中该元素的规则总数（用于判断是否过滤掉了很多噪音）
 *   - pseudo：::before / ::after 的关键样式（若 content 不是 none，即作者用伪元素画了东西）
 *   - variables：相关规则里 var(--x) 的当前值 + fallback
 *   - computed：用户关心属性的当前计算值
 *   - authoredHere：主题/自定义CSS 层是否真的声明了这组属性（false → 作者没设计这里）
 *
 * ★ 法律红线（本文件存在的前提，务必守住）：
 *   - 只在本函数运行期间读取当前页面 CSSOM，用于分析用户此刻选中的这一个元素
 *   - 返回对象交给面板即用即弃；绝不写入任何持久化存储
 *   - 绝不 fetch/上传，绝不把任何主题 CSS 汇总、分类、建库
 *   - 对标社区公认的"美化编辑脚本"：只当分析器，不做知识蒸馏
 */

/**
 * "改什么"→ 相关 CSS 属性组
 * key 与 prompt-builder 的 WHAT_OPTIONS 对齐。
 * 用于：① 过滤规则（只留声明了这些属性的）② 读 computed 摘要 ③ 判断 authoredHere
 */
const PROP_GROUPS = {
  color: [
    'color', 'background', 'background-color', 'background-image',
    'border-color', 'fill', 'stroke', 'opacity', 'box-shadow', 'text-shadow',
  ],
  size: [
    'font-size', 'font-weight', 'line-height', 'width', 'height',
    'min-width', 'min-height', 'max-width', 'max-height',
    'border-radius', 'border-width', 'border',
  ],
  position: [
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'position', 'top', 'right', 'bottom', 'left',
    'display', 'flex', 'justify-content', 'align-items', 'gap', 'text-align',
  ],
  // 自定义/兜底：不过滤，给一组常见的
  custom: [
    'color', 'background', 'background-color', 'font-size', 'border-radius',
    'padding', 'margin', 'width', 'height', 'border', 'box-shadow', 'opacity',
  ],
};

function getPropGroup(whatKey) {
  return PROP_GROUPS[whatKey] || PROP_GROUPS.custom;
}

/**
 * 分析一个元素
 * @param {Element} el
 * @param {string} whatKey - 用户想改什么（color/size/position/custom）
 * @returns {Object}
 */
function analyze(el, whatKey) {
  const props = getPropGroup(whatKey);
  const result = {
    whatKey: whatKey || 'custom',
    relevantRules: [],   // 声明了目标属性的规则（已排序、去噪）
    allMatchedCount: 0,  // 命中元素的规则总数
    pseudo: [],          // 伪元素样式 [{ pseudo:'::before', styles:{...} }]
    variables: [],
    computed: {},
    authoredHere: false, // 主题/自定义CSS 是否声明了这组属性
    partialUnreadable: false,
  };
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return result;

  // 1. 关键 computed 摘要（只取用户关心的属性）
  let computed = null;
  try {
    computed = window.getComputedStyle(el);
    for (const prop of props) {
      const v = computed.getPropertyValue(prop);
      if (v && v.trim()) result.computed[prop] = v.trim();
    }
  } catch (_) {}

  // 2. 遍历样式表，收集命中该元素、且声明了目标属性的规则
  const varNames = new Set();
  collectRules(el, props, result, varNames);

  // 3. 排序：自定义CSS > 主题内联 > ST内置（让最可能"作者写的"排在前面）
  const sourceRank = { '你的自定义CSS': 0, '主题内联样式': 1, 'ST内置样式': 2, '样式表': 3 };
  result.relevantRules.sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9));

  // authoredHere：有没有来自"自定义CSS/主题内联"的规则声明了目标属性
  result.authoredHere = result.relevantRules.some(
    (r) => r.source === '你的自定义CSS' || r.source === '主题内联样式'
  );

  // 4. 伪元素分析（气泡尾巴、装饰线等——最痛场景）
  ['::before', '::after'].forEach((pseudo) => {
    try {
      const ps = window.getComputedStyle(el, pseudo);
      const content = ps.getPropertyValue('content');
      // content 为 none/normal/空 → 该伪元素没被生成，跳过
      if (!content || content === 'none' || content === 'normal') return;
      const styles = {};
      for (const prop of props.concat(['content'])) {
        const v = ps.getPropertyValue(prop);
        if (v && v.trim() && v !== 'normal' && v !== 'none' && v !== 'auto') {
          styles[prop] = v.trim();
        }
      }
      if (Object.keys(styles).length) {
        result.pseudo.push({ pseudo, styles });
      }
    } catch (_) {}
  });

  // 5. 解析变量当前值（在元素作用域下取）
  if (computed) {
    for (const raw of varNames) {
      const parsed = parseVarRef(raw);
      if (!parsed) continue;
      let value = '';
      try { value = computed.getPropertyValue(parsed.name).trim(); } catch (_) {}
      result.variables.push({ name: parsed.name, value: value || '(未取到)', fallback: parsed.fallback });
    }
  }

  return result;
}

/**
 * 遍历 document.styleSheets，收集命中 el 且声明了目标属性的规则
 */
function collectRules(el, props, result, varNames) {
  const sheets = document.styleSheets;
  for (let i = 0; i < sheets.length; i++) {
    let rules;
    try {
      rules = sheets[i].cssRules;  // 跨域抛 SecurityError
    } catch (_) {
      result.partialUnreadable = true;
      continue;
    }
    if (!rules) continue;
    walkRules(rules, el, props, result, varNames, sheetSource(sheets[i]));
  }
}

function walkRules(rules, el, props, result, varNames, source) {
  for (let j = 0; j < rules.length; j++) {
    const rule = rules[j];

    if (rule.selectorText) {
      if (elementMatchesSelector(el, rule.selectorText)) {
        result.allMatchedCount++;
        // 只保留：声明了目标属性 + 选择器对该元素有定位价值（排除 * / body 这类通配）
        if (ruleDeclaresAny(rule, props) && !isTooBroad(rule.selectorText)) {
          result.relevantRules.push({
            selectorText: rule.selectorText,
            cssText: rule.cssText,
            source,
          });
          extractVars(rule.cssText, varNames);
        }
      }
      continue;
    }

    if (rule.cssRules) {
      walkRules(rule.cssRules, el, props, result, varNames, source);
    }
  }
}

/**
 * 选择器是否"过于宽泛"——通配 * / 裸 html/body / body * 之类，
 * 对"用户点的这一个元素"没有定位价值，是噪音，排除。
 */
function isTooBroad(selectorText) {
  return selectorText.split(',').every((part) => {
    const s = part.trim().toLowerCase();
    return s === '*'
      || s === 'html' || s === 'body'
      || /^(html|body)\b[\s>]*\*?$/.test(s)   // body *, html > * 等
      || /(^|\s)\*(\s|$)/.test(s);            // 含裸通配符
  });
}

/**
 * 规则是否声明了目标属性组里的任意一个
 */
function ruleDeclaresAny(rule, props) {
  const style = rule.style;
  if (!style) return false;
  for (const p of props) {
    // getPropertyValue 对未声明的返回 ''，对声明了的返回值
    if (style.getPropertyValue(p)) return true;
  }
  return false;
}

/**
 * 判断元素是否匹配某条规则的选择器（可能含逗号分组、伪类、伪元素）
 * 剥掉伪元素再用 matches 测；伪元素本身的样式由第 4 步单独读
 */
function elementMatchesSelector(el, selectorText) {
  const parts = selectorText.split(',');
  for (let p of parts) {
    let sel = p.trim();
    if (!sel) continue;
    const cleaned = sel.replace(/::?(before|after|placeholder|first-line|first-letter|selection|marker)\b/gi, '');
    try {
      if (el.matches(cleaned || sel)) return true;
    } catch (_) {}
  }
  return false;
}

function extractVars(cssText, varNames) {
  const re = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = m[1];
    const fallback = m[2] ? m[2].trim() : '';
    varNames.add(fallback ? `${name}||${fallback}` : name);
  }
}

function parseVarRef(raw) {
  if (!raw) return null;
  const idx = raw.indexOf('||');
  if (idx >= 0) return { name: raw.slice(0, idx), fallback: raw.slice(idx + 2) || null };
  return { name: raw, fallback: null };
}

/**
 * 给样式表一个人话来源标签（不含作者信息，仅提示"来自哪层"）
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

export { analyze, getPropGroup, PROP_GROUPS };
