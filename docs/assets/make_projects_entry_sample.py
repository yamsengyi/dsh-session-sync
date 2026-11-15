from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 1000, 700
BG = (23, 24, 27)
SIDEBAR = (29, 30, 34)
CARD = (35, 37, 41)
CARD2 = (42, 44, 49)
BORDER = (68, 71, 78)
TEXT = (232, 233, 236)
MUTED = (154, 160, 166)
GREEN = (127, 211, 154)
GREEN_BG = (42, 74, 56)

font_dir = Path(r"C:\Windows\Fonts")
def load(name, size):
    return ImageFont.truetype(str(font_dir / name), size)

f_h1 = load("malgunbd.ttf", 16)
f_h2 = load("malgunbd.ttf", 20)
f_bold = load("malgunbd.ttf", 12)
f_body = load("malgun.ttf", 12)
f_small = load("malgun.ttf", 11)
f_tiny = load("malgun.ttf", 10)
f_mono = load("segoeui.ttf", 12)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

def rounded(x, y, w, h, r, fill, outline=None, width=1):
    d.rounded_rectangle((x, y, x + w, y + h), radius=r, fill=fill, outline=outline, width=width)

def text(x, y, value, font, fill=TEXT, anchor=None):
    d.text((x, y), value, font=font, fill=fill, anchor=anchor)

def chip(x, y, label, fg, bg, font=f_tiny, padx=6, h=18):
    tw = d.textlength(label, font=font)
    rounded(x, y, int(tw) + padx * 2, h, 4, bg)
    text(x + padx, y + (h - font.size) / 2 - 1, label, font, fg)
    return int(tw) + padx * 2

# Sidebar
d.rectangle((0, 0, 259, H), fill=SIDEBAR)
d.line((259, 0, 259, H), fill=BORDER)
rounded(18, 20, 22, 22, 6, CARD2, BORDER)
text(48, 23, "DeepSeek Harness", f_h1)
text(18, 78, "Workspaces", f_bold, MUTED)

# New session row with Projects button
rounded(18, 101, 150, 32, 7, CARD2, BORDER)
text(34, 109, "＋  새 세션", f_body)
rounded(174, 101, 68, 32, 7, BG, BORDER)
text(186, 109, "프로젝트", f_body)

# Session rows with badges
rows = [
    (r"C:\...\sync-default", "공유", GREEN, GREEN_BG),
    (r"C:\...\plugin-forge", "공유", GREEN, GREEN_BG),
    (r"C:\...\default-workspace", "로컬", MUTED, CARD2),
]
for i, (path, label, fg, bg) in enumerate(rows):
    y = 150 + i * 40
    rounded(18, y, 224, 32, 6, CARD if i else CARD2, None)
    text(30, y + 9, path, f_mono)
    chip(212, y + 8, label, fg, bg)

# Footer account area
rounded(14, 640, 232, 38, 8, CARD)
text(30, 653, "Signed in to DeepSeek", f_small, MUTED)

# Dim overlay
overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)
od.rectangle((0, 0, W, H), fill=(0, 0, 0, 150))
img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
d = ImageDraw.Draw(img)

# Modal
mx, my, mw, mh = 318, 105, 630, 470
rounded(mx, my, mw, mh, 12, (35, 37, 41), BORDER)
text(mx + 18, my + 16, "프로젝트", f_h2)
rounded(mx + mw - 74, my + 16, 56, 28, 6, BG, BORDER)
text(mx + mw - 61, my + 22, "닫기", f_small)
d.line((mx + 18, my + 56, mx + mw - 18, my + 56), fill=BORDER)

text(mx + 18, my + 72, "공유 프로젝트", f_bold, MUTED)
rounded(mx + 18, my + 92, mw - 36, 38, 6, CARD2, BORDER)
text(mx + 30, my + 102, r"C:\Users\yamsengyi\Documents\deepseek-harness\sync-default", f_mono)
chip(mx + mw - 150, my + 100, "공유중(동기화중)", GREEN, GREEN_BG)

text(mx + 18, my + 150, "로컬 프로젝트", f_bold, MUTED)
for i, path in enumerate([
    r"C:\Users\yamsengyi\Documents\deepseek-harness\default-workspace",
    r"C:\Users\yamsengyi\Documents\deepseek-harness\plugin-forge",
]):
    y = my + 170 + i * 44
    rounded(mx + 18, y, mw - 36, 38, 6, CARD, BORDER)
    text(mx + 30, y + 10, path, f_mono)
    chip(mx + mw - 100, y + 10, "공유하지 않음", MUTED, CARD2)

text(mx + 18, my + mh - 28, "사이드바 New session 옆 Projects 버튼", f_tiny, MUTED)
text(970, 680, "새 위치 샘플 · 실제 화면과 다를 수 있음", f_tiny, MUTED, anchor="ra")

out = Path("docs/assets/projects-entry-sample.png")
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out)
print(out)
