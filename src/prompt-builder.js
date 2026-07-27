/**
 * 提问生成器 —— 把"点选的元素 + 用户一句话诉求 + 元素现状 + 用户自定义CSS全文"
 * 翻译成一段能直接发给 AI 的提问。
 *
 * v0.9.6 极简重写：一句话角色 + 元素信息 + 要求 + CSS全文 + 三段式回我格式。
 * 不再写长篇"引导"，AI 不需要。
 */
function buildPrompt(p) {
  const {
    areaName = '', selector = '',
    computed = {}, pseudo = [], userText = '', customCss = '',
  } = p || {};

  const lines = [];

  // 角色(极简)
  lines.push('你是SillyTavern前端主题CSS专家。');
  lines.push('下面我把我要改的元素+我的自定义CSS全文都给你，帮我直接写出最终代码。');

  // 要改的元素
  lines.push('');
  lines.push('## 要改的元素');
  if (areaName) lines.push('区域：' + areaName);
  if (selector) lines.push('我只想改这一个元素，选择器：' + selector);
  const top4 = Object.entries(computed).slice(0, 4).map(([k, v]) => k + ':' + v);
  if (top4.length) lines.push('它现在的关键样式：' + top4.join('；'));
  if (pseudo && pseudo.length) {
    pseudo.forEach((ps) => {
      const where = ps.selectorHint ? ' (在' + ps.selectorHint + ')' : '';
      const word = (ps.content || '').replace(/"/g, '');
      lines.push('注意：界面上的 "' + word + '" 是伪元素' + ps.pseudo + where + '画的，改文案要改它的content');
    });
  }

  // 我的要求
  lines.push('');
  lines.push('## 我的要求');
  lines.push(userText && userText.trim() ? userText.trim() : '按下面代码改得更好看');

  // 我的自定义CSS 全文
  lines.push('');
  lines.push('## 我的自定义CSS全文');
  if (customCss && customCss.trim()) {
    lines.push('在下面的代码里找到对应的规则直接改；如果找不到，就新写一条选择器=' + (selector || '元素') + '的规则加进去：');
    lines.push('```css');
    lines.push(customCss.trim());
    lines.push('```');
  } else {
    lines.push('我的自定义CSS现在是空的，请为我从零生成一条');
  }

  // 回我格式(三段)
  lines.push('');
  lines.push('## 回我格式');
  lines.push('1. 最前面写一段精简大白话说明（不要讲CSS原理，讲具体怎么改）');
  lines.push('2. 给我一小段能在编辑器里搜到对应代码的文本（独一无二片段）');
  lines.push('3. 最终代码单独放一个```css代码块，只锁我上面那个选择器；优先级不够就加!important(但别滥用)');

  lines.push('');
  lines.push('如果你的回答太长我会跳过。尽量精简，只给相关内容。');

  return lines.join('\n');
}

export { buildPrompt };
