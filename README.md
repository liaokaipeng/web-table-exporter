# HTML2XLSX 表格导出

Chrome/Edge 扩展（Manifest V3，原生 JS，零构建）：悬浮选择网页表格，一键导出为 xlsx。

支持：合并单元格（rowspan/colspan）、多表格多 Sheet、自定义文件名、虚拟滚动表格全量采集、表单控件值（input/select）导出、单元格多段文本以空格连接、导出前列拆分（控件值/换行/分隔符三种模式）、导出列筛选（含拆分新列逐列勾选）、拆分规则与列筛选按页面记忆（重进自动恢复）。

## 安装

1. 打开 `chrome://extensions` → 开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本项目的 `extension/` 目录
3. （可选）如需在本地 HTML 文件上使用：扩展详情 → 打开「允许访问文件网址」

## 使用

1. 打开含表格的页面，点击扩展图标进入选择模式（再次点击图标或按 `Esc` 退出）
2. 鼠标悬浮表格出现蓝色高亮；点击选中/取消（可多选，绿色覆盖层 + 序号徽标）
3. （可选）点「列设置」配置：**列筛选**（逐列勾选是否导出，拆分出的各新列同样可单独筛掉，默认全选）+ **列拆分**：控件值拆分（如「一口价」input 值与 PHP 文本分列）/ 按换行拆分（如「标题/产品ID」双行格 → 标题列 + ID 列）/ 分隔符拆分；智能预填 + 前 3 行实时预览（划线列为不导出），原列保留。保存后按页面记住（本地存储），下次再进同页面选同表自动恢复；表头变更则回落默认
4. 工具栏中修改文件名（预填为 页面标题_时间戳）
5. 点击「导出 Excel」或按 `Enter`

虚拟滚动表格（如 ERP 列表）点击后会自动滚动采集全部行，工具栏实时显示进度，采完后还原滚动位置。

## 目录结构

```
├── extension/                  # 插件本体（chrome://extensions 加载此目录）
│   ├── manifest.json           # MV3 配置（activeTab / scripting / downloads / storage）
│   ├── background/service-worker.js  # 图标点击注入 + 后台下载
│   ├── content/                # 内容脚本（按依赖序注入，零构建无模块系统）
│   │   ├── entry.js            #   注入守卫 + window.__h2x 命名空间
│   │   ├── util.js             #   工具函数
│   │   ├── controls.js         #   控件值三层判定（详见 docs/controls.md）
│   │   ├── split.js            #   列拆分 + 列筛选纯函数（测试整文件加载）
│   │   ├── cell.js             #   单元格四通道取值
│   │   ├── table.js            #   行获取 / 合并单元格展开 / Sheet 命名
│   │   ├── virtual.js          #   虚拟滚动表格采集
│   │   ├── persist.js          #   拆分规则与列筛选持久化（chrome.storage）
│   │   ├── panel.js            #   列设置面板（列筛选 + 拆分配置）
│   │   └── main.js             #   主 UI / 事件 / 导出
│   ├── lib/xlsx.full.min.js    # SheetJS 0.20.3（Apache-2.0）
│   └── icons/icon128.png
├── test/                       # 测试材料（不随插件分发）
│   ├── algo-check.cjs          # 采集算法 + 列拆分/列筛选/持久化回归测试（Node 直接运行）
│   ├── fixture.html            # 基础测试页（合并单元格/多表/控件取值/列拆分/列筛选）
│   └── virtual-fixture.html    # 虚拟滚动测试页（60 行，含 input 列/列拆分回归）
└── docs/                       # 文档（架构 / 产品 / 控件规则 / 持久化设计 / 归档规划）
```

## 开发与测试

```powershell
# 语法检查（内容脚本 10 文件 + 后台脚本）
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js

# 回归测试（采集算法 + 列拆分/列筛选 + 持久化纯函数）
node test/algo-check.cjs

# 启动本地静态服务后访问 http://localhost:3000/test/virtual-fixture.html
npx -y serve .
```

修改代码后：`chrome://extensions` 刷新扩展 → 刷新目标页面。

## 文档

- [架构文档](docs/architecture.md)：模块划分、数据流、关键设计决策
- [产品文档](docs/product.md)：功能清单、交互规范、已知限制
- [控件值规则](docs/controls.md)：三层判定与覆盖矩阵
- [持久化设计](docs/persist-plan.md)：拆分规则与列筛选的存储结构、定位键与降级策略
- [测试与回归](test/README.md)：测试页覆盖矩阵、命令、浏览器回归步骤
- [列拆分规划（已实施归档）](docs/archive/column-split-plan.md)：列拆分的模式、规则模型与边界情况
