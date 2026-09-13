# Chrome Web Store 审核表单填写参考

提交审核时控制台会要求填写以下内容，直接照抄即可。

---

## 1. 单一用途描述（Single purpose）

**中文**

```
将网页表格导出为 xlsx/csv/json/md/html 文件。
```

**English**

```
Export web page tables to xlsx/csv/json/md/html files.
```

## 2. 权限理由（Permission justification）

审核表单会要求逐项说明每个权限的用途。

| 权限 | 理由（中文） | Justification (English) |
|---|---|---|
| `activeTab` | 仅在用户点击扩展图标时获取当前标签页，用于在该页面注入表格识别脚本。 | Granted only when the user clicks the extension icon, used to inject the table-detection scripts into the current tab. |
| `scripting` | 按需注入内容脚本（表格识别与导出界面），不在页面常驻。 | Used to inject content scripts (table detection and export UI) on demand; nothing runs persistently on pages. |
| `downloads` | 保存导出的文件（xlsx/csv/json/md/html）。 | Used to save the exported files (xlsx/csv/json/md/html) to the user's computer. |
| `storage` | 在本地（并在用户登录 Chrome 账号时随其账号）记忆按页面保存的列拆分/筛选/排序/格式设置，下次打开同一页面自动恢复。 | Stores the user's per-page column split/filter/order/format settings locally (and syncs them with the user's own Chrome account when signed in) so they are restored when the same page is opened again. |

## 3. 数据使用声明（Data use certification）

本扩展不收集任何用户数据，表单按以下勾选：

- 不收集用户数据（Does your extension collect data? → **No**）
- 所有「正在收集的用户数据」类别均不勾选
- 「数据使用披露」：声明不收集、不出售、不传输用户数据
- 隐私政策 URL：不收集数据时可留空（若控制台强制要求，可填项目仓库地址）

## 4. 远程代码声明（Remote code）

本扩展**不使用远程代码**：

- SheetJS（xlsx.full.min.js）已本地打包在 `lib/` 目录
- 无 CDN 加载、无外部脚本注入、无 `eval`/`new Function`
- 若表单询问 "Does your extension use remote code?" → **No**

## 5. 审核备注（可选，建议填写）

给审核员的说明，可加快审核：

**中文**

```
本扩展为纯本地工具：点击图标后按需注入内容脚本，用户点选页面表格后导出文件。
不请求任何网络权限，不收集、不传输任何数据。列设置默认仅存本机（chrome.storage.local）；
用户登录 Chrome 账号时由浏览器镜像一份到 chrome.storage.sync，便于其在多台设备上沿用
同一套设置，数据始终在用户自己的浏览器账号内，不经过任何第三方服务器。
```

**English**

```
This extension is a purely local tool: clicking the icon injects content scripts on demand;
the user selects tables on the page and exports them as files. It requests no network
permissions and collects or transmits no data. Column settings are stored locally
(chrome.storage.local) and, when the user is signed in to Chrome, mirrored by the browser to
chrome.storage.sync so the same settings carry over to their other devices — the data stays
inside the user's own browser account and never reaches any third-party server.
```

---

## 6. 商店文案合规：不堆砌关键词

参考 ID「Yellow Argon」的违规「产品说明中有过多关键字」源自商店政策的元数据条款——禁止为提高排名而反复堆砌同一批关键词（v2.5.3 曾触发一次，当时处置为移除组件库名）。编写 [store-listing.md](store-listing.md) 时遵守：

- **同一卖点在详细说明里只写一次**：虚拟滚动/分页采集、组件表格适配、复制到剪贴板、免费开源、不收集任何数据、可导出格式（xlsx/csv/json/md/html）等，不得在开头段与后文分节各写一遍
- **不在开头段提前罗列后文卖点**：开头一句定位即可，卖点交给【使用方式】【列设置】【核心能力】【输出方式】【隐私与数据安全】分节承载
- **不罗列具体组件库名**（Element Plus、AG Grid、MUI X DataGrid、Tabulator、Ant Design Vue、vxe-table 等），统一写「主流前端组件库」（v2.5.4 处置）
- **简短说明同样是元数据**：不把多个卖点用逗号串成关键词表；它对应 manifest 的 `extDescription`（`extension/_locales/zh_CN|en/messages.json`），改动须双语同步并升 manifest 版本号
- **中英双语同步**：中文改了，英文同样改，不得只改一侧

自检：详细说明中每个卖点与格式名只出现一次；能力表述与 [../docs/product.md](../docs/product.md) 一致。

---

## 提交前检查清单

- [ ] 开发者账号已注册（$5 一次性费用）
- [ ] zip 已上传（运行 `.\release\pack.ps1` 生成）
- [ ] 商店素材：截图（1280×800；中文 `1-select`/`2-panel`/`3-panel-dark`，英文 `1-select-en`/`2-panel-en`/`3-panel-dark-en`；商店最多上传 5 张，需自行取舍），见 `release/screenshots/`
- [ ] 宣传图 440×280（可选）
- [ ] 商品详情双语已填写（见 `store-listing.md`）
- [ ] 商店文案已按第 6 节自检（详细说明中每个卖点/格式名只出现一次，中英同步；简短说明与 manifest `extDescription` 一致）
- [ ] 隐私声明已按上文勾选
- [ ] 分发方式：公开 / 不公开 / 私有
- [ ] 手动回归：chrome://extensions 加载扩展后在真实页面验证 xlsx 导出
