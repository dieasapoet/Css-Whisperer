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
 * ★ 三键契约：key 与 prompt-builder 的 WHAT_OPTIONS、HOW_OPTIONS 一一对应。
 *   每个部位的属性数组 = 该部位所有二级选项 props 的并集（改一处必须同步另两处）。
 * 用于：① 过滤规则（只留声明了这些属性的）② 读 computed 摘要 ③ 判断 authoredHere
 */
const PROP_GROUPS = {
  // 背景：底色、背景图、透明度
  background: [
    'background', 'background-color', 'background-image',
    'background-size', 'background-position', 'opacity',
  ],
  // 文字：字号/字型/粗细/字色/行距字距 + 文案(content) + 阴影/对齐
  text: [
    'color', 'font-size', 'font-weight', 'font-family', 'font-style',
    'line-height', 'letter-spacing', 'content', 'text-shadow', 'text-align',
  ],
  // 边框：边/描边/圆角
  border: [
    'border', 'border-color', 'border-width', 'border-style',
    'border-radius', 'outline', 'outline-color',
  ],
  // 尺寸和间距：盒子宽高、内外边距、定位、整体缩放（含 font-size，供"整体变大/变小"）
  box: [
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'position', 'top', 'right', 'bottom', 'left',
    'display', 'flex', 'justify-content', 'align-items', 'gap',
    'text-align', 'transform', 'font-size',
  ],
  // 图标：换图标(多为伪元素 content)、换成图片、图标颜色和大小
  icon: [
    'content', 'color', 'fill', 'stroke',
    'background', 'background-image', 'background-color', 'background-size',
    'mask', '-webkit-mask', 'font-size', 'font-family', 'width', 'height',
  ],
  // 特效：阴影、发光、毛玻璃模糊
  effect: [
    'box-shadow', 'text-shadow', 'filter',
    'backdrop-filter', '-webkit-backdrop-filter',
  ],
  // 自定义/兜底：不过滤，给一组常见的
  custom: [
    'content', 'color', 'background', 'background-color', 'background-image',
    'font-size', 'font-family', 'font-weight', 'border', 'border-radius',
    'padding', 'margin', 'width', 'height', 'box-shadow', 'opacity', 'filter',
  ],
};

function getPropGroup(whatKey) {
  // 支持传入单个 key 或 key 数组（多选时取属性组并集）
  if (Array.isArray(whatKey)) {
    const set = new Set();
    whatKey.forEach((k) => (PROP_GROUPS[k] || PROP_GROUPS.custom).forEach((p) => set.add(p)));
    return set.size ? Array.from(set) : PROP_GROUPS.custom;
  }
  return PROP_GROUPS[whatKey] || PROP_GROUPS.custom;
}

/**
 * 分析一个元素
 * @param {Element} el
 * @param {string|string[]} whatKey - 用户想改的部位 key（background/text/border/box/icon/effect/custom），可传数组多选取并集
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
    fontIsGlobalVar: false, // 字体是否由全局 CSS 变量控制（改它会影响全站）
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

  // 字体全局检测：font-family 若解析到 var(--xxx)，且该变量定义在 :root，
  // 说明字体是全局变量控制的，改它会影响整个界面。（在"文字"部位下检测；
  // 是否向用户发全局警告由 prompt-builder 按二级选项 text-font/text-global-font 决定）
  const wantsFont = whatKey === 'text'
    || (Array.isArray(whatKey) && whatKey.includes('text'));
  if (wantsFont && computed) {
    try {
      // 从命中规则的 cssText 里看 font-family 是否写成 var(...)
      // 这里先粗判：若 :root 上定义了任意 --*font* 变量且元素字体等于它，视为全局
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bodyFont = window.getComputedStyle(document.body).getPropertyValue('font-family').trim();
      const elFont = computed.getPropertyValue('font-family').trim();
      // 元素字体和 body 一致 → 大概率继承自全局
      if (elFont && elFont === bodyFont) result.fontIsGlobalVar = true;
      // :root 上有字体变量也标记
      for (const name of ['--main-font', '--font-main', '--mainFontFamily', '--fontFamily']) {
        if (rootStyle.getPropertyValue(name).trim()) { result.fontIsGlobalVar = true; break; }
      }
    } catch (_) {}
  }

  // 2. 遍历样式表，收集命中该元素、且声明了目标属性的规则
  const varNames = new Set();
  collectRules(el, props, result, varNames);

  // 3. 排序：自定义CSS > 主题内联 > ST内置（让最可能"作者写的"排在前面）
  const sourceRank = { '你的自定义CSS': 0, '主题内联样式': 1, 'ST内置样式': 2, '样式表': 3 };
  result.relevantRules.sort((a, b) => (sourceRank[a.source] ?? 9) - (sourceRank[b.source] ?? 9));

  // authoredHere：有没有来自"自定义CSS/主题内联"的规则声明了目标属性；
  // 或者检测到伪元素画了内容（假文字/装饰）——那也是作者设计了这里，只是用伪元素。
  result.authoredHere = result.relevantRules.some(
    (r) => r.source === '你的自定义CSS' || r.source === '主题内联样式'
  );

  // 4. 伪元素分析
  //    - 读元素自身的 ::before/::after/::placeholder（气泡尾巴、装饰、占位文字）
  //    - 关键：向上追溯父级 1-2 层的 ::before/::after —— 很多主题在父/兄容器上用伪元素
  //      画假文字/装饰（如 #nonQRFormItems::after 盖住输入框占位文字），
  //      用户点的是子元素，不追溯就永远读不到。
  const pseudoTargets = [{ el, depth: 0 }];
  let parent = el.parentElement;
  for (let d = 1; d <= 2 && parent && parent !== document.body; d++) {
    pseudoTargets.push({ el: parent, depth: d });
    parent = parent.parentElement;
  }
  pseudoTargets.forEach(({ el: target, depth }) => {
    // ::placeholder 只对表单元素(input/textarea)有意义；父级容器一律不读它（纯噪音）
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const canPlaceholder = depth === 0 && (tag === 'input' || tag === 'textarea');
    const pseudos = canPlaceholder ? ['::before', '::after', '::placeholder'] : ['::before', '::after'];
    pseudos.forEach((pseudo) => {
      try {
        const ps = window.getComputedStyle(target, pseudo);
        const content = ps.getPropertyValue('content');
        const isPlaceholder = pseudo === '::placeholder';
        // ::before/::after 没 content 就没生成，跳过
        if (!isPlaceholder && (!content || content === 'none' || content === 'normal')) return;
        const styles = {};
        for (const prop of props.concat(['content'])) {
          const v = ps.getPropertyValue(prop);
          if (v && v.trim() && v !== 'normal' && v !== 'none' && v !== 'auto') {
            styles[prop] = v.trim();
          }
        }
        // ::placeholder 噪音过滤：只有当它真的可见（颜色不透明）时才保留，
        // 否则那是主题故意隐藏原生占位符的空壳（如 color:transparent），列出来只添乱。
        if (isPlaceholder) {
          const col = styles['color'] || '';
          const invisible = /rgba?\([^)]*,\s*0\s*\)/.test(col) || styles['opacity'] === '0';
          if (invisible || !styles['color']) return;
        }
        if (Object.keys(styles).length) {
          const label = depth === 0 ? pseudo : `父级(第${depth}层)${pseudo}`;
          const sel = depth === 0 ? pseudo : pseudoSelectorHint(target) + pseudo;
          result.pseudo.push({ pseudo: label, selectorHint: sel, styles });
        }
      } catch (_) {}
    });
  });

  // 伪元素若画了内容（假文字/装饰），也视为"作者设计了这里"
  if (result.pseudo.length) result.authoredHere = true;

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
 * 给父级元素一个简短选择器提示（#id 或 .首个class），供 AI 定位伪元素来自哪
 */
function pseudoSelectorHint(el) {
  if (!el) return '';
  if (el.id) return '#' + el.id;
  try {
    for (const c of el.classList) {
      if (!c.startsWith('cssw-')) return '.' + c;
    }
  } catch (_) {}
  return el.tagName ? el.tagName.toLowerCase() : '';
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
