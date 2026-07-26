/**
 * 语义识别层
 *
 * 把选中的 DOM 节点映射为用户能懂的中文区域名（"消息气泡""头像"），
 * 并返回一个标准选择器（若命中 ST 官方结构）供 analyzer 运行时匹配规则用。
 *
 * 匹配策略（三层回退）：
 *   1. 标准类名/属性匹配（.mes / #chat / .avatar 等 ST 公开结构）
 *   2. 属性/角色推断（[role="log"] 等）
 *   3. 启发式 + 位置兜底
 *
 * 法律红线：class/selector 只在运行时用于识别与定位，不写入任何持久化存储。
 * 类名来源为 ST 部署目录 public/index.html（开源项目公开结构，非主题作者独创）。
 */

const STANDARD_MAPPING = [
  // ===== 消息内部细粒度（优先级最高，先匹配） =====
  { selector: '.mes_text', name: '消息文本', note: '角色/你说的话那段文字' },
  { selector: '.mes_reasoning', name: '思维链内容', note: 'AI思考过程（CoT）的文字' },
  { selector: '.mes_reasoning_details', name: '思维链折叠区', note: '可展开收起的思维链区块' },
  { selector: '.mes_reasoning_header', name: '思维链标题', note: '思维链上面那行小标题' },
  { selector: '.mes_block', name: '消息块', note: '一条消息的整块区域' },
  { selector: '.mesAvatarWrapper', name: '头像那块', note: '头像图片外面的框' },
  { selector: '.mes_buttons', name: '消息按钮组', note: '消息右下角那排小按钮' },
  { selector: '.mes_edit_buttons', name: '编辑按钮组', note: '编辑消息时的按钮' },
  { selector: '.name_text', name: '角色名', note: '消息上方的名字文字' },
  { selector: '.ch_name', name: '角色名容器', note: '名字外面那一行' },
  { selector: '.mes_timer', name: '时间戳', note: '消息旁边的时间' },
  { selector: '.mesIDDisplay', name: '消息序号', note: '消息的编号数字' },
  { selector: '.mes_media_wrapper', name: '媒体区', note: '消息里的图片/视频区' },
  { selector: '.mes_file_wrapper', name: '文件区', note: '消息里的附件文件' },
  { selector: '.mes_bias', name: '偏置区', note: '提示词偏置显示区' },
  { selector: '.swipe_left', name: '左切换', note: '切上一条回复的箭头' },
  { selector: '.swipe_right', name: '右切换', note: '切下一条回复的箭头' },

  // ===== 消息整体（粗粒度，放后面） =====
  { selector: '.mes', name: '消息气泡', note: '一整条消息的气泡' },
  { selector: '.last_mes', name: '最新消息', note: '最下面那条最新消息' },

  // ===== 头像 =====
  { selector: '.avatar', name: '头像图片', note: '圆的/方的头像图' },

  // ===== 聊天区容器 =====
  { selector: '#chat', name: '聊天区', note: '中间显示所有对话的大区域' },

  // ===== 输入区（细粒度按钮在前，容器在后） =====
  { selector: '#send_but', name: '发送按钮', note: '发消息的按钮' },
  { selector: '#mes_stop', name: '停止按钮', note: '停止AI回复的按钮' },
  { selector: '#options_button', name: '选项按钮', note: '打开更多选项的按钮' },
  { selector: '#extensionsMenuButton', name: '扩展按钮', note: '魔棒图标，打开扩展菜单' },
  { selector: '#send_textarea', name: '输入框', note: '你打字的地方' },
  { selector: '#send_form', name: '输入区', note: '底部整个输入栏' },

  // ===== 快速回复条 =====
  { selector: '.qr--button', name: '快速回复按钮', note: '预设的一键回复按钮' },
  { selector: '#qr--bar', name: '快速回复栏', note: '输入框上方那排快捷按钮' },

  // ===== 顶部栏图标 / 抽屉 =====
  // 注意：顶栏具体图标（预设/插头/世界书…）不在这里硬编码，改由 identifyTopbarIcon()
  // 读图标 title + 父级 .drawer id 精确识别（见下）。这里只留兜底与容器项。
  { selector: '#logo_block', name: '顶栏Logo区', note: '最顶上图标那一行' },
  { selector: '.drawer-content', name: '顶栏下拉面板', note: '点顶部图标后弹出来的那块' },

  // ===== 顶部栏 / 侧栏 =====
  { selector: '#top-bar', name: '顶部栏', note: '最上面那一条' },
  { selector: '#left-nav-panel', name: '左侧栏', note: '从左边滑出的面板' },
  { selector: '#right-nav-panel', name: '右侧栏', note: '角色管理那个面板' },
  { selector: '#nav-toggle', name: '侧栏开关', note: '展开/收起侧栏的按钮' },
  { selector: '#options', name: '选项菜单', note: '弹出的选项列表' },
  { selector: '#extensionsMenu', name: '扩展菜单', note: '魔棒里弹出的菜单' },

  // ===== 弹窗 / 世界书 / 预设 =====
  { selector: '#WorldInfo', name: '世界书面板', note: '世界书的大面板' },
  { selector: '#floatingPrompt', name: '作者注释面板', note: '作者注释设置面板' },
  { selector: '.popup', name: '弹窗', note: '中间弹出来的对话框' },

  // ===== 通用属性 =====
  { selector: '[role="log"]', name: '消息日志', note: '所有消息的列表区' },
  { selector: '[data-role="message"]', name: '消息', note: '一条消息' },
];

const STANDARD_SELECTORS = STANDARD_MAPPING.map((m) => m.selector);

/**
 * 顶栏抽屉按钮映射（key = 父级 .drawer 的 id，来自 ST public/index.html 公开结构）
 *   - name：给用户看的白话名（用户自己的叫法）
 *   - note：一句话解释
 *   - aiName：给 AI 提问用的精确名（英文 title / 功能名），不用小白话
 * title 兜底：ST 图标上都有 title（如 "AI Response Configuration"），
 * 即使将来 id 改了，只要 title 在也能认出——比只认 id 耐操。
 */
const TOPBAR_DRAWERS = {
  'ai-config-button':          { name: '预设', note: 'AI响应配置（采样参数/预设）', aiName: 'AI Response Configuration (preset/sampler settings) drawer' },
  'sys-settings-button':       { name: '插头', note: 'API连接（连接AI服务）', aiName: 'API Connections drawer' },
  'advanced-formatting-button':{ name: 'AI回复格式化', note: '就是"自动解析前缀修改"的地方', aiName: 'AI Response Formatting drawer' },
  'WI-SP-button':              { name: '世界书', note: '世界书 / 作者注释', aiName: 'World Info drawer' },
  'user-settings-button':      { name: '美化主题', note: '用户设置（主题/配色/字体，美化改这里）', aiName: 'User Settings (theme/UI customization) drawer' },
  'persona-management-button': { name: 'User人设', note: '用户设定管理（你的角色人设）', aiName: 'Persona Management drawer' },
  'rightNavHolder':            { name: '角色卡', note: '角色管理（角色卡列表）', aiName: 'Character Management panel' },
  'backgrounds-button':        { name: '背景图', note: '更换背景图片', aiName: 'Change Background Image drawer' },
  'extensions-settings-button':{ name: '扩展', note: '扩展设置', aiName: 'Extensions drawer' },
};

// title 兜底表（title → 白话）：id 变了但 title 还在时用。
// 中英双语都列（ST 会按界面语言给中文或英文 title），backgrounds 无 title 靠 id 命中。
const TOPBAR_TITLE_FALLBACK = {
  // 英文
  'AI Response Configuration': TOPBAR_DRAWERS['ai-config-button'],
  'API Connections':          TOPBAR_DRAWERS['sys-settings-button'],
  'AI Response Formatting':   TOPBAR_DRAWERS['advanced-formatting-button'],
  'World Info':               TOPBAR_DRAWERS['WI-SP-button'],
  'User Settings':            TOPBAR_DRAWERS['user-settings-button'],
  'Persona Management':       TOPBAR_DRAWERS['persona-management-button'],
  'Character Management':     TOPBAR_DRAWERS['rightNavHolder'],
  'Change Background Image':  TOPBAR_DRAWERS['backgrounds-button'],
  'Extensions':               TOPBAR_DRAWERS['extensions-settings-button'],
  // 中文（简体界面，ST 会带空格如"AI 响应配置"）
  'AI 响应配置':  TOPBAR_DRAWERS['ai-config-button'],
  'AI响应配置':   TOPBAR_DRAWERS['ai-config-button'],
  'API 连接':     TOPBAR_DRAWERS['sys-settings-button'],
  'API连接':      TOPBAR_DRAWERS['sys-settings-button'],
  'AI 回复格式化': TOPBAR_DRAWERS['advanced-formatting-button'],
  'AI回复格式化':  TOPBAR_DRAWERS['advanced-formatting-button'],
  '世界书':       TOPBAR_DRAWERS['WI-SP-button'],
  '用户设置':     TOPBAR_DRAWERS['user-settings-button'],
  '用户设定管理':  TOPBAR_DRAWERS['persona-management-button'],
  '角色管理':     TOPBAR_DRAWERS['rightNavHolder'],
  '扩展程序':     TOPBAR_DRAWERS['extensions-settings-button'],
  '扩展':         TOPBAR_DRAWERS['extensions-settings-button'],
};

/**
 * 识别顶栏抽屉按钮/图标：用户点的多是 .drawer-icon 本身，
 * 需向上找 .drawer 容器拿 id，或读图标自己的 title。
 * @returns {{name,note,aiName,standardSelector}|null} 不是顶栏按钮返回 null
 */
function identifyTopbarIcon(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  // 从点击点向上找 .drawer 容器（图标/toggle 都在它里面）
  let drawer = null;
  try { drawer = el.closest('.drawer'); } catch (_) {}
  // 也可能点的就是 .drawer-icon / .drawer-toggle
  const iconEl = (() => {
    try { return el.matches('.drawer-icon') ? el : (el.querySelector && el.querySelector('.drawer-icon')) || (drawer && drawer.querySelector('.drawer-icon')); }
    catch (_) { return null; }
  })();

  // 1. 按父级 .drawer 的 id 精确命中
  if (drawer && drawer.id && TOPBAR_DRAWERS[drawer.id]) {
    const m = TOPBAR_DRAWERS[drawer.id];
    return { name: m.name, note: m.note, aiName: m.aiName, standardSelector: '#' + drawer.id };
  }
  // 2. 按图标 title 兜底
  const title = iconEl && iconEl.getAttribute ? (iconEl.getAttribute('title') || '') : '';
  if (title && TOPBAR_TITLE_FALLBACK[title]) {
    const m = TOPBAR_TITLE_FALLBACK[title];
    const sel = drawer && drawer.id ? '#' + drawer.id : '.drawer-icon';
    return { name: m.name, note: m.note, aiName: m.aiName, standardSelector: sel };
  }
  // 3. 是顶栏图标但认不出具体功能 → 至少别再笼统叫"顶栏图标"误导
  if (iconEl && drawer) {
    const t = title ? `（${title}）` : '';
    return { name: '顶栏按钮' + t, note: '顶部的一个功能按钮', aiName: `topbar drawer button${title ? ' title="' + title + '"' : ''}`, standardSelector: drawer.id ? '#' + drawer.id : '.drawer-icon' };
  }
  return null;
}

/**
 * 识别元素的语义名称
 * @param {Element} el
 * @returns {{ name: string, confidence: 'high'|'medium'|'low', standardSelector: string|null }}
 */
function identify(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) {
    return { name: '未知区域', confidence: 'low', standardSelector: null };
  }

  // 策略 0：顶栏抽屉按钮优先（用户点的多是 .drawer-icon，需读 title/父级 id 才能认出
  // 具体是"预设/插头/世界书…"，否则会笼统落到 .drawer-icon 显示"顶栏图标"误导）
  const topbar = identifyTopbarIcon(el);
  if (topbar) return { ...topbar, confidence: 'high' };

  // 策略 1：标准类名/属性匹配
  for (const { selector, name, note } of STANDARD_MAPPING) {
    try {
      if (el.matches(selector)) {
        // aiName = ST 官方类/选择器，让 AI 知道这块的语义（比一长串 nth-of-type 路径好懂）
        return { name, note: note || '', aiName: selector, confidence: 'high', standardSelector: selector };
      }
    } catch (_) {}
  }

  // 策略 2：属性/角色推断
  const role = el.getAttribute('role');
  if (role === 'log') return { name: '消息日志', note: '所有消息的列表区', aiName: '[role="log"]', confidence: 'high', standardSelector: '[role="log"]' };
  if (role === 'textbox') return { name: '文本框', note: '输入文字的框', aiName: '[role="textbox"]', confidence: 'high', standardSelector: '[role="textbox"]' };

  // 策略 2.5：读元素自带的 title/aria-label/短文本 —— ST 很多按钮是带 title 的 <div>/<i>，
  //   以前一律落到"按钮/某按钮"，其实 title 里就写着功能名（如 title="Select/Create Characters"）
  const label = readElementLabel(el);
  const clickable = isClickable(el);
  if (label) {
    const kind = clickable || role === 'button' ? '按钮' : '元素';
    return { name: `${kind}：${label}`, note: clickable ? '一个可点的按钮/图标' : '', aiName: elementDescForAI(el), confidence: 'medium', standardSelector: null };
  }
  if (role === 'button' || clickable) {
    return { name: '按钮', note: '一个可点的按钮（没写名字）', aiName: elementDescForAI(el), confidence: 'low', standardSelector: null };
  }

  // 策略 3：启发式
  const heuristic = heuristicIdentify(el);
  if (heuristic) return { ...heuristic, aiName: elementDescForAI(el), standardSelector: null };

  // 兜底：位置命名
  return positionalName(el);
}

/**
 * 读元素自带的人话标签：title > aria-label > 短文本
 */
function readElementLabel(el) {
  if (!el || !el.getAttribute) return '';
  const title = (el.getAttribute('title') || '').trim();
  if (title) return title;
  const aria = (el.getAttribute('aria-label') || '').trim();
  if (aria) return aria;
  // 元素自身直接文本（不含子孙），短则当标签
  let own = '';
  try {
    own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  } catch (_) {}
  const text = own || (el.textContent || '').trim();
  if (text && text.length <= 12) return text;
  return '';
}

/**
 * 元素看起来是否可点（按钮/链接/图标/带 onclick）
 */
function isClickable(el) {
  try {
    return el.matches('button, a[href], [role="button"], [onclick], .menu_button, .interactable, [class*="button"], [class*="btn"], i.fa-solid, i.fa-regular, .fa-solid, .fa-regular');
  } catch (_) { return false; }
}

/**
 * 给 AI 看的元素精确描述（标签 + id + title + 首个业务 class），
 * 让 AI 即使在"认不出具体区域"时也拿得到定位线索。返回括号内的内容。
 */
function elementDescForAI(el) {
  const bits = [];
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag) bits.push('<' + tag + '>');
  if (el.id) bits.push('#' + el.id);
  const title = ((el.getAttribute && el.getAttribute('title')) || '').trim();
  if (title) bits.push(`title="${title}"`);
  try {
    for (const c of el.classList) { if (!c.startsWith('cssw-') && !c.startsWith('fa-')) { bits.push('.' + c); break; } }
  } catch (_) {}
  return bits.join(' ');
}

/**
 * 位置兜底命名：认不出时用屏幕位置 + 大小给个人话方位名
 */
function positionalName(el) {
  let rect;
  try {
    rect = el.getBoundingClientRect();
  } catch (_) {
    return { name: '某个区域', confidence: 'low', standardSelector: null };
  }

  const vw = window.innerWidth || 360;
  const vh = window.innerHeight || 640;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let where;
  if (cy < vh * 0.25) where = '顶部';
  else if (cy > vh * 0.75) where = '底部';
  else if (cx < vw * 0.33) where = '左侧';
  else if (cx > vw * 0.67) where = '右侧';
  else where = '中部';

  const isSmall = rect.width < 80 && rect.height < 80;
  const kind = isSmall ? '某按钮' : '某面板';

  return { name: where + kind, confidence: 'low', standardSelector: null };
}

/**
 * 启发式推断
 */
function heuristicIdentify(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'img') {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && Math.abs(rect.width - rect.height) < 5) {
      return { name: '图片/头像', confidence: 'medium' };
    }
    return { name: '图片', confidence: 'medium' };
  }

  const text = (el.textContent || '').trim();
  if (text.length > 20) {
    const computed = window.getComputedStyle(el);
    const parentComputed = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
    if (parentComputed && computed.backgroundColor !== parentComputed.backgroundColor) {
      return { name: '内容区块', confidence: 'medium' };
    }
    return { name: '文本区块', confidence: 'low' };
  }

  return null;
}

export { identify, STANDARD_MAPPING, STANDARD_SELECTORS };
