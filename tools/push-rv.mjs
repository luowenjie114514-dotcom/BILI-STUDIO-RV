/**
 * 把 nasapunk 宣传页推到新仓库 BILI-STUDIO-RV。
 * 用 GitHub Contents API（因为本机 git clone https://github.com 连不上 443，而 api.github.com 通）。
 * 每个文件走一次 PUT /repos/{owner}/{repo}/contents/{path}。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TOKEN = process.env.GH_TOKEN;
const REPO = 'luowenjie114514-dotcom/BILI-STUDIO-RV';
const SRC = path.join(ROOT, '_testrun', 'rv');
const API = 'https://api.github.com';

if (!TOKEN) {
  console.error('缺 GH_TOKEN');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'bili-studio-rv-deploy',
};

async function putFile(relPath, absPath, message) {
  const content = fs.readFileSync(absPath);
  const b64 = content.toString('base64');
  const url = `${API}/repos/${REPO}/contents/${relPath.split(path.sep).join('/')}`;

  // 已存在则取 sha 覆盖
  let sha;
  const getRes = await fetch(url, { headers });
  if (getRes.status === 200) {
    sha = (await getRes.json()).sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: b64,
      ...(sha ? { sha } : {}),
      branch: 'main',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${relPath}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { path: relPath, size: content.length, commit: body.commit?.sha?.slice(0, 7) };
}

const targets = [
  ['README.md', path.join(SRC, 'README.md'), 'docs: README 加更新日志入口与素材清单'],
  ['CHANGELOG.md', path.join(SRC, 'CHANGELOG.md'), 'docs: 同步 CHANGELOG 到落地页仓库'],
  ['index.html', path.join(SRC, 'index.html'), 'style: 区块头栅格修正 + 条带置顶 + 水印压淡'],
  ['LICENSE', path.join(SRC, 'LICENSE'), 'chore: MIT License'],
  ['.gitignore', path.join(SRC, '.gitignore'), 'chore: gitignore'],
  ['assets/whale-main.webp', path.join(SRC, 'assets', 'whale-main.webp'), 'assets: 鲸鱼娘主立绘 1024x1536'],
  ['assets/whale-maid.webp', path.join(SRC, 'assets', 'whale-maid.webp'), 'assets: 鲸鱼子女仆立绘 696x1150'],
  ['assets/whale-token.webp', path.join(SRC, 'assets', 'whale-token.webp'), 'assets: 鲸鱼娘抠白边立绘 1008x1118'],
  ['assets/whale-avatar.webp', path.join(SRC, 'assets', 'whale-avatar.webp'), 'assets: 鲸鱼娘圆框头像 512x512'],
  ['assets/shot-full.webp', path.join(SRC, 'assets', 'shot-full.webp'), 'assets: 控制台全貌截图 1570x858'],
  ['assets/shot-run.webp', path.join(SRC, 'assets', 'shot-run.webp'), 'assets: 立即执行分区截图'],
  ['assets/shot-accounts.webp', path.join(SRC, 'assets', 'shot-accounts.webp'), 'assets: 账户分区截图'],
  ['assets/shot-mentions.webp', path.join(SRC, 'assets', 'shot-mentions.webp'), 'assets: @ 名单分区截图'],
  ['assets/shot-task.webp', path.join(SRC, 'assets', 'shot-task.webp'), 'assets: 任务参数分区截图'],
  ['assets/shot-ai.webp', path.join(SRC, 'assets', 'shot-ai.webp'), 'assets: AI 接口分区截图'],
  ['assets/shot-skin.webp', path.join(SRC, 'assets', 'shot-skin.webp'), 'assets: 配色分区截图'],
  ['assets/shot-log.webp', path.join(SRC, 'assets', 'shot-log.webp'), 'assets: 日志分区截图'],
  ['tools/push-rv.mjs', path.join(SRC, 'tools', 'push-rv.mjs'), 'tools: 推送脚本'],
  ['tools/push-rv-docs.mjs', path.join(SRC, 'tools', 'push-rv-docs.mjs'), 'tools: 补推文档脚本'],
  ['tools/enable-pages.mjs', path.join(SRC, 'tools', 'enable-pages.mjs'), 'tools: Pages 开关脚本'],
  ['tools/shot-console.mjs', path.join(SRC, 'tools', 'shot-console.mjs'), 'tools: 控制台截图脚本'],
  ['tools/crop-console.py', path.join(SRC, 'tools', 'crop-console.py'), 'tools: 截图裁剪脚本'],
  ['tools/scroll-check.mjs', path.join(SRC, 'tools', 'scroll-check.mjs'), 'tools: 滚动效果断言脚本'],
];

let ok = 0;
for (const [rel, abs, msg] of targets) {
  if (!fs.existsSync(abs)) {
    console.error(`[缺文件] ${abs}`);
    continue;
  }
  try {
    const r = await putFile(rel, abs, msg);
    console.log(`[OK] ${r.path}  ${r.size} B  commit ${r.commit}`);
    ok++;
  } catch (e) {
    console.error(`[FAIL] ${e.message}`);
  }
}
console.log(`\n推送完成: ${ok}/${targets.length}`);
