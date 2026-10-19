/**
 * 用 headless Edge + CDP 打开真实控制台，逐窗截图并抓布局信息。
 * 目的：给 README / 宣传页拿真截图（不是示意图）。
 *
 * 用法: node tools/shot-console.mjs [--out <前缀>] [--url <控制台地址>]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_TARGET = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:8787/';
const OUT_PREFIX = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'con';
const W = 1600, H = 1000;
const PROFILE = path.join(ROOT, '_testrun', 'edge-shot');
fs.rmSync(PROFILE, { recursive: true, force: true });

/* ── 起 Edge，开远程调试端口 ── */
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--hide-scrollbars',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=9333`,
  `--window-size=${W},${H}`,
  URL_TARGET,
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForDebug(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { return await getJSON('http://127.0.0.1:9333/json'); } catch { await sleep(400); }
  }
  throw new Error('Edge 调试端口没起来');
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url); // Node 22+ 全局 WebSocket
    sock.addEventListener('open', () => resolve(sock));
    sock.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message || 'unknown'))));
  });
}

let msgId = 0;
function wsSend(sock, method, params = {}) {
  const id = ++msgId;
  sock.send(JSON.stringify({ id, method, params }));
  return id;
}
function wsCall(sock, method, params = {}) {
  const id = wsSend(sock, method, params);
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      sock.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)));
      else resolve(m.result);
    };
    sock.addEventListener('message', onMsg);
    setTimeout(() => { sock.removeEventListener('message', onMsg); reject(new Error('timeout ' + method)); }, 30000);
  });
}

async function main() {
  const list = await waitForDebug();
  const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
  if (!page) throw new Error('没找到控制台页面: ' + JSON.stringify(list.map(t => t.url)));
  console.log('[edge] 目标页:', page.url);

  const sock = await connectWs(page.webSocketDebuggerUrl);
  await wsCall(sock, 'Page.enable');
  await wsCall(sock, 'Runtime.enable');
  await wsCall(sock, 'DOM.enable');
  await sleep(3500); // 等 app.js 初始化完

  const evalJS = async (expr) => {
    const r = await wsCall(sock, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  // 抓 JS 错误
  const jsErrors = await evalJS(`(window.__jsErrors||[]).join(' | ')`);
  console.log('[jsErrors]', jsErrors || '(无)');

  /* 在所有截图动作之前，先把「浮层类」全部关掉。
     之前只调 recallAllWins()，日志小窗 #logMini 是 fixed 定位浮层，
     会盖在右下角的小窗上（AI 接口 / 任务参数常被压住），截图就废了。
     这里把日志小窗、它的胶囊、复盘按钮、悬浮刻度等都藏掉，
     只保留窗口本身的内容 —— 宣传图要的是干净界面。 */
  const hideOverlays = `(function(){
    try { closeLogMini && closeLogMini(); } catch(e) {}
    var ids = ['logMini','logMiniPill','recallPill','scrollCurve','scrollRail','toTop','backTop'];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    // 兜底：任何 fixed 定位的浮层（除顶栏和已关闭的）一律隐藏
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function(el){
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed') return;
      if (el.closest('.topbar, #topbar, header')) return;
      if (el.id === 'logMiniPill') return;
      el.style.display = 'none';
    });
    // 滚动条也藏掉，避免截图右侧出现一条灰杠
    document.documentElement.style.scrollbarWidth = 'none';
    return 'overlays hidden';
  })()`;

  // 1) 全貌图：所有窗口呼出 + 排回屏幕
  await evalJS(`(function(){ try{ recallAllWins && recallAllWins(); }catch(e){} })()`);
  await sleep(900);
  await evalJS(hideOverlays);
  await sleep(250);
  let shot = await wsCall(sock, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(ROOT, '_testrun', `${OUT_PREFIX}-all.png`), Buffer.from(shot.data, 'base64'));
  console.log('[shot] all');

  // 2) 逐个窗口截图（把目标窗外其余隐藏）
  const wins = await evalJS(`JSON.stringify(Array.from(document.querySelectorAll('.win')).map(w=>({
      id: w.dataset.win || w.id,
      title: (w.querySelector('.win-title,.win-head b,.win-head')||{}).textContent||'',
      x: w.offsetLeft, y: w.offsetTop, w: w.offsetWidth, h: w.offsetHeight,
      vis: getComputedStyle(w).display !== 'none'
    })))`);
  const winList = JSON.parse(wins);
  console.log('[wins]', winList.map(w => `${w.id}@${w.x},${w.y} ${w.w}x${w.h} vis=${w.vis}`).join('\n       '));

  for (const w of winList) {
    try {
      // 隐藏除目标外的所有窗，再把目标窗滚到视野内
      await evalJS(`(function(){
        var all = Array.from(document.querySelectorAll('.win'));
        all.forEach(function(x){ x.style.display = (x.dataset.win === ${JSON.stringify(w.id)} || x.id === ${JSON.stringify(w.id)}) ? '' : 'none'; });
        var t = all.filter(function(x){ return x.dataset.win === ${JSON.stringify(w.id)} || x.id === ${JSON.stringify(w.id)}; })[0];
        if (t) {
          var ws = document.getElementById('workspace');
          if (ws) { ws.scrollTop = Math.max(0, t.offsetTop - 20); }
          t.style.display = '';
        }
      })()`);
      await sleep(400);
      // 单窗截图再清一次浮层：切窗时日志小窗可能被轮询重新打开
      await evalJS(hideOverlays);
      await sleep(200);
      const s = await wsCall(sock, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(ROOT, '_testrun', `${OUT_PREFIX}-${w.id}.png`), Buffer.from(s.data, 'base64'));
      console.log('[shot]', w.id);
    } catch (e) {
      console.error('[fail]', w.id, e.message);
    }
  }

  sock.close();
  console.log('[done]');
}

main().catch((e) => { console.error('[ERR]', e.message); process.exitCode = 1; })
  .finally(() => { try { edge.kill(); } catch {} setTimeout(() => process.exit(), 1500); });
