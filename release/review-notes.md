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
| `storage` | 在本地记忆用户按页面保存的列拆分/筛选/格式设置，下次打开同一页面自动恢复。 | Stores the user's per-page column split/filter/format settings locally so they are restored when the same page is opened again. |

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
不请求任何网络权限，不收集、不传输任何数据。列设置仅存于 chrome.storage.local。
```

**English**

```
This extension is a purely local tool: clicking the icon injects content scripts on demand;
the user selects tables on the page and exports them as files. It requests no network
permissions and collects or transmits no data. Column settings are stored only in
chrome.storage.local.
```

---

## 提交前检查清单

- [ ] 开发者账号已注册（$5 一次性费用）
- [ ] zip 已上传（运行 `.\release\pack.ps1` 生成）
- [ ] 商店素材：截图 1–5 张（1280×800），见 `release/screenshots/`
- [ ] 宣传图 440×280（可选）
- [ ] 商品详情双语已填写（见 `store-listing.md`）
- [ ] 隐私声明已按上文勾选
- [ ] 分发方式：公开 / 不公开 / 私有
- [ ] 手动回归：chrome://extensions 加载扩展后在真实页面验证 xlsx 导出
