/**
 * 补推 README / LICENSE / .gitignore 到 BILI-STUDIO-RV，然后开 GitHub Pages。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKEN = process.env.GH_TOKEN;
const REPO = 'luowenjie114514-dotcom/BILI-STUDIO-RV';
const SRC = path.join(ROOT, '_testrun', 'rv');
const API = 'https://api.github.com';

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'bili-studio-rv-deploy',
};

async function putFile(relPath, absPath, message) {
  const content = fs.readFileSync(absPath);
  const url = `${API}/repos/${REPO}/contents/${relPath}`;
  const getRes = await fetch(url, { headers });
  let sha;
  if (getRes.status === 200) sha = (await getRes.json()).sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content: content.toString('base64'), ...(sha ? { sha } : {}), branch: 'main' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return { path: relPath, commit: body.commit?.sha?.slice(0, 7) };
}

for (const [rel, abs, msg] of [
  ['README.md', path.join(SRC, 'README.md'), 'docs: README（结构 / 设计说明 / 素材版权）'],
  ['LICENSE', path.join(SRC, 'LICENSE'), 'chore: MIT License'],
  ['.gitignore', path.join(SRC, '.gitignore'), 'chore: gitignore'],
]) {
  try {
    const r = await putFile(rel, abs, msg);
    console.log(`[OK] ${r.path}  commit ${r.commit}`);
  } catch (e) {
    console.error(`[FAIL] ${e.message}`);
  }
}

// 开 Pages（GitHub Actions 部署，避免 legacy 分支模式在新仓库上偶发 404）
const pagesRes = await fetch(`${API}/repos/${REPO}/pages`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ build_type: 'legacy', source: { branch: 'main', path: '/' } }),
});
console.log(`\n[Pages] HTTP ${pagesRes.status}`);
const pagesBody = await pagesRes.text();
console.log(pagesBody.slice(0, 400));

// 保险起见再请求一次 workflow 方式
if (!pagesRes.ok) {
  const wfRes = await fetch(`${API}/repos/${REPO}/pages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ build_type: 'workflow' }),
  });
  console.log(`[Pages/workflow] HTTP ${wfRes.status}`);
  console.log((await wfRes.text()).slice(0, 400));
}
