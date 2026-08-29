# UI/UX 优化方案（v2.0，规划中）

现状：底部工具栏（提示文案 + 已选计数 + 文件名 + 格式下拉 + 三按钮）+ 列设置模态面板（每行 7 控件 + 前 3 行预览）；全部状态反馈挤在工具栏 hint 一行。
目标：修复交互缺陷、建立 toast 反馈系统、重构面板信息结构、收敛视觉设计；算法层（split/format/persist/table 纯函数）零改动。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 实施范围 | P0–P3 全量，**统一为 v2.0 一个版本发布**（内部按 P0→P1→P2→P3 顺序实施，逐层回归后再合入）；主版本号升级 = 交互模型变更（导出后保留选择、采集可中止、面板重构），非渐进小改 |
| 导出成功行为 | **保留选择**：不再 0.6s 自动退出；toast 给「退出」动作，用户可换格式连续导出（行为变更，product.md 同步） |
| 模块结构 | 不新增内容脚本文件：toast 组件并入 main.js `<style>` + DOM，panel 经 `deps.toast()` 注入调用；service-worker 注入序与 algo-check 模块清单断言不动 |
| 权限 | 不变（activeTab + scripting + downloads + storage） |
| 深色模式 | 跟随系统 `prefers-color-scheme`，不做手动开关 |

## P0 交互缺陷修复

| # | 现状问题 | 设计 |
|---|---|---|
| 1 | 虚拟采集期间「取消」被禁用（main.js `startCollect`），长表只能 Esc 整体退出、丢失全部已选 | 采集中取消按钮保持可用，文案改「停止采集」；点击 = `genToken++` 使 `collectVirtual` 取消回调生效 → 当前任务作废（不写快照不选中）→ 恢复按钮与 hint「已停止采集」。中止后再点该表重新采集；Esc 语义不变（整体退出） |
| 2 | 导出 `exporting` 仅做重入保护，按钮不禁用不变样，期间点击被静默吞掉 | 导出中导出按钮禁用 + 文案「导出中…」；`updateBar()` 的 busy 条件加入 `exporting`；finally 恢复 |
| 3 | 工具栏 `white-space:nowrap` + 固定宽度文件名框，窄视口横向溢出无解 | 去掉 nowrap，`flex-wrap:wrap` + `max-width:96vw` 居中折行；文件名输入框弹性收窄（`max-width` 收紧），hint 与计数折到首行；**实施后细化**：列设置/导出/取消三按钮包进 `.h2x-actions` 成组（折行整组下移，不出现孤立按钮掉第二行），hint 改 ellipsis 截断（空间不足先省提示文案而非挤掉控件） |
| 4 | 页面无 `<table>` 时提示一直是「点击选择表格」，用户不知死在哪 | 进入选择模式后检测 `document.querySelectorAll('table').length === 0` → hint「页面未找到表格」；后续动态加载不主动监测（低频，接受） |
| 5 | 格式下拉显示 `xlsx` 而导出按钮显示 `Excel`，措辞不统一 | 下拉 option 改「Excel (.xlsx)」等人话标签（value 不变，E2E 安全） |

## P1 反馈系统

**Toast 组件**（main.js 内实现，同一 Shadow DOM）：

- 位置：视口右上角 fixed 栈，同屏最多 3 条，超出排队；pointer-events 仅 toast 自身
- 类型：`success`（2.5s 自动消失）/ `error`（常驻 + 关闭钮）/ `info`；进出动效 150ms（P3 补）；`role="status"` / `role="alert"`
- API：`toast(msg, {type, duration, actions})`，panel 经 `deps.toast()` 调用
- 职责划分：**hint 只留引导与进行时**（默认文案、采集进度实时行数、导出中）；**结果性通知全走 toast**

| # | 内容 | 设计 |
|---|---|---|
| 1 | 反馈迁移 | 保存成功、恢复提示、导出失败、采集失败、导出成功 → toast；错误常驻可关，替换现在「错误无关闭方式 + 多个 2.5s 定时器互相竞争」的状态 |
| 2 | 多文件进度 | CSV 多表逐文件下载循环中 toast 更新「正在下载 i/n」；完成改 success「已下载 N 个文件」 |
| 3 | 已配置指示 | `updateBar()` 统计已选表中存在拆分/筛选/格式记录的表数，「列设置」按钮显示徽标点；面板页签上同状态点（P2-3） |
| 4 | 导出保留选择 | `finish()` 不再 `setTimeout(exit, 600)`：success toast「已开始下载…」+「退出」动作；已选/快照/配置全保留，Esc / 取消 / toast「退出」三条退出路径；连续多次导出靠现有 `exporting` 重入保护 |

## P2 面板重构

| # | 现状问题 | 设计 |
|---|---|---|
| 1 | 每行 7 控件，未勾选拆分时模式/分隔符/上限是死噪音（仅降透明度） | 主行收敛为 4 元素：[导出✓][列名+徽标][格式下拉][「＋ 拆分」按钮]；点击展开该列配置子行 = 模式 + 分隔符 + 上限 + 新列导出勾选（并入现有 `.h2x-sub` 子行）；再点收起 = 取消拆分（与现有「拆分✓」勾选同语义）。智能预填建议显示在按钮 title；含 merges 表拆分按钮禁用 + title 说明 |
| 2 | 预览只显示勾选拆分的列（`renderPreview` 只遍历 actives），看不到最终完整列序 | 预览改为**最终输出结构**：未拆列 + 新列按最终顺序、最终列名（`splitColName`/`ctrlColNames`），新列绿色、不导出划线（样式语义复用）；行 = 前 3 行数据 + 尾注「共 N 行」；宽表横向滚动（overflow 已有）；数字格式预览即所得保持 |
| 3 | 多表切换用下拉，来回切且看不到各表配置状态 | 下拉改顶部页签（chip）：序号 + 表名截断 + 已配置状态点；超宽横向滚动；切换逻辑复用 `switchPanelTable` |
| 4 | 校验错误只在底部一行文字（「表格1：『标题』的分隔符不能为空」） | 错误就地化：对应输入框加 `.h2x-invalid` 红框 + 滚动到首个错误行；底部 err 区改汇总「N 项配置有误」；重新输入即清除该列错误态 |
| 5 | 无 focus trap、无 `role="dialog"`，Tab 可跑出面板 | 打开时聚焦首个控件；Tab/Shift+Tab 圈定面板内；mask/panel 加 `role="dialog" aria-modal`；Esc/Enter 语义不变 |

E2E 影响：`e2e-harness.js` 的 `rowOf/ckOf/modeOf/patOf/fmtOf` 等定位函数与 `.h2x-tsel` 切表、预览断言需随 DOM 结构同步（改动集中在少数定位函数）。

## P3 视觉系统

| # | 内容 | 设计 |
|---|---|---|
| 1 | Design tokens | `:host` 级 CSS 变量（工具栏与面板两处 `<style>` 同一 shadowRoot 共享）：主色/信息/危险/文字/边框/底色 8–10 个色 token + 字号 3 级 + 圆角 2 级 + 间距 4/8/12/16；替换现散落 ~30 处硬编码色值 |
| 2 | 动效 | 面板/mask 进出 150ms（scale .98→1 + opacity）；悬浮框位置过渡 80ms（rAF 高频更新下实测，跟手性劣化则降级为仅显隐过渡）；按钮 hover/active 态；toast 进出 150ms；`prefers-reduced-motion: reduce` 全部关闭 |
| 3 | 深色模式 | `@media (prefers-color-scheme: dark)` 覆写 token（面板/工具栏/toast 底 #1e1e1e 系、文字 #e0e0e0、主色提亮保对比）；悬浮/选中覆盖层语义色不变（叠加在页面上） |
| 4 | 细节 | 选中徽标 `-12px` 偏移在表格贴视口左/上边缘时翻到内侧（`positionBox` 按 rect 判断）；禁用态文字对比度提至 ≥3:1；`:focus-visible` outline（键盘可见焦点） |

## 改动清单

| 文件 | 改动 |
|---|---|
| `content/main.js` | P0 全部；toast 组件 + `deps.toast` 注入；导出保留选择；「列设置」徽标；P3 token 定义 + 深色 media + 工具栏样式重构 |
| `content/panel.js` | P2 全部（行折叠/全列预览/页签/就地错误/焦点管理）；P3 样式 token 化 + 进出动效 |
| `manifest.json` | 版本号 2.0（单次发布） |
| `test/e2e-harness.js`、`e2e-harness-virtual.js` | hint 断言 → toast 断言；P2 面板选择器与预览断言适配；新增用例（见下） |
| `docs/product.md` | 交互规范表（导出成功行、采集停止）、状态反馈文案表同步 |
| `docs/architecture.md` | main.js / panel.js 职责描述同步 |

`service-worker.js`、11 个内容脚本的文件清单与注入顺序：**零改动**。

## 验证方案

- `node --check` 11 个内容脚本（无新文件）；`node test/algo-check.cjs` 154 项不变（纯函数零改动；全列预览复用 `columnLayout`/`splitSegments` 现有纯函数）
- E2E 更新后全绿，新增用例：停止采集（中止后状态恢复、可重采）；导出保留选择（连续两次导出、toast 退出）；toast 出现/自动消失/错误常驻；面板折叠展开循环；全列预览列序断言；就地错误标红与清除；页签切换与状态点
- 浏览器手工回归（test/README 流程）+ 系统深色模式抽查 + `prefers-reduced-motion` 抽查

## 边界与降级

- 旧浏览器无 `prefers-color-scheme` → 亮色默认；无 `prefers-reduced-motion` → 动效默认开
- 悬浮框位置过渡导致跟手性下降 → 降级为仅显隐过渡（回退点，实测决定）
- 导出保留选择后：用户翻页再导出，普通表现跑 `extractTable` 取最新 DOM（现状语义），虚拟表用快照（现状语义）；已选表格 DOM 失联由现有 `onReposition → removeSelected` 兜底
- toast 与面板不叠加：保存成功提示在面板关闭后出现；窄屏 toast 右上角、面板居中，垂直错开
- E2E 轮次间等待 exit 的现有约束不受影响（exit 仍存在，只是导出不再自动触发）

## 不做

不引框架/构建；不做 popup/options 页；不做 iframe 内表格；不做手动主题开关；不做 i18n；不动权限与模块结构。

## 实施后记（v2.0 交付后用户反馈微调）

- 工具栏折行形态：三按钮成组（见 P0-3 细化），hint 截断收缩，消除「上排挤满、下排只剩一个按钮」的失衡换行
- 列设置面板宽度 780px → 900px（上限 95vw），预览单元格列宽上限 180px → 220px——长列名（如拆分新列「标题/产品ID_控件1」）显示更完整，配置区更舒展
- E2E 轮次 A 补「三按钮成组同父」断言防回归；全量回归 fixture 103 项 + virtual 32 项 PASS
