# 拆分规则与列筛选持久化方案（v1.7，已实现）

现状：`splitRules` / `colFilters` 为 main.js 内存 Map（DOM 元素作键），退出选择模式即清空。
目标：用户配置过的拆分规则与列筛选跨会话保留，重选同表自动恢复。
实现：`extension/content/persist.js`（本方案的设计依据）；浏览器回归步骤见 [test/README.md](../../test/README.md)。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 存储后端 | `chrome.storage.local` + manifest 增加 `storage` 权限（无安装警告；不上传账号，不用 `sync`） |
| 权限变更理由 | 用户配置持久化（AGENTS.md 允许有理由的权限变更，此处记录备案） |
| 定位键 | 页面键（origin+pathname）+ 表指纹（首行文本）替代 DOM 元素键 |
| 会话数据流 | 内存 Map 保持唯一会话真相，存储只作恢复源；panel / 导出零改动读到恢复值 |
| 取消选择/退出 | 只清内存不清存储——重选自动恢复（行为语义变更） |
| 重置路径 | 面板全不拆 + 全导出 → 保存 = 删除记录，恢复智能预填默认 |

## 定位键

- `pageKey` = `location.origin + location.pathname`（忽略 query/hash：分页、筛选参数不应拆散同一份配置）
- `tableKey`（表指纹）= 表头单元格文本经 `normText` 规范化后以 `\u0001` 拼接；无表头退化为首个非空行
  - 与 `colKeys`（表头文本作列标识）同一哲学：表头变 → 指纹不匹配 → 安全降级为默认，旧规则不误用（`resolveRuleCol` 解析不到本就静默跳过）
  - 指纹由 persist 模块统一用 DOM 表头计算（保存/恢复同源保证一致）；分体表格（Element Plus / vxe-table 包装容器）取容器内首个 `table` 的表头；**兼容 thead 直接嵌 th 无 tr 的写法**（vxe-table 表头表，`table.rows` 不含这类 th，取 tbody 首行会在虚拟滚动下不稳定——指纹绝不落数据行）
  - 同页两表指纹相同（表头完全一致）→ 共享一份配置，可接受降级

## 存储结构

```json
"h2x.v1:p:https://host/path" : {
  "标题\u0001产品ID\u0001..." : {
    "rules":   [{ "col": "标题/产品ID", "mode": "block", "pattern": "", "limit": null }],
    "excluded": ["标题/产品ID#2"],
    "formats": [["本地展示价", "number"]],
    "updatedAt": 1693110000000
  }
}
```

- 单页一条顶层键，值为 { 表指纹 → 记录 }；纯 JSON，与 `applyColumnSplits` / `filterColumns` 入参形状一致，恢复零转换（`excluded` 数组恢复时转 `Set`，`formats` 键值对数组转 `Map`）
- `formats` 为 [列键, 格式] 键值对数组而非对象：对象键只能是字符串，数字列键（无表头/重名兜底的列序号）会被串化成 `'0'` 而与 `colKeys` 的数字键错位；文本为默认行为不落盘，只存 `number`（v1.9 增列格式，随 v1.7 记录结构追加字段，旧记录缺省 `[]` 兼容）
- 容量控制：上限 50 个页面条目，超出按 `updatedAt` LRU 淘汰（每条几百字节，实际难触顶）

## 读写时序

| 时机 | 动作 |
|---|---|
| persist.js 注入时 | 预载当前 pageKey 记录进模块内存，暴露 `ready()` Promise |
| `addSelected` / 虚拟采集完成 | 按指纹查内存记录 → 命中则写入 `splitRules` / `colFilters` / `colFormats` Map |
| `saveSplitPanel` 保存 | 更新 Map 后异步落盘（fire-and-forget，失败仅 console.warn，降级为当次有效） |
| 保存时规则+排除+格式全为空 | 删除该表记录 |
| `removeSelected` / `exit` | 只清内存 Map，不动存储 |
| `doExport` / `panel.open` 入口 | `await persist.ready()` 兜底注入初期毫秒级竞态 |

## 边界与降级

- 扩展上下文失效（开发中重载扩展）→ `chrome.storage` 抛错 → try/catch 降级纯内存（与现状一致）
- 恢复的规则遇合并单元格 / 列缺失 → 现有防御覆盖（原样导出 / 静默跳过）
- 表头异步加载完成前选中 → 指纹不匹配 → 不恢复（可重新选一次）
- 同页多 tab 并发保存 → last-write-wins 丢一份（低频低危，接受）
- 存储内容含表头文本与分隔符（业务字段名级别），仅存本地扩展区

## 改动清单

| 文件 | 改动 |
|---|---|
| `manifest.json` | permissions +`storage`；版本 1.7 |
| `content/persist.js`（新，约 120 行） | 加载/恢复/保存/删除/LRU + 指纹；纯函数挂 `ns.persist` 供测试 |
| `background/service-worker.js` | 注入列表插入 persist.js（virtual 之后、panel 之前） |
| `main.js` | addSelected 恢复；removeSelected / exit 只清内存；doExport 兜底 await |
| `panel.js` | 保存后落盘；open 兜底 await；（可选）打开时提示「已恢复上次设置」 |
| `test/algo-check.cjs` | +指纹 / 记录合并 / LRU 纯函数用例（约 6-8 个） |
| AGENTS.md / docs / README | 验证命令 9→10 个文件；文档同步 |

## 验证方案

- `node --check` 全部 10 个内容脚本（AGENTS.md 验证命令同步更新）
- `node test/algo-check.cjs` 新增用例全绿
- 浏览器回归（fixture 页）：保存规则 → 刷新页面 → 重进选择模式 → 选同表 → 面板显示已保存规则 → 导出生效；改表头后不恢复；空配置保存后恢复默认；虚拟表（virtual-fixture）同流程
