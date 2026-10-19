# 🐳 BILI-STUDIO-RV

**NASA-PUNK × 瑞士国际主义 × 新野兽派** —— 蓝色大肥鱼·自动化搬史 宣传页。

这是 [BILI-STUDIO](https://github.com/luowenjie114514-dotcom/BILI-STUDIO) 的静态落地页，
独立成仓，与原仓库完全解耦：单文件 HTML + 4 张 webp 素材，没有任何构建步骤。

## 在线访问

<https://luowenjie114514-dotcom.github.io/BILI-STUDIO-RV/>

## 页面结构

| 区块 | 内容 |
| --- | --- |
| HUD 顶栏 | 品牌 `WHALE-LOGISTICS` / 导航 / 深浅主题切换 |
| Hero | 主立绘 + 副立绘错位斜挂 + 纵向刻度装饰 |
| 01 总览 | 6 张能力卡 |
| 02 流水线 | 4 步搬运流程 |
| 03 载荷对照 | 左 AI 原稿 / 右实际发送 |
| 04 分区图 | 12 窗格界面示意 |
| 05 接口表 | B 站接口清单 |
| 06 风控 | 限流与风控策略 |
| 07 飞行记录 | 版本时间线 |
| 08 图像源 | 4 张鲸鱼娘立绘出处与规格 |

## 设计说明

- **NASA-PUNK**：HUD 顶栏、星点网格、扫描线、磷光发光、等宽字标签、区块编号
- **瑞士国际主义**：严格的网格对齐、`Archivo Black` 粗体标题、留白即呼吸
- **新野兽派**：2px 粗描边、硬阴影、无渐变、高对比撞色
- 双主题：深色 = 真空黑 `#050a12` + 鲸蓝磷光 `#4fc3f7`；浅色 = 浅白 + 海军蓝 `#0b2a4a` + 雅各宾红 `#b01a1a`
- 主题写入 `localStorage['nasapunk.theme']`，刷新保持

## 素材

`assets/` 下 4 张鲸鱼娘同人图，来源 [蓝色大肥鱼.com](https://蓝色大肥鱼.com)（非官方图库），
版权归原作者所有，仅用于本地演示，**不得商用或二次分发**。

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `whale-main.webp` | 1024×1536 | Hero 主立绘 |
| `whale-maid.webp` | 696×1150 | Hero 副立绘（女仆装，抠白边） |
| `whale-token.webp` | 1008×1118 | 图像源区块（抠白边） |
| `whale-avatar.webp` | 512×512 | 图像源区块（圆框全身） |

## 本地预览

不需要服务器，直接打开 `index.html` 即可。想走本地服务：

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## License

页面代码见 [LICENSE](./LICENSE)。插画素材版权归原作者，见上。
