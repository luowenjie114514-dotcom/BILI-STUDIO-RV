# -*- coding: utf-8 -*-
"""crop-console.py

把 _testrun/con-*.png（headless Edge 截的真实控制台，整张都是内容无浏览器边框）
压成 webp 供 README / 宣传页使用。

分两档：
  全貌图 console-full.webp —— 原尺寸压，用作 README 首屏大图
  分区图 console-*.webp   —— 原尺寸压，供 README 折叠块和宣传页「可互动演示」用
"""
import os
from PIL import Image

SRC = '_testrun'
DST = 'docs/screenshots'
os.makedirs(DST, exist_ok=True)

# 源文件 -> 目标名（不带 webp 后缀）
MAP = {
    'con-all':  'console-full',
    'con-run':  'console-run',
    'con-acc':  'console-accounts',
    'con-men':  'console-mentions',
    'con-pref': 'console-pref',
    'con-style': 'console-style',
    'con-task': 'console-task',
    'con-sch':  'console-sched',
    'con-ai':   'console-ai',
    'con-skin': 'console-skin',
    'con-log':  'console-log',
    'con-hist': 'console-history',
}

total = 0
for src, name in MAP.items():
    p = os.path.join(SRC, src + '.png')
    if not os.path.exists(p):
        print('[skip] %s 不存在' % src)
        continue
    im = Image.open(p).convert('RGB')
    out = os.path.join(DST, name + '.webp')
    im.save(out, 'WEBP', quality=86, method=6)
    kb = os.path.getsize(out) // 1024
    total += kb
    print('%-24s %s  %dKB' % (name + '.webp', im.size, kb))

print('\ndocs/screenshots 合计 %d KB' % total)
