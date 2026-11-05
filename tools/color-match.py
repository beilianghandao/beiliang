# -*- coding: utf-8 -*-
"""把走路帧的服装颜色对齐到站姿立绘。

AI 每次生成的色相/明度都会飘（同一件棕开衫能画成浅卡其），
所以不走「重新生成赌运气」，而是直接做 Lab 色彩迁移：
按人体纵向分区（上衣 / 下装），把走路帧每个区的均值与离散度
向站姿同区靠拢，只动颜色不动形状。

用法：python tools/color-match.py <站姿侧图> <走路帧A> <走路帧B> <输出A> <输出B>
"""
import sys

from PIL import Image

import matte

# 分区（相对人物高度的比例）：上衣、下装（含鞋）
BANDS = [(0.17, 0.52), (0.53, 0.99)]
STRENGTH = 0.88        # 迁移强度，1 = 完全对齐
STD_WEIGHT = 0.5       # 离散度跟随的权重，太大会把对比度拉坏


def srgb_to_lab(rgb):
    """rgb: 0..255 tuple -> (L, a, b)"""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(rgb[0]), lin(rgb[1]), lin(rgb[2])
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    x, y, z = x / 0.95047, y / 1.0, z / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_to_srgb(lab):
    L, a, b = lab
    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200

    def finv(t):
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787

    x, y, z = finv(fx) * 0.95047, finv(fy), finv(fz) * 1.08883
    r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
    g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
    bb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252

    def enc(c):
        c = max(0.0, min(1.0, c))
        v = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
        return int(round(max(0.0, min(255.0, v * 255))))

    return (enc(r), enc(g), enc(bb))


def band_mask(w, h, y0, y1):
    return (int(h * y0), int(h * y1))


def stats(im, y0, y1, skip_white=True):
    """统计某纵向区间内「像布料」的像素 Lab 均值与标准差"""
    px = im.load()
    w, h = im.size
    vals = []
    for y in range(y0, y1):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            L, aa, bb = srgb_to_lab((r, g, b))
            if skip_white:
                C = (aa * aa + bb * bb) ** 0.5
                if L > 88 and C < 10:      # 白衬衫、高光不算服装主色
                    continue
            vals.append((L, aa, bb))
    if len(vals) < 60:
        return None
    n = len(vals)
    mean = [sum(v[i] for v in vals) / n for i in range(3)]
    var = [sum((v[i] - mean[i]) ** 2 for v in vals) / n for i in range(3)]
    std = [x ** 0.5 for x in var]
    return mean, std


def transfer(im, y0, y1, src_mean, src_std, dst_mean, dst_std):
    px = im.load()
    w, h = im.size
    for y in range(y0, y1):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lab = list(srgb_to_lab((r, g, b)))
            out = []
            for i in range(3):
                v = lab[i]
                if dst_std[i] > 1e-3:
                    ratio = 1 + (src_std[i] / dst_std[i] - 1) * STD_WEIGHT
                    ratio = max(0.7, min(1.35, ratio))
                else:
                    ratio = 1.0
                v = src_mean[i] + (v - dst_mean[i]) * ratio
                out.append(lab[i] + (v - lab[i]) * STRENGTH)
            px[x, y] = lab_to_srgb(out) + (a,)




# ---------- 肤色对齐 ----------
# 站姿立绘按角色设定画了肤色（江野是偏深的小麦色），
# 走路帧是另外生成的，模型默认给白皮 → 一走就"换了个肤色的人"。
# 这里只在头部区间（脸/脖子）把走路帧的肤色挪到站姿的肤色上，衣服不动。
SKIN_BAND = (0.02, 0.24)


def is_skin(r, g, b):
    if not (r > g > b):
        return False
    if not (55 <= r <= 252 and 35 <= g <= 232 and 18 <= b <= 218):
        return False
    d = r - b
    return 10 <= d <= 92


def skin_median(im, y0, y1):
    w, h = im.size
    px = im.load()
    vals = []
    for y in range(int(h * y0), int(h * y1)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 180 or not is_skin(r, g, b):
                continue
            vals.append(srgb_to_lab((r, g, b)))
    if len(vals) < 40:
        return None
    vals.sort(key=lambda v: v[0])
    return vals[len(vals) // 2]


def skin_transfer(im, ref_lab, strength=0.95):
    if not ref_lab:
        return
    y0, y1 = SKIN_BAND
    cur = skin_median(im, y0, y1)
    if not cur:
        return
    d = [ref_lab[i] - cur[i] for i in range(3)]
    px = im.load()
    w, h = im.size
    for y in range(int(h * y0), int(h * y1)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 40 or not is_skin(r, g, b):
                continue
            lab = srgb_to_lab((r, g, b))
            new = [lab[i] + d[i] * strength for i in range(3)]
            px[x, y] = lab_to_srgb(new) + (a,)


def main():
    ref_path, a_path, b_path, a_out, b_out = sys.argv[1:6]
    ref = matte.prepare(ref_path)          # 与走路帧同高、同对齐方式
    a = Image.open(a_path).convert('RGBA')
    b = Image.open(b_path).convert('RGBA')

    for y0r, y1r in BANDS:
        rs = stats(ref, *band_mask(*ref.size, y0r, y1r))
        ds = stats(a, *band_mask(*a.size, y0r, y1r))
        if not rs or not ds:
            print('skip band', y0r, y1r)
            continue
        print('band %.2f-%.2f  ref L=%.1f  walk L=%.1f' % (y0r, y1r, rs[0][0], ds[0][0]))
        for im in (a, b):
            ds_img = stats(im, *band_mask(*im.size, y0r, y1r))
            if not ds_img:
                continue
            transfer(im, *band_mask(*im.size, y0r, y1r), rs[0], rs[1], ds_img[0], ds_img[1])

    ref_skin = skin_median(ref, *SKIN_BAND)
    print('skin ref', None if not ref_skin else [round(x, 1) for x in ref_skin])
    for im in (a, b):
        skin_transfer(im, ref_skin)

    a.save(a_out)
    b.save(b_out)
    print('saved', a_out.split('/')[-1], b_out.split('/')[-1])


if __name__ == '__main__':
    main()
