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
  { selector: '.mes_reasoning', name: '推理内容', note: 'AI思考过程的文字' },
  { selector: '.mes_reasoning_details', name: '推理折叠区', note: '可展开收起的思考区' },
  { selector: '.mes_reasoning_header', name: '推理标题', note: '思考区上面的小标题' },
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
  { selector: '#sys-settings-button', name: 'AI配置按钮', note: '设置AI参数的按钮' },
  { selector: '#ai-config-button', name: 'API连接按钮', note: '连接AI服务的按钮' },
  { selector: '#persona-management-button', name: '用户头像按钮', note: '管理你自己头像的按钮' },
  { selector: '#WI-SP-button', name: '世界书按钮', note: '打开世界书的按钮' },
  { selector: '#logo_block', name: '顶栏Logo区', note: '最顶上图标那一行' },
  { selector: '.drawer-icon', name: '顶栏图标', note: '顶部的小图标' },
  { selector: '.drawer-toggle', name: '顶栏抽屉开关', note: '点了会展开下拉的图标' },
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
 * 识别元素的语义名称
 * @param {Element} el
 * @returns {{ name: string, confidence: 'high'|'medium'|'low', standardSelector: string|null }}
 */
function identify(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) {
    return { name: '未知区域', confidence: 'low', standardSelector: null };
  }

  // 策略 1：标准类名/属性匹配
  for (const { selector, name, note } of STANDARD_MAPPING) {
    try {
      if (el.matches(selector)) {
        return { name, note: note || '', confidence: 'high', standardSelector: selector };
      }
    } catch (_) {}
  }

  // 策略 2：属性/角色推断
  const role = el.getAttribute('role');
  if (role === 'log') return { name: '消息日志', note: '所有消息的列表区', confidence: 'high', standardSelector: '[role="log"]' };
  if (role === 'textbox') return { name: '文本框', note: '输入文字的框', confidence: 'high', standardSelector: '[role="textbox"]' };
  if (role === 'button') return { name: '按钮', note: '一个可点的按钮', confidence: 'medium', standardSelector: null };

  // 策略 3：启发式
  const heuristic = heuristicIdentify(el);
  if (heuristic) return { ...heuristic, standardSelector: null };

  // 兜底：位置命名
  return positionalName(el);
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
