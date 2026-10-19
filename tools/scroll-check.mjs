// 滚动引导断言：顶栏高亮 / next-rail 探头 / 浮动导览钮 / 键盘翻屏 / 曲线 / 视差
// 用法: node _testrun/rv/tools/scroll-check.mjs
// 起静态服务 + headless Edge + 原生 WebSocket CDP，零第三方依赖。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BS = String.fromCharCode(92);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RV = path.join(ROOT, '_testrun', 'rv');
const EDGE = 'C:' + BS + 'Program Files (x86)' + BS + 'Microsoft' + BS + 'Edge' + BS + 'Application' + BS + 'msedge.exe';
const PORT = 8892;
const CDP = 9224;
const PROF = path.join(ROOT, '_testrun', 'edge-scroll');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; fails.push(name + (extra ? '  [' + extra + ']' : '')); console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ── 静态服务器（只服务 _testrun/rv）──
const srv = spawn(process.execPath, ['-e', `
const http=require('http'),fs=require('fs'),path=require('path');
const R=${JSON.stringify(RV)};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.md':'text/markdown'};
http.createServer((q,s)=>{
  let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=path.join(R,p);
  fs.readFile(f,(e,d)=>{
    if(e){s.statusCode=404;s.end('nf');return;}
    s.setHeader('content-type',MIME[path.extname(f)]||'application/octet-stream');
    s.end(d);
  });
}).listen(${PORT});
`], { stdio: 'ignore' });

await new Promise(r => setTimeout(r, 800));

// ── 起 headless Edge + CDP ──
const br = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1470,900', '--remote-debugging-port=' + CDP, '--user-data-dir=' + PROF,
  `http://127.0.0.1:${PORT}/`], { stdio: 'ignore', detached: true });

let ws = null, target = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 700));
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    target = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
    if (target) break;
  } catch (e) {}
}
if (!target) { console.error('找不到页面 target'); process.exit(1); }

const wsMod = globalThis.WebSocket;
ws = new wsMod(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const jsErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') jsErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
function send(method, params) {
  return new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function evaljs(expr, tmo) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise(res => setTimeout(() => res({ __timeout: true }), tmo || 6000)),
  ]);
  if (r.__timeout) return { __err: 'CDP evaluate timeout' };
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || 'exception' };
  return r.result?.result?.value;
}
let smoothOff = false;
async function scrollTo(y) {
  // CSS 里 html{scroll-behavior:smooth} 会把任何 scrollTop 赋值都变成 1s 动画，
  // 而 CDP Runtime.evaluate 会等动画跑完才返回（awaitPromise），一旦有
  // IntersectionObserver/rAF 与动画互相憋住就永远不返回 —— 之前测试卡死就是这个。
  if (!smoothOff) {
    await evaljs(`(function(){var st=document.getElementById('__no_smooth');if(!st){st=document.createElement('style');st.id='__no_smooth';st.textContent='html,body{scroll-behavior:auto !important}';document.head.appendChild(st);}return 1;})()`);
    smoothOff = true;
  }
  await evaljs(`window.scrollTo(0, ${y})`);
  await new Promise(r => setTimeout(r, 120));
  // 兜底：如果 scrollY 没变到目标（被 smooth 吃掉了），再写一次 scrollTop
  const got = await evaljs('Math.round(window.scrollY)');
  if (typeof got === 'number' && Math.abs(got - y) > 4) {
    await evaljs(`document.documentElement.scrollTop = ${y}; document.body.scrollTop = ${y};`);
    await new Promise(r => setTimeout(r, 120));
  }
  // 再等一帧让 rAF 回调（progress / fab / rail）跑完
  await new Promise(r => setTimeout(r, 200));
}
function q(sel) { return `document.querySelector(${JSON.stringify(sel)})`; }
function qa(sel) { return `Array.from(document.querySelectorAll(${JSON.stringify(sel)}))`; }

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await evaljs('1');

  // ═══ 1. 基础结构 ═══
  const railCount = await evaljs(`${qa('.next-rail')}.length`);
  ok(railCount === 6, '有 6 条 next-rail（7 个 section，最后一节不放）', 'got ' + railCount);

  const fabExists = await evaljs(`!!${q('#fabNav')} && !!${q('#fabUp')} && !!${q('#fabDown')}`);
  ok(fabExists, '浮动导览钮存在（fabNav/fabUp/fabDown）');

  const badHref = await evaljs(`${qa('.next-rail')}.filter(a=>!document.querySelector(a.getAttribute('href'))).length`);
  ok(badHref === 0, '每条 rail 的 href 都命中真实 section', 'bad=' + badHref);

  const railOrder = await evaljs(`${qa('.next-rail')}.every(a=>{
    var host=a.closest('section');
    var nxt=host.nextElementSibling;
    return nxt && nxt.tagName==='SECTION' && ('#'+nxt.id)===a.getAttribute('href');
  })`);
  ok(railOrder, '每条 rail 指向紧邻的下一个 section');

  // ═══ 2. 顶栏高亮 ═══
  const navInfo = await evaljs(`(${qa('.hud-nav a')}).map(a=>({href:a.getAttribute('href'),cur:a.getAttribute('aria-current')}))`);
  ok(navInfo.length === 7, '顶栏 7 个导航链接', 'got ' + navInfo.length);
  const curAtTop = navInfo.filter(n => n.cur === 'true').length;
  ok(curAtTop === 1, '初始只有 1 个高亮（不重复、不乱跳）', 'got ' + curAtTop);

  // ═══ 3. next-rail 探头逻辑 ═══
  await scrollTo(0);
  const peekAtTop = await evaljs(`${qa('.next-rail.peek')}.length`);
  ok(peekAtTop === 0, '页面顶部没有 rail 探头（hero 无 rail）', 'got ' + peekAtTop);

  const demoGeom = await evaljs(`(function(){
    var s=document.getElementById('demo');
    var r=s.getBoundingClientRect();
    return {top:r.top+window.scrollY, h:r.height, vh:window.innerHeight};
  })()`);
  if (demoGeom.__err) { console.log('demoGeom err:', demoGeom.__err); }
  // 滚到「demo 节底部再上来 18% 视口高」——正好卡在 peek 阈值内
  const targetY = Math.round(demoGeom.top + demoGeom.h - demoGeom.vh * 0.82);
  await scrollTo(targetY);
  const demoRailPeek = await evaljs(`(function(){
    var s=document.getElementById('demo');
    var rail=s.querySelector('.next-rail');
    return rail.classList.contains('peek');
  })()`);
  ok(demoRailPeek, '滚到 demo 节下部时它的 NEXT 导轨探头');

  const railClickable = await evaljs(`(function(){
    var s=document.getElementById('demo');
    var rail=s.querySelector('.next-rail');
    return getComputedStyle(rail).pointerEvents;
  })()`);
  ok(railClickable === 'auto', '探头后的 rail 可点击', 'pointer-events=' + railClickable);

  const overviewTop = await evaljs(`document.getElementById('overview').getBoundingClientRect().top + window.scrollY`);
  await scrollTo(Math.round(overviewTop + 200));
  const prevRailGone = await evaljs(`(function(){
    var s=document.getElementById('demo');
    var rail=s.querySelector('.next-rail');
    return !rail.classList.contains('peek');
  })()`);
  ok(prevRailGone, '翻过 demo 后它的 rail 收回（不跟到下一屏）');

  const curRailPeek = await evaljs(`(function(){
    var s=document.getElementById('overview');
    var rail=s.querySelector('.next-rail');
    return rail.classList.contains('peek');
  })()`);
  ok(curRailPeek, '当前节的 rail 处于探头状态');

  // ═══ 4. 顶栏高亮跟随滚动 ═══
  await scrollTo(Math.round(overviewTop + 200));
  const curNav = await evaljs(`${qa('.hud-nav a')}.filter(a=>a.getAttribute('aria-current')==='true').map(a=>a.getAttribute('href')).join(',')`);
  ok(curNav === '#overview', '滚到 overview 时顶栏高亮 overview', 'got ' + curNav);

  const pipelineTop = await evaljs(`document.getElementById('pipeline').getBoundingClientRect().top + window.scrollY`);
  await scrollTo(Math.round(pipelineTop + 300));
  const curNav2 = await evaljs(`${qa('.hud-nav a')}.filter(a=>a.getAttribute('aria-current')==='true').map(a=>a.getAttribute('href')).join(',')`);
  ok(curNav2 === '#pipeline', '滚到 pipeline 时高亮 pipeline', 'got ' + curNav2);

  const deckTop = await evaljs(`document.getElementById('deck').getBoundingClientRect().top + window.scrollY`);
  await scrollTo(Math.round(deckTop + 400));
  const curNav3 = await evaljs(`${qa('.hud-nav a')}.filter(a=>a.getAttribute('aria-current')==='true').map(a=>a.getAttribute('href')).join(',')`);
  ok(curNav3 === '#deck', '滚到 deck 时高亮 deck', 'got ' + curNav3);

  const uniq = await evaljs(`${qa('.hud-nav a[aria-current="true"]')}.length`);
  ok(uniq === 1, '任意滚动位置只有 1 个高亮项', 'got ' + uniq);

  // ═══ 5. 浮动导览钮 ═══
  await scrollTo(0);
  const fabHiddenAtTop = await evaljs(`!${q('#fabNav')}.classList.contains('show')`);
  ok(fabHiddenAtTop, '顶部时浮动钮隐藏');

  await scrollTo(Math.round(pipelineTop + 300));
  const fabShown = await evaljs(`${q('#fabNav')}.classList.contains('show')`);
  ok(fabShown, '滚过一屏后浮动钮出现');

  const upEnabled = await evaljs(`${q('#fabUp')}.disabled === false`);
  ok(upEnabled, '非顶部时 ↑ 可用');

  const beforeY = await evaljs('window.scrollY');
  await evaljs(`${q('#fabDown')}.click()`);
  await new Promise(r => setTimeout(r, 1600));
  const afterY = await evaljs('window.scrollY');
  ok(afterY > beforeY + 100, '点 ↓ 后页面前进到下一屏', `${beforeY} -> ${afterY}`);

  await evaljs(`${q('#fabUp')}.click()`);
  await new Promise(r => setTimeout(r, 2200));
  const endY = await evaljs('window.scrollY');
  ok(endY < 5, '点 ↑ 后回到顶部', 'scrollY=' + endY);

  // ═══ 6. 键盘翻屏 ═══
  await scrollTo(0);
  await evaljs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown',bubbles:true,cancelable:true}))`);
  await new Promise(r => setTimeout(r, 1600));
  const kbY = await evaljs('window.scrollY');
  ok(kbY > 100, 'PageDown 翻到下一屏', 'scrollY=' + kbY);

  await evaljs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',bubbles:true,cancelable:true}))`);
  await new Promise(r => setTimeout(r, 1600));
  const kbY2 = await evaljs('window.scrollY');
  ok(kbY2 < kbY, 'PageUp 回到上一屏', `${kbY} -> ${kbY2}`);

  await evaljs(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))`);
  await new Promise(r => setTimeout(r, 2000));
  ok(await evaljs('window.scrollY') < 5, 'Home 回顶');

  // ═══ 7. 曲线进度 + 视差（回归）═══
  await scrollTo(0);
  const dash0 = await evaljs(`parseFloat(getComputedStyle(${q('#scrollDraw')}).strokeDashoffset)`);
  const LEN = await evaljs(`(function(){try{return ${q('#scrollDraw')}.getTotalLength()}catch(e){return 0}})()`);
  ok(LEN > 0 && Math.abs(dash0 - LEN) < 2, '顶部时曲线 dashoffset ≈ 全长', `dash=${dash0} LEN=${LEN}`);

  const maxY = await evaljs(`document.documentElement.scrollHeight - window.innerHeight`);
  await scrollTo(Math.round(maxY));
  const dashEnd = await evaljs(`parseFloat(getComputedStyle(${q('#scrollDraw')}).strokeDashoffset)`);
  ok(Math.abs(dashEnd) < 2, '底部时曲线 dashoffset ≈ 0', 'dash=' + dashEnd);

  const pctEnd = await evaljs(`${q('#scrollPct')}.textContent`);
  ok(pctEnd === '100%', '底部时百分比显示 100%', 'got ' + pctEnd);

  // 视差要在「标题正走在视口里」的那一刻采样 —— 之前滚到页面最底部测，
  // 那时视口里根本没几个 .sec-head，且 --par 可能已被离开视口的逻辑撤掉。
  const deckTop2 = await evaljs(`(function(){
    var s=document.getElementById('deck'); var r=s.getBoundingClientRect();
    return Math.round(r.top+window.scrollY);
  })()`);
  await scrollTo(Math.max(0, deckTop2 - 60));   // 标题刚好压在顶栏下方
  await new Promise(r => setTimeout(r, 200));
  const parInfo = await evaljs(`(function(){
    var hs=Array.from(document.querySelectorAll('.sec-head[data-par-on]'));
    var out=[];
    hs.forEach(function(h){
      var v=h.style.getPropertyValue('--par');
      var r=h.getBoundingClientRect();
      out.push({par:v, top:Math.round(r.top), bottom:Math.round(r.bottom),
                inView: r.bottom>0 && r.top<window.innerHeight});
    });
    return out;
  })()`);
  const inViewPar = (parInfo || []).filter(o => o.inView && o.par !== '');
  const badPar = inViewPar.filter(o => { const v = parseFloat(o.par); return !(v >= 0 && v <= 1); });
  ok(inViewPar.length > 0 && badPar.length === 0,
     '视差 --par 在 0..1（对视口内的标题采样）',
     'inView=' + inViewPar.length + ' bad=' + JSON.stringify(badPar.slice(0,2)));

  // ═══ 8. JS 无报错 ═══
  ok(jsErrors.length === 0, '无 JS 报错', jsErrors.slice(0, 2).join(' | '));

  // ═══ 9. 无 JS 时 rail 仍可跳（降级）═══
  const railHrefs = await evaljs(`${qa('.next-rail')}.map(a=>a.getAttribute('href')).join(',')`);
  ok(railHrefs === '#overview,#pipeline,#deck,#interface,#safety,#log', 'rail href 覆盖全部后续区块', railHrefs);

} finally {
  try { ws && ws.close(); } catch (e) {}
  try { process.kill(-br.pid, 'SIGKILL'); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  await new Promise(r => setTimeout(r, 600));
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) {}
}

console.log('');
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
