/**
 * 商店截图生成器（无第三方依赖：Node 内置 http + WebSocket 走 CDP）
 * 用法（仓库根目录）：node release/gen-shots.mjs
 * 原理：起静态服务 → 启动 headless Chrome（CDP）→ 逐场景加载 release/shot-page.html
 * （页面内注入真实内容脚本并驱动到目标状态）→ 轮询 __SHOT_READY → 截图 1280×800
 * 产物：release/screenshots/*.png（商店要求 1280×800 或 640×400）
 */
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'release', 'screenshots');
const PORT = 3100;
const CDP_PORT = 9333;
const W = 1280, H = 800;

/* ---------- 静态服务（仓库根，供页面 fetch 内容脚本） ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

/* ---------- Chrome 定位 ---------- */
function findChrome() {
  const cands = [
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')
  ];
  return cands.find(p => p && fs.existsSync(p));
}

/* ---------- CDP 小工具 ---------- */
function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')); } }, 20000);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForReady(call, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await call('Runtime.evaluate', { expression: 'window.__SHOT_READY === true || document.title', returnByValue: true });
    if (r.result.value === true) return true;
    if (r.result.value === 'INJECT_FAIL') throw new Error('内容脚本注入失败');
    await sleep(100);
  }
  throw new Error('等待 __SHOT_READY 超时');
}

/* ---------- 主流程 ---------- */
const shots = [
  { name: '1-select',       shot: 'select', dark: false, desc: '选择表格' },
  { name: '2-panel',        shot: 'panel',  dark: false, desc: '列设置面板（拆分+预览）' },
  { name: '3-export',       shot: 'export', dark: false, desc: '导出成功' },
  { name: '4-panel-dark',   shot: 'panel',  dark: true,  desc: '列设置面板（深色模式）' }
];

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('未找到 Chrome/Edge'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log('静态服务 http://127.0.0.1:' + PORT);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'h2x-shot-'));
  const proc = spawn(chrome, [
    '--headless', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--force-color-profile=srgb', '--lang=zh-CN',
    '--force-device-scale-factor=1', `--window-size=${W},${H}`,
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  try {
    // 等 CDP 就绪
    let ver;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try {
        ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
        break;
      } catch { /* 未就绪 */ }
    }
    if (!ver) throw new Error('CDP 端口未就绪');

    const bws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.addEventListener('open', res); bws.addEventListener('error', rej); });
    const browser = cdp(bws);

    for (const s of shots) {
      const url = `http://127.0.0.1:${PORT}/release/shot-page.html?shot=${s.shot}`;
      const { targetId } = await browser('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser('Target.attachToTarget', { targetId, flatten: true });
      // flatten 会话：消息经 browser 通道转发，需带 sessionId
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = Math.floor(Math.random() * 1e9);
        const onMsg = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id === mid && m.sessionId === sessionId) {
            bws.removeEventListener('message', onMsg);
            m.error ? reject(new Error(m.error.message)) : resolve(m.result);
          }
        };
        bws.addEventListener('message', onMsg);
        bws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        setTimeout(() => { bws.removeEventListener('message', onMsg); reject(new Error(method + ' 超时')); }, 20000);
      });

      await call('Page.enable');
      await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      if (s.dark) await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await call('Page.navigate', { url });
      await waitForReady(call);
      await sleep(350); // 等动画收尾（toast/面板入场 .15s + 过渡）
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const out = path.join(OUT_DIR, s.name + '.png');
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      console.log(`[OK] ${s.name}.png（${s.desc}）`);
      await browser('Target.closeTarget', { targetId });
    }
    bws.close();
    console.log('\n截图完成：' + OUT_DIR);
  } finally {
    // 杀进程树：proc.kill 只杀主进程，会遗留 GPU/渲染子进程占用资源
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
    server.close();
    // Chrome 退出需一拍释放 profile 句柄；仍占用则留给系统清理（不阻塞）
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
}

main().catch(e => { console.error('截图失败：', e); process.exit(1); });
