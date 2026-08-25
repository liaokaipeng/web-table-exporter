# HTML2XLSX 表格导出

Chrome/Edge 扩展（Manifest V3，原生 JS，零构建）：悬浮选择网页表格，一键导出为 xlsx。

支持：合并单元格（rowspan/colspan）、多表格多 Sheet、自定义文件名、虚拟滚动表格全量采集、表单控件值（input/select）导出、单元格多段文本以空格连接。

## 安装

1. 打开 `chrome://extensions` → 开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本项目目录
3. （可选）如需在本地 HTML 文件上使用：扩展详情 → 打开「允许访问文件网址」

## 使用

1. 打开含表格的页面，点击扩展图标进入选择模式（再次点击图标或按 `Esc` 退出）
2. 鼠标悬浮表格出现蓝色高亮；点击选中/取消（可多选，绿色覆盖层 + 序号徽标）
3. 工具栏中修改文件名（预填为 页面标题_时间戳）
4. 点击「导出 Excel」或按 `Enter`

虚拟滚动表格（如 ERP 列表）点击后会自动滚动采集全部行，工具栏实时显示进度，采完后还原滚动位置。

## 目录结构

```
├── manifest.json              # MV3 配置（activeTab / scripting / downloads）
├── background/service-worker.js  # 图标点击注入 + 后台下载
├── content/content.js         # 选择模式 UI + 表格提取 + 导出
├── lib/xlsx.full.min.js       # SheetJS 0.20.3（Apache-2.0）
├── icons/icon128.png
├── test/fixture.html          # 基础测试页（合并单元格/多表/链接拦截）
├── test/virtual-fixture.html  # 虚拟滚动测试页（60 行，含 input 列）
└── docs/                      # 架构文档 / 产品文档
```

## 开发与测试

```powershell
# 语法检查
node --check content/content.js
node --check background/service-worker.js

# 启动本地静态服务后访问 http://localhost:3000/test/virtual-fixture.html
npx -y serve .
```

修改代码后：`chrome://extensions` 刷新扩展 → 刷新目标页面。

## 文档

- [架构文档](docs/architecture.md)：模块划分、数据流、关键设计决策
- [产品文档](docs/product.md)：功能清单、交互规范、已知限制
