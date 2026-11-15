# -*- coding: utf-8 -*-
"""立绘后期清理：去白边 + 还原白衬衫 + 清碎点。

背景：素材是白底生成的，抗锯齿边缘的 RGB 混了白色，直接放到草地上会有一圈浅灰描边；
另外早前做明度统一时把白衬衫也压暗了（阴影处发灰发黑）。

处理顺序：
1) 边缘去白：按 alpha 反预乘把混进去的白色扣掉。
   **只在 alpha 足够高时做，并且给结果设下限** —— alpha 很低时 (v-(1-a)*255)/a 会变成负数，
   截断后就是一圈纯黑边（上一版正是栽在这里，边缘亮度 P10 直接掉到 0）。
2) 边缘收 0.2px，压掉残留的浅色描边。
3) 白衬衫回白：只对腰部以上、低饱和、够亮的像素往白里提，暖色开衫不动；
   只在完全不透明的像素上做，避免把边缘提亮成白圈。
4) 清碎点：面积小于 12 像素的孤岛直接抹掉。

用法：python clean-sprite.py a.png b.png ...（原地修改）
"""
import sys
from collections import deque

from PIL import Image

MIN_BLOB = 12          # 小于这个面积的不透明块视为噪点
EDGE_FLOOR = 0.55      # 反预乘结果不低于原值的这个比例，防止压成黑色


def clean(path, shirt=True):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    src = im.copy().load()
    px = im.load()

    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue

            # ---- 1) 边缘去白（低 alpha 不动，且设下限）----
            if a < 255:
                af = a / 255.0
                if af >= 0.35:
                    t = min(1.0, (af - 0.35) / 0.45)   # alpha 越低越相信原像素
                    out = []
                    for v in (r, g, b):
                        fg = (v - 255.0 * (1 - af)) / af
                        fg = max(v * EDGE_FLOOR, min(255.0, fg))
                        out.append(v * (1 - t) + fg * t)
                    r, g, b = out
                # ---- 2) 收边 ----
                a = max(0, min(255, int((a - 20) * 255 / 235)))
                if a == 0:
                    px[x, y] = (0, 0, 0, 0)
                    continue

            # ---- 3) 白衬衫回白（只在不透明像素上）----
            if shirt and a >= 250 and 0.16 * h < y < 0.60 * h:
                mx, mn = max(r, g, b), min(r, g, b)
                sat = mx - mn
                if sat <= 30 and mx > 140:
                    k = min(1.0, (30 - sat) / 30.0)
                    depth = min(1.0, (mx - 140) / 115.0)
                    weight = k * depth * 0.55
                    r = r + (255 - r) * weight
                    g = g + (255 - g) * weight
                    b = b + (255 - b) * weight

            px[x, y] = (int(r), int(g), int(b), int(a))

    # ---- 4) 清碎点 ----
    seen = [[False] * w for _ in range(h)]
    blobs = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or px[x, y][3] == 0:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            cells = []
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            blobs.append(cells)

    removed = 0
    if blobs:
        biggest = max(len(c) for c in blobs)
        for cells in blobs:
            if len(cells) < MIN_BLOB and len(cells) < biggest * 0.02:
                for cx, cy in cells:
                    px[cx, cy] = (0, 0, 0, 0)
                removed += 1

    im.save(path)
    return w, h, removed


if __name__ == '__main__':
    for p in sys.argv[1:]:
        w, h, rm = clean(p)
        print(f'{p}  {w}x{h}  清掉碎点 {rm} 处')
