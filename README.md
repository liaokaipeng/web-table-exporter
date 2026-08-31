# Web Table Exporter

网页表格一键导出为 xlsx / csv / json / md / html 的 Chrome/Edge 扩展（Manifest V3，原生 JS，零构建）。悬浮选择、点击导出，无需复制粘贴。v2.3 前名为「HTML2XLSX 表格导出」。

## 核心亮点

- **虚拟滚动全量采集**：vxe-table、el-table-v2、AG Grid 等只渲染可见行的表格，点击后自动滚动采集全部数据并去重，无需手动翻页
- **主流组件适配**：Element Plus、AG Grid、MUI X DataGrid、Tabulator、Ant Design Vue 等组件表格直接识别；适配器注册表架构，新增组件只加适配器
- **表单控件取值**：单元格内的输入框、下拉框、开关等按当前值导出
- **列规则按页面记忆**：拆分/筛选/格式设置仅存本机，重进同页面自动恢复
- **隐私友好**：不收集任何数据，权限最小化（activeTab / scripting / downloads / storage）

## 使用

1. 点击扩展图标进入选择模式（再次点击图标或按 `Esc` 退出）
2. 鼠标悬浮高亮表格，点击选中（可多选）
3. （可选）「列设置」配置：
   - **拆分**：按控件值 / 换行 / 分隔符把一列拆成多列（智能预填 + 前 3 行实时预览）
   - **筛选**：逐列勾选导出，拆分新列同样可筛
   - **格式**：标记数字列，导出为数值可求和
4. 工具栏修改文件名、切换格式（默认 xlsx），点「导出」或按 `Enter`

虚拟滚动表格点击后自动滚动采集，工具栏实时显示进度，采完还原滚动位置。深色模式跟随系统。

**适用场景**：后台管理系统数据导出、电商订单表格整理、报表搬运、数据核对。

## 安装

1. 打开 `chrome://extensions` → 开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本项目的 `extension/` 目录
3. （可选）如需在本地 HTML 文件上使用：扩展详情 → 打开「允许访问文件网址」

## 目录结构

```
├── extension/                  # 插件本体（chrome://extensions 加载此目录）
│   ├── manifest.json           # MV3 配置（activeTab / scripting / downloads / storage）
│   ├── background/service-worker.js  # 图标点击注入 + 后台下载
│   ├── content/                # 内容脚本（按依赖序注入，零构建无模块系统）
│   │   ├── entry.js            #   注入守卫 + window.__h2x 命名空间
│   │   ├── util.js             #   工具函数
│   │   ├── controls.js         #   控件值三层判定（详见 docs/controls.md）
│   │   ├── split.js            #   列拆分 + 列筛选 + 列格式纯函数（测试整文件加载）
│   │   ├── cell.js             #   单元格四通道取值
│   │   ├── table.js            #   行获取 / 合并单元格展开 / 网格适配器注册表 / Sheet 命名
│   │   ├── virtual.js          #   虚拟滚动表格采集
│   │   ├── persist.js          #   拆分规则/列筛选/列格式持久化（chrome.storage）
│   │   ├── format.js           #   csv/json/md/html 导出格式序列化纯函数
│   │   ├── panel.js            #   列设置面板（列筛选 + 拆分配置 + 列格式）
│   │   └── main.js             #   主 UI / 事件 / 导出
│   ├── lib/xlsx.full.min.js    # SheetJS 0.20.3（Apache-2.0）
│   └── icons/                  # 图标 16/32/48/128（test/gen-icon.ps1 生成）
├── test/                       # 测试材料（不随插件分发）
│   ├── algo-check.cjs          # 采集算法 + 列拆分/列筛选/持久化回归测试（Node 直接运行）
│   ├── fixture.html            # 基础测试页（合并单元格/多表/控件取值/列拆分/列筛选）
│   └── virtual-fixture.html    # 虚拟滚动测试页（60 行，含 input 列/列拆分回归）
├── release/                    # Chrome Web Store 上架材料（商店文案/截图/打包脚本）
└── docs/                       # 文档（架构 / 产品 / 控件规则 / archive 归档方案）
```

## 开发与测试

```powershell
# 语法检查（内容脚本 11 文件 + 后台脚本）
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js

# 回归测试（采集算法 + 列拆分/列筛选 + 持久化 + 导出格式序列化纯函数）
node test/algo-check.cjs

# 一键回归（语法 + 算法 + 7 页 E2E 并行，约 4 秒）
test/run-all.ps1

# 启动本地静态服务后访问 http://localhost:3000/test/virtual-fixture.html
npx -y serve .
```

修改代码后：`chrome://extensions` 刷新扩展 → 刷新目标页面。

## 文档

- [架构文档](docs/architecture.md)：模块划分、数据流、关键设计决策
- [产品文档](docs/product.md)：功能清单、交互规范、已知限制
- [控件值规则](docs/controls.md)：三层判定与覆盖矩阵
- [测试与回归](test/README.md)：测试页覆盖矩阵、命令、浏览器回归步骤
- 历史方案（已实施归档，设计已并入架构/产品文档）：[列拆分](docs/archive/column-split-plan.md) · [持久化](docs/archive/persist-plan.md) · [UI/UX 优化](docs/archive/uiux-plan.md)
