# html2xlsx v1.11 测试报告

日期：2026-08-28 ｜ 被测对象：`extension/`（manifest v1.11，11 个内容脚本 + service-worker）｜ 环境：Windows / Node.js / Chrome（注入式，无扩展环境）

## 一、测试范围与方法

| 层次 | 手段 | 覆盖 |
| --- | --- | --- |
| 静态检查 | `node --check` | 11 个内容脚本 + service-worker.js 语法 |
| 算法回归 | `test/algo-check.cjs` | 拆分三模式/列筛选/列格式/分体配对/表指纹/持久化规整/多格式导出纯函数/列宽/Sheet 名 |
| DOM 回归 | `test/auto-check.html` 页内自判 | 控件取值、单元格四通道、extractTable、提取→拆分→筛选→格式→csv/json 管线 |
| E2E（fixture） | `test/e2e-harness.js` 注入 | 选择交互、链接拦截、Esc 退出、CSV/JSON/MD/HTML/XLSX 内容、merges、Sheet 名、自适应列宽、拆分/筛选/格式、分体表格合并、持久化保存/恢复/重置 |
| E2E（虚拟表） | `test/e2e-harness-virtual.js` 注入 | 虚拟滚动采集 61 行、合法重复行保留、控件实时值、分体表+虚拟滚动组合 41 行、智能预填 |

E2E 方法：本地静态服务器 + 页内 fetch 内容脚本按依赖序 eval 注入；桩掉 `chrome.storage`（内存实现）与 `chrome.runtime.sendMessage`（走 blob 回退）；桩 `HTMLAnchorElement.click` + `URL.createObjectURL` 捕获导出内容；XLSX 验证直接解包 zip 读 sheet XML（列宽、单元格类型）。

## 二、结果统计

| 项 | 结果 |
| --- | --- |
| 语法检查（12 个文件） | 0 错误 |
| 算法回归 algo-check.cjs | 150/150 PASS |
| DOM 回归 auto-check.html | 37/37 PASS |
| E2E fixture.html | 79/79 PASS |
| E2E virtual-fixture.html | 21/21 PASS |
| **合计** | **287/287 PASS，0 FAIL** |

关键功能点结论：

- 取值：文本归一化（空白压缩、`&nbsp;`）、input/select/JS 属性设值实时读、checkbox/radio/date、合并单元格 merges、图片链接均正确。
- 拆分：控件值/分隔符/按换行三模式、右到左规则序、段数上限并入末段、参差行补齐、智能预填（多行文本列预勾选「按换行」）均符合预期。
- 筛选与格式：列/子列排除、数字列千分位数值化（表头行不动）、拆分新列继承格式均生效。
- 虚拟滚动：自动滚动采集全量 60 行（输出 61 行含表头）、序号 1/26/41 合法重复行全保留、同内容新引用兜底、5000 行×3 窗口性能 1ms。
- 分体表格：双 table + 双向滚动合并为单逻辑表，组合虚拟滚动采集 41 行；配对约束（列数差≤1、间隙≤10px、左右对齐、宽度相近）边界用例全过。
- 多格式导出：CSV（RFC4180+BOM+CRLF、多表拆多文件）、JSON（行对象、列名兜底/去重）、MD（转义、无表头补列N）、HTML（文档骨架、thead）、XLSX（merges、Sheet 名 31 字符截断/去重、自适应列宽钳制 8–50）内容与页内预期一致。
- 持久化：保存/恢复/重置路径正确，formats 键值对数组序列化无错位，损坏记录自愈剔除。

## 三、测试过程中发现与处理

**产品代码缺陷：0 个（本轮未发现）。**

测试资产修复（非产品缺陷）：

1. e2e-harness 判定变量名拼写错误（`__html2xxx`→`__html2xlsx`），导致注入成功误判为失败。
2. virtual-fixture 标题生成 `String(i+100).slice(1)` 在 i≥900 时宽度增长，重复行检测误报——改为 `slice(-3)` 保证唯一标识等宽。
3. 虚拟表开关列断言期望值与 fixture 生成逻辑（`i%5!==0`）不匹配——修正断言。
4. 多轮注入的并发/残留问题——补并发守卫、轮次锁、注入前防御性清理（等 exit 600ms 完成）。

测试环境适配（真实用户不受影响）：

- 后台标签页 rAF 与 scroll 事件不触发 → harness 用定时器替代 rAF、给 `scrollTop` 赋值补发 scroll 事件，仅测试桩。

## 四、风险与未覆盖项

- 真实扩展环境（chrome://extensions 加载）：service-worker 消息下载路径、chrome.storage 真实跨会话持久化未在 E2E 中覆盖（E2E 用内存桩 + blob 回退）。建议发布前手动回归一轮：刷新扩展 → 店小咪真实页导出 xlsx。
- XLSX 二进制仅解包验证 sheet XML 的列宽与关键单元格，未做全量单元格比对。
- `test/dianxiaomi-table.html` 含真实业务数据（已 gitignore），本轮未纳入自动化。
- CSP 严格页面（CSP 拦截 blob 下载）依赖扩展 downloads API 的场景仅覆盖回退逻辑，未覆盖真实 downloads 通道。

## 五、结论

v1.11 四层测试共 287 项断言全部通过，未发现产品代码缺陷；历史踩坑点（innerText 可见性、cloneNode 丢属性设值、表头表指纹、vxe-table 无 tr 表头）均有对应回归用例守护。测试资产自身在过程中修复 4 处缺陷。**结论：通过，可进入手动浏览器回归后发布。**
