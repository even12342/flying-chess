"""Fix two issues circled by user in yellow base top-right:
1) Plane visual center offset (nose+prop longer than tail) -> add small Y nudge
2) Base rect doesn't fill corner (inset 22px) -> expand to touch board edges"""
import re

with open('public/client.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Plane Y nudge - compensate for visual center being ~1.5px above origin
old_plane = '''    const y = r * C + C / 2;
    list.forEach((o, k) => {
      const off = list.length > 1 ? (k - (list.length - 1) / 2 * 13) : 0;'''
new_plane = '''    const y = r * C + C / 2;
    list.forEach((o, k) => {
      const off = list.length > 1 ? (k - (list.length - 1) / 2 * 13) : 0;
      // 视觉居中修正：planeSVG 机头+螺旋桨(-20.5)比尾部(17.5)长，视觉重心偏上~1.5px
      const ny = y + 1.6;'''

if old_plane not in content:
    print('ERROR: plane code block not found!')
    exit(1)

content = content.replace(old_plane, new_plane, 1)

# Fix 2: Update data-y to use nudged ny
old_datay = 'data-x="${x + off}" data-y="${y}"'
new_datay = 'data-x="${x + off}" data-y="${ny}"'

if old_datay not in content:
    print('ERROR: data-y template not found!')
    exit(1)

content = content.replace(old_datay, new_datay, 1)

# Fix 3: Expand base rects to fill board corners (match reference image)
# Yellow(top-right) & Blue(bottom-right): push x to right edge
# Green(top-left) & Red(bottom-left): push y to top/bottom edge
old_base = '''  const BASE_RECTS = {
    green:  { x: 0.55 * C, y: 0.55 * C },
    yellow: { x: 10.55 * C, y: 0.55 * C },
    red:    { x: 0.55 * C, y: 10.55 * C },
    blue:   { x: 10.55 * C, y: 10.55 * C },
  };'''

new_base = '''  // 基地矩形：扩展到贴齐棋盘四角（匹配参考图），同时保持包围 B.BASE 2×2 居中
  const BASE_RECTS = {
    green:  { x: 0,           y: 0 },            // 左上：贴左+贴上
    yellow: { x: 11 * C - 2,  y: 0 },            // 右上：贴右(从col11起) + 贴上
    red:    { x: 0,           y: 11 * C - 2 },    // 左下：贴左 + 贴下(从row11起)
    blue:   { x: 11 * C - 2,  y: 11 * C - 2 },   // 右下：贴右 + 贴下
  };'''

if old_base not in content:
    print('ERROR: BASE_RECTS not found!')
    exit(1)

content = content.replace(old_base, new_base, 1)

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('All 3 fixes applied:')
print('  1. Plane Y nudge: +1.6px to compensate visual center offset')
print('  2. data-y uses nudged value')
print('  3. Base rects expanded to fill board corners')
