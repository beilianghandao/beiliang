# -*- coding: utf-8 -*-
"""把白底立绘抠成透明 PNG，并做两帧之间的对齐。
用法：python tools/matte.py <in1> <in2> <out1> <out2>
对齐依据：头部（最上面 18% 的不透明区域）的水平中心，避免两帧切换时人物左右跳。
"""
import sys
from collections import deque
from PIL import Image

THRESH = 242      # 背景 #fafafa 左右，白鞋有深色描边挡着，泛洪进不去
TARGET_H = 700     # 处理用的中间尺寸
ALIGN_H = 460      # 旧参数，保留以兼容
ALIGN_HEAD_W = 78  # 输出时统一的头宽（两帧按头宽对齐，腿姿不影响）


def flood(img):
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    q = deque()

    def white(x, y):
        r, g, b, a = px[x, y]
        return r >= THRESH and g >= THRESH and b >= THRESH

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and white(x, y):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and white(x, y):
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and white(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))


def edge_soften(img):
    """紧贴透明区的实心像素降一点 alpha，消掉白边锯齿"""
    w, h = img.size
    px = img.load()
    src = img.copy().load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] == 0:
                    px[x, y] = (r, g, b, 176)
                    break


def keep_main_blobs(img, keep_ratio=0.04):
    """只保留面积够大的连通块。
    生成图里常散落单像素杂点（水印残渣、噪点），它们会把 getbbox 撑大，
    归一化后人物本体就被缩小，两帧一高一矮。"""
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    blobs = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or px[x, y][3] <= 28:
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            cells = []
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny][3] > 28:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            blobs.append(cells)
    if not blobs:
        return
    biggest = max(len(b) for b in blobs)
    for cells in blobs:
        if len(cells) < biggest * keep_ratio:
            for cx, cy in cells:
                px[cx, cy] = (255, 255, 255, 0)


def trim_spikes(img, min_ratio=0.02):
    """按「有效行」重新裁上下边。
    生成图顶部常拖一根发丝或水印笔画，getbbox 会把它算进人物高度，
    归一化后人物本体被压小 —— 表现就是两帧切换时忽大忽小。"""
    w, h = img.size
    px = img.load()
    need = max(4, int(w * min_ratio))
    rows = [sum(1 for x in range(w) if px[x, y][3] > 40) for y in range(h)]
    top = next((y for y in range(h) if rows[y] >= need), 0)
    bot = next((y for y in range(h - 1, -1, -1) if rows[y] >= need), h - 1)
    return img.crop((0, top, w, bot + 1))


def head_width(img):
    """顶部 15% 区域每行横向跨度的中位数，作为「头宽」基准。
    比整体高度稳：腿分开还是并拢，头的宽度都不会变。"""
    w, h = img.size
    px = img.load()
    spans = []
    for y in range(max(4, int(h * 0.15))):
        xs = [x for x in range(w) if px[x, y][3] > 40]
        if xs:
            spans.append(max(xs) - min(xs) + 1)
    if not spans:
        return 0
    spans.sort()
    return spans[len(spans) // 2] or max(spans)


def prepare(path):
    im = Image.open(path).convert('RGBA')
    ratio = TARGET_H / im.size[1]
    im = im.resize((int(im.size[0] * ratio), TARGET_H), Image.LANCZOS)
    flood(im)
    edge_soften(im)
    keep_main_blobs(im)
    # alpha 极低的杂点会把 getbbox 撑大，两帧高度就对不上了
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 28:
                px[x, y] = (255, 255, 255, 0)
    box = trim_spikes(im.crop(im.getbbox()))
    # 按「有效轮廓高度」归一：四角色身高一致（都是大学生），
    # 上面的 trim_spikes 已经保证高度不被发丝/水印笔画虚撑。
    r2 = ALIGN_H / box.size[1]
    return box.resize((max(1, int(box.size[0] * r2)), ALIGN_H), Image.LANCZOS)


def head_center_x(im):
    """取顶部 18% 区域的不透明像素水平中心，作为对齐基准"""
    w, h = im.size
    px = im.load()
    band = max(4, int(h * 0.18))
    xs = []
    for y in range(band):
        for x in range(w):
            if px[x, y][3] > 40:
                xs.append(x)
    return (min(xs) + max(xs)) // 2 if xs else w // 2


def align(im, ref_cx, out_w, out_h=None):
    """把头部中心平移到画布中心，脚底贴画布底"""
    cx = head_center_x(im)
    out_h = out_h or im.size[1]
    canvas = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
    canvas.paste(im, (out_w // 2 - cx, out_h - im.size[1]), im)
    return canvas


def main():
    a_path, b_path, a_out, b_out = sys.argv[1:5]
    a = prepare(a_path)
    b = prepare(b_path)
    out_w = max(a.size[0], b.size[0]) + 40
    # 画布取两帧最大高度，各自贴底（脚底对齐 person.y），头顶留白不一不影响
    out_h = max(a.size[1], b.size[1])
    a2 = align(a, None, out_w, out_h)
    b2 = align(b, None, out_w, out_h)
    a2.save(a_out)
    b2.save(b_out)
    for name, im in (('A', a2), ('B', b2)):
        print(f'{name}: {im.size[0]}x{im.size[1]}')


if __name__ == '__main__':
    main()
