# 点问 CSS Whisperer · 交接文档（HANDOVER）

> 最后更新：2026-07-26 ｜ 当前版本：v0.7.0 ｜ 状态：功能较完整，等用户真机验证 v0.7.0

## 一句话定位

一个 SillyTavern 扩展：**翻译助手**。用户在界面上点一下想改的地方，插件认出区域、当场读相关 CSS、生成"能直接发给 AI"的提问；用户把提问发给 AI 拿到代码，在内置编辑器里搜索、粘贴、保存进 `#customCSS`。工具自己不产出样式（theme-tap 证明工具自产 CSS 不好看），把"出好看代码"交给 AI，工具只做点选+翻译+编辑。

## 关键约束（红线，务必守住）

- **只读当前页面 CSS 用于分析、只写用户自己的 `#customCSS`**；绝不建库、不上传、不持久化存作者 CSS。
- 对标社区公认的"美化编辑脚本"范式（合法）。
- 是前三代失败项目（theme-weaver / theme-weaver-v2 / theme-tap）的重生版，换了产品定位。

## 目录与文件（源码 `F:\myproject\插件项目\css-whisperer`）

```
manifest.json      # display_name「点问 CSS Whisperer」，js/css 带 ?v= 版本号(改代码要 bump 才破缓存)
index.js           # APP_READY 初始化 + 魔棒菜单按钮
src/
  picker.js        # 点选/高亮/ESC/层级链(getContainerChain/findFinerContainers)；只拦click不拦pointerdown
  semantic.js      # 区域识别 STANDARD_MAPPING(名称+note白话注释)；identify()
  analyzer.js      # 当场读CSS：属性组过滤/变量/伪元素(追溯父级+::placeholder)/字体全局检测；看完即焚
  prompt-builder.js# 生成给AI的提问：单区域buildPrompt + 多区域buildMultiPrompt(购物车)；三种做法/情形AB/精确选择器/授权已删
  editor.js        # 读写 ST 原生 #customCSS（readNativeCSS/writeNativeCSS，jQuery触发input保存）
  editor-cm.js     # 🆕 CodeMirror(CDN 5.65.15)集成：createEditor()，语法高亮/搜索overlay/原生undo-redo
ui/
  panel.js         # 主面板：顶部纯图标工具栏(🎯点选/✏️编辑/🧺清单)+两态(圆球/面板)+chip多选+购物车+编辑器
  style.css        # 磨砂/Claude双皮肤，chip/工具栏/编辑器/高亮 样式
README.md LICENSE .gitignore
```

## 安装/运行

- 安装目录：`F:\myproject\插件项目\SillyTavern-release\SillyTavern-release\public\scripts\extensions\third-party\css-whisperer`
- 改完源码要 `cp` 同步到安装目录，且 **bump manifest 版本号**(如 v=0.7.0→0.7.1)否则浏览器缓存旧文件；**改 manifest 需重启 ST 进程**才重读。
- 启动 ST：浏览器工具 `preview_start`（launch.json 已配 `node start-st.js` 代理，规避中文路径），端口 8000。

## 已完成（v0.1.0 → v0.7.0，全部真机验证过，除 v0.7.0 待验）

- 点选→识别→分析→生成小白提问（三种做法/情形AB/伪元素/变量）
- 内置 CSS 编辑器：镜像 #customCSS、搜索、实时保存、撤回/重置
- 顶部纯图标工具栏、小圆球收起态可拖拽、选择模式让位+持续高亮
- chip 多选"改什么"+每项"怎么改"、购物车多区域合成大提问
- 图标/字体(全局或局部)选项、区域名白话注释、防抽屉收起(吞事件)
- **v0.7.0(待用户验)**：CodeMirror 替换自研编辑器(修抖动卡顿)、精确选择器(别改一整类)、撤回+重做、自定义输入框、手机端吞touch、搜索打字不跳转

## ⚠️ 已知局限 / 技术债（诚实盘点，用户要求主动上报）

1. **analyzer 靠正则抓 `var()` + 遍历 styleSheets**，不是真 AST 解析。复杂嵌套/calc()/@media 可能漏或不准。
   → **用户已确定：未来引入 PostCSS（真正解析 CSS AST，不靠正则）替换**。见"下一步"。
2. **CodeMirror 走 CDN**，首次使用需联网；断网/被墙/CSP 拦截会回退到简易 textarea（已做兜底）。若用户环境常连不上，考虑把 CM 打包进仓库。
3. **精确选择器/伪元素/图标改动**最终能否只改一个、AI 是否照做，依赖 AI 配合，非 100% 可控。
4. 搜索仍是子串匹配，无正则搜索。
5. 区域识别硬编码 ST 类名，ST 大版本升级类名变了需维护。

## 下一步（未做，按优先级）

1. **引入 PostCSS 重构 analyzer**（用户已拍板）：用 AST 精确解析命中规则、变量、优先级，替代现在的正则+遍历。这是最大的一块技术债。
2. **接入 API 直接改 CSS**（用户想做，可行/中等难度）：需第二套提示词(让AI输出可解析可写回的CSS)，且必须复用已做好的撤回/重置做安全垫；接入时提醒用户 API 用途合规。
3. CodeMirror 打包进仓库(若 CDN 不稳)。

## 验证方式

真机：装进 third-party、启 ST、魔棒菜单→点问。关键路径见 进度.md 的"验证清单"。
