from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 960, 720
BG = (23, 24, 27)
CARD = (35, 37, 41)
CARD2 = (42, 44, 49)
BORDER = (68, 71, 78)
TEXT = (232, 233, 236)
MUTED = (154, 160, 166)
GREEN = (127, 211, 154)
GREEN_BG = (42, 74, 56)
ORANGE = (208, 138, 46)

font_dir = Path(r"C:\Windows\Fonts")
def load(name, size):
    return ImageFont.truetype(str(font_dir / name), size)

f_title = load("malgunbd.ttf", 25)
f_h2 = load("malgunbd.ttf", 16)
f_bold = load("malgunbd.ttf", 13)
f_body = load("malgun.ttf", 13)
f_small = load("malgun.ttf", 12)
f_tiny = load("malgun.ttf", 11)
f_mono = load("segoeui.ttf", 12)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

def rounded(x, y, w, h, r, fill, outline=None, width=1):
    d.rounded_rectangle((x, y, x + w, y + h), radius=r, fill=fill, outline=outline, width=width)

def text(x, y, value, font, fill=TEXT, anchor=None):
    d.text((x, y), value, font=font, fill=fill, anchor=anchor)

def chip(x, y, label, fg, bg, font=f_tiny, padx=7, h=20):
    tw = d.textlength(label, font=font)
    rounded(x, y, int(tw) + padx * 2, h, 5, bg)
    text(x + padx, y + (h - font.size) / 2 - 1, label, font, fg)
    return int(tw) + padx * 2

# Header
text(44, 34, "Session sync", f_title)
rounded(820, 34, 96, 30, 7, CARD2, BORDER)
text(836, 42, "한국어 ▾", f_body)
text(44, 74, "DSH 세션과 워크스페이스 체크포인트를 개인 허브와 동기화합니다.", f_body, MUTED)

# Mode row
x = 44
for label, active in [("호스트", True), ("클라이언트", False), ("끔", False)]:
    tw = int(d.textlength(label, font=f_body)) + 24
    rounded(x, 105, tw, 30, 6, CARD2 if active else CARD, BORDER)
    text(x + 12, 112, label, f_body, TEXT if active else MUTED)
    x += tw + 6
rounded(x, 105, 92, 30, 6, CARD2, BORDER)
text(x + 14, 112, "모드 적용", f_body)
text(x + 108, 112, "현재: 호스트 동작 중 (본체 동기화 포함)", f_small, MUTED)

# Main card
rounded(36, 158, 888, 505, 10, CARD, BORDER)
text(56, 176, "공유 워크스페이스", f_h2)
text(56, 207, "경로", f_small, MUTED)
rounded(56, 225, 848, 36, 7, BG, BORDER)
text(68, 235, r"C:\Users\yamsengyi\Documents\deepseek-harness\sync-default", f_mono)

# Buttons
bx = 56
for label, primary in [("현재 세션 경로", False), ("워크스페이스 지정", True), ("동기화 해제", False)]:
    tw = int(d.textlength(label, font=f_small)) + 26
    rounded(bx, 275, tw, 30, 6, CARD2 if primary else BG, BORDER)
    text(bx + 13, 282, label, f_small, TEXT)
    bx += tw + 8
text(56, 317, "공유중(동기화중) · sync-default-892a1b", f_small, GREEN)

# Group: shared
text(56, 355, "공유 프로젝트", f_bold, MUTED)
rounded(56, 378, 848, 40, 7, CARD2, BORDER)
text(70, 390, r"C:\Users\yamsengyi\Documents\deepseek-harness\sync-default", f_mono)
chip(742, 387, "공유중(동기화중)", GREEN, GREEN_BG)

# Group: local
text(56, 438, "로컬 프로젝트", f_bold, MUTED)
for i, path in enumerate([
    r"C:\Users\yamsengyi\Documents\deepseek-harness\default-workspace",
    r"C:\Users\yamsengyi\Documents\deepseek-harness\plugin-forge",
]):
    y = 461 + i * 48
    rounded(56, y, 848, 40, 7, CARD, BORDER)
    text(70, y + 12, path, f_mono)
    chip(770, y + 10, "공유하지 않음", MUTED, CARD2)

# Footer
text(44, 680, "Session sync v0.7.0 · protocol 1", f_tiny, MUTED)
text(916, 680, "B안 샘플 · 실제 화면과 다를 수 있음", f_tiny, MUTED, anchor="ra")

out = Path("docs/assets/projects-b-sample.png")
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out)
print(out)
