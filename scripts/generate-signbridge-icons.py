from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "images"
SCALE = 3
SIZE = 1024
NAVY = (22, 38, 49, 255)
MINT = (133, 211, 183, 255)
WHITE = (255, 255, 255, 255)


def curve_points(start, control, end, samples=100):
    points = []
    for step in range(samples + 1):
        t = step / samples
        one_minus_t = 1 - t
        x = one_minus_t**2 * start[0] + 2 * one_minus_t * t * control[0] + t**2 * end[0]
        y = one_minus_t**2 * start[1] + 2 * one_minus_t * t * control[1] + t**2 * end[1]
        points.append((round(x * SCALE), round(y * SCALE)))
    return points


def mark(image, color=MINT):
    draw = ImageDraw.Draw(image)
    arch = curve_points((282, 654), (512, 254), (742, 654))
    draw.line(arch, fill=color, width=38 * SCALE, joint="curve")
    radius = 32 * SCALE
    for x in (282, 742):
        center = (x * SCALE, 654 * SCALE)
        draw.ellipse(
            (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
            fill=WHITE if color == MINT else color,
        )
    draw.rounded_rectangle(
        (374 * SCALE, 712 * SCALE, 650 * SCALE, 740 * SCALE),
        radius=14 * SCALE,
        fill=color,
    )


def save_icon(path: Path, background=None, foreground=MINT):
    canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), background or (0, 0, 0, 0))
    mark(canvas, foreground)
    canvas = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    canvas.save(path, optimize=True)


OUTPUT.mkdir(parents=True, exist_ok=True)
save_icon(OUTPUT / "icon.png", background=NAVY)
save_icon(OUTPUT / "splash-icon.png", background=None, foreground=NAVY)
save_icon(OUTPUT / "android-icon-foreground.png", background=None)
save_icon(OUTPUT / "android-icon-monochrome.png", background=None, foreground=WHITE) 

