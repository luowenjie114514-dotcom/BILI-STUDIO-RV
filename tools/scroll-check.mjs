// 滚动效果验证：--par 视差 + 进度轨道 + reveal 在真滚动下的表现。
// 起静态服务 + headless Edge + 原生 WebSocket CDP，零第三方依赖。
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { killTree } from '../test/browser.mjs';

const PUB = path.resolve(import.meta.dirname, '..', 'public');
const OUT = path.resolve(import.meta.dirname);
const PORT = 8904;
const DBG = 9342;
const PROFILE = path.join(OUT, 'edge-scroll-' + Date.now());
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/nasapunk.html';
  const f = path.join(PUB, p);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();
const errs = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  ' + detail : ''}`);
}
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 20000);
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
}

srv.listen(PORT, '127.0.0.1', async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(EDGE, [`--remote-debugging-port=${DBG}`, '--headless=new', `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore', detached: false });

  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${DBG}/json/list`);
      const list = await r.json();
      page = list.find((t) => t.type === 'page');
    } catch { /* 还没起来 */ }
  }
  if (!page) { console.log('FAIL  Edge 没起来'); killTree(child.pid); srv.close(); process.exit(1); }

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/nasapunk.html` });
  await sleep(1500);

  try {
    // 1) 平滑滚动：锚点跳转后 scrollY 落在 section 顶部附近（scroll-margin-top 64 生效）
    await evaluate(`document.querySelector('.hud-nav a[href="#deck"]').click()`);
    await sleep(1400);
    const anchor = await evaluate(`(() => {
      const s = document.getElementById('deck');
      const r = s.getBoundingClientRect();
      return { top: Math.round(r.top), scrollY: Math.round(scrollY), total: Math.round(document.documentElement.scrollHeight) };
    })()`);
    check('锚点跳转落点', Math.abs(anchor.top - 64) < 40, `top=${anchor.top}（期望 64）`);

    // 2) 进度顶线 + 曲线：滚到底部时顶线宽 ≈ 100%、pct 文本 = 100%
    //    注意：html 有 scroll-behavior:smooth，程序化滚动也是平滑的，
    //    所以这里必须显式 behavior:'instant'，否则读到的是动画中间帧。
    await evaluate(`window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
    await sleep(400);
    const bottom = await evaluate(`(() => {
      const f = document.getElementById('scrollFill');
      const p = document.getElementById('scrollPct');
      const d = document.getElementById('scrollDraw');
      return { w: f.style.width, pct: p.textContent, dash: d.style.strokeDashoffset, len: d.getTotalLength().toFixed(0) };
    })()`);
    check('顶线到底 100%', bottom.w === '100.00%' || bottom.w === '100%', `width=${bottom.w}`);
    check('百分比文本', bottom.pct === '100%', `pct=${bottom.pct}`);
    check('曲线走完', parseFloat(bottom.dash) < 1, `dashoffset=${bottom.dash} / LEN=${bottom.len}`);

    // 3) 视差：把标题滚到视口偏上位置，--par 是 0..1 之间的数，且 title 有 transform
    //    block:'center' 时标题正好居中，--par 恰为 0，所以这里故意往上多滚一屏，
    //    让标题处于视口上半部，才能取到非零的 --par。
    await evaluate(`(() => { const h = document.querySelector('#deck').querySelector('.sec-head'); h.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -120, behavior: 'instant' }); })()`);
    await sleep(400);
    const par = await evaluate(`(() => {
      const h = document.querySelector('#deck').querySelector('.sec-head');
      const cs = getComputedStyle(h.querySelector('.sec-title'));
      return { par: h.style.getPropertyValue('--par'), on: h.dataset.parOn, transform: cs.transform, opacity: cs.opacity };
    })()`);
    check('视差开关已置位', par.on === '1', `data-par-on=${par.on}`);
    const parNum = parseFloat(par.par);
    check('--par 是 0..1 之间的非零数', Number.isFinite(parNum) && parNum > 0 && parNum <= 1, `--par=${par.par}`);
    check('标题有 transform', par.transform !== 'none', par.transform);
    check('标题未透明到看不清', parseFloat(par.opacity) >= 0.55, `opacity=${par.opacity}`);
    // 3b) 视差真的生效：--par 是「标题从视口底边往上走了多少」，
    //     所以往上滚 p 减小、位移往 0 回；往下滚 p 增大、位移更负。
    const parShift = await evaluate(`(async()=>{
      const h = document.querySelector('#deck').querySelector('.sec-head');
      const t = h.querySelector('.sec-title');
      function snap() {
        const m = new DOMMatrix(getComputedStyle(t).transform);
        return { par: parseFloat(h.style.getPropertyValue('--par')), ty: m.f };
      }
      const near = snap();
      window.scrollBy({ top: -300, behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { near, far: snap() };
    })()`);
    check('往上滚 --par 减小', parShift.far.par < parShift.near.par, `par ${parShift.near.par.toFixed(3)} → ${parShift.far.par.toFixed(3)}`);
    check('往上滚位移归零', parShift.far.ty > parShift.near.ty, `ty ${parShift.near.ty.toFixed(1)} → ${parShift.far.ty.toFixed(1)}px`);
    // 3c) 反向：往下滚 p 减小、位移归零方向
    const parBack = await evaluate(`(async()=>{
      const h = document.querySelector('#deck').querySelector('.sec-head');
      const t = h.querySelector('.sec-title');
      function snap(){ const m = new DOMMatrix(getComputedStyle(t).transform); return { par: parseFloat(h.style.getPropertyValue('--par')), ty: m.f }; }
      const up = snap();
      window.scrollBy({ top: 300, behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { up, down: snap() };
    })()`);
    check('往下滚 --par 增大', parBack.down.par > parBack.up.par, `par ${parBack.up.par.toFixed(3)} → ${parBack.down.par.toFixed(3)}`);
    check('往下滚位移更负', parBack.down.ty < parBack.up.ty, `ty ${parBack.up.ty.toFixed(1)} → ${parBack.down.ty.toFixed(1)}px`);

    // 4) 滚回顶部后 --par 被撤掉，标题完全归位
    await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await sleep(400);
    const home = await evaluate(`(() => {
      const h = document.querySelector('#deck').querySelector('.sec-head');
      const cs = getComputedStyle(h.querySelector('.sec-title'));
      return { par: h.style.getPropertyValue('--par'), transform: cs.transform, opacity: cs.opacity };
    })()`);
    check('回顶后位移归零', home.transform === 'none' || home.transform === 'matrix(1, 0, 0, 1, 0, 0)', `transform=${home.transform}`);
    check('回顶后不透明', parseFloat(home.opacity) === 1, `opacity=${home.opacity}`);

    // 5) reveal：deck 区块已进场
    await evaluate(`window.scrollTo({ top: document.getElementById('deck').offsetTop, behavior: 'instant' })`);
    await sleep(1000);
    const rev = await evaluate(`(() => {
      const hs = [...document.querySelectorAll('#deck .reveal')];
      return { n: hs.length, inN: hs.filter(h => h.classList.contains('in')).length };
    })()`);
    check('deck 内 reveal 全部进场', rev.n > 0 && rev.inN === rev.n, `${rev.inN}/${rev.n}`);

    // 6) 性能：连续滚动 20 帧，看有没有漏帧级别的长任务（用 rAF 时间差粗测）
    const perf = await evaluate(`(async () => {
      const frames = [];
      let last = performance.now();
      await new Promise((res) => {
        let n = 0;
        function step(t) {
          frames.push(t - last); last = t;
          window.scrollTo({ top: (n * 120) % (document.documentElement.scrollHeight - 900), behavior: 'instant' });
          if (++n < 20) requestAnimationFrame(step); else res();
        }
        requestAnimationFrame(step);
      });
      frames.sort((a,b) => a-b);
      return { median: +frames[10].toFixed(1), max: +frames[19].toFixed(1) };
    })()`);
    check('滚动帧中位数 < 20ms', perf.median < 20, `median=${perf.median}ms max=${perf.max}ms`);

    // 7) 窄屏关视差
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`window.scrollTo({ top: document.getElementById('deck').offsetTop, behavior: 'instant' })`);
    await sleep(600);
    const mob = await evaluate(`(() => {
      const h = document.querySelector('#deck').querySelector('.sec-head');
      const cs = getComputedStyle(h.querySelector('.sec-title'));
      return { par: h.style.getPropertyValue('--par'), transform: cs.transform, opacity: cs.opacity };
    })()`);
    check('窄屏无 --par', mob.par.trim() === '', `--par='${mob.par}'`);
    check('窄屏标题不位移', mob.transform === 'none' || mob.transform === 'matrix(1, 0, 0, 1, 0, 0)', mob.transform);
  } catch (e) {
    check('执行异常', false, e.message);
  }

  console.log(errs.length ? 'JS 报错:\n' + errs.join('\n') : 'JS 无报错');
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  ws.close();
  killTree(child.pid);
  srv.close();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { console.log('profile 清理失败（不影响结果）: ' + e.code); }
  process.exit(failed || errs.length ? 1 : 0);
});
