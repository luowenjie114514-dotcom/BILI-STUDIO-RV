/**
 * 重试开启 BILI-STUDIO-RV 的 GitHub Pages。
 * 主人已给 token 补了 Pages 权限，所以这里再试一次 POST /repos/{repo}/pages。
 */
const TOKEN = process.env.GH_TOKEN;
const REPO = 'luowenjie114514-dotcom/BILI-STUDIO-RV';
const API = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'bili-studio-rv-deploy',
};

async function tryEnable(buildType, extra) {
  const res = await fetch(`${API}/repos/${REPO}/pages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ build_type: buildType, ...(extra || {}) }),
  });
  const text = await res.text();
  console.log(`[${buildType}] HTTP ${res.status}`);
  if (text) console.log(text.slice(0, 500));
  return res.status;
}

// 方案 1：legacy 分支模式（静态站最简单，不需要 Actions）
const s1 = await tryEnable('legacy', { source: { branch: 'main', path: '/' } });
if (s1 >= 400) {
  // 方案 2：GitHub Actions 模式
  const s2 = await tryEnable('workflow');
  if (s2 >= 400) {
    console.error('\n两种方式都失败，token 的 Pages 权限可能还没生效（GitHub 权限刷新有延迟），稍后重试。');
    process.exit(1);
  }
}

// 等几秒读回状态
await new Promise((r) => setTimeout(r, 3000));
const st = await fetch(`${API}/repos/${REPO}/pages`, { headers });
console.log(`\n[状态回读] HTTP ${st.status}`);
if (st.status === 200) {
  const b = await st.json();
  console.log(`html_url : ${b.html_url}`);
  console.log(`status   : ${b.status}`);
  console.log(`source   : ${JSON.stringify(b.source)}`);
}
