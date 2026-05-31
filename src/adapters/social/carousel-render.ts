export interface SlideInput {
  type: "hook" | "insight" | "stat" | "cta";
  text: string;
}

export interface BrandStyle {
  name: string;
  palette: { bg: string; card: string; accent: string; text: string; muted: string };
  handle: string;
}

/** A function that turns one slide's HTML into a PNG buffer. Real impl uses Playwright; tests inject a fake. */
export type RenderFn = (html: string) => Promise<Buffer>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Full standalone HTML document for one 1080x1350 slide. */
export function slideHtml(slide: SlideInput, index: number, total: number, brand: BrandStyle): string {
  const p = brand.palette;
  const isCover = slide.type === "hook";
  const isCta = slide.type === "cta";
  const accentBar = `<div style="width:80px;height:8px;background:${p.accent};border-radius:4px;margin-bottom:40px;"></div>`;
  const counter = `<div style="position:absolute;top:48px;right:56px;color:${p.muted};font-size:28px;">${index + 1}/${total}</div>`;
  const footer = `<div style="position:absolute;bottom:48px;left:56px;color:${p.muted};font-size:30px;">@${escapeHtml(brand.handle)}</div>`;
  const fontSize = isCover ? 84 : 60;
  const weight = isCover || isCta ? 800 : 600;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: Inter, Arial, sans-serif; }
  body { width:1080px; height:1350px; background:${p.bg}; color:${p.text}; }
  .slide { position:relative; width:1080px; height:1350px; padding:120px 56px; display:flex; flex-direction:column; justify-content:center; }
  .card { background:${p.card}; border-radius:32px; padding:64px; }
  .text { font-size:${fontSize}px; font-weight:${weight}; line-height:1.2; }
  .cta { color:${p.accent}; }
</style></head>
<body><div class="slide">
  ${counter}
  ${accentBar}
  <div class="card"><div class="text ${isCta ? "cta" : ""}">${escapeHtml(slide.text)}</div></div>
  ${footer}
</div></body></html>`;
}

/** Render each slide to a PNG buffer via the provided render function (defaults to Playwright). */
export async function renderCarousel(
  slides: SlideInput[],
  brand: BrandStyle,
  render: RenderFn = playwrightRender,
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < slides.length; i++) {
    buffers.push(await render(slideHtml(slides[i]!, i, slides.length, brand)));
  }
  return buffers;
}

/** Real renderer: launches Chromium, sets the HTML, screenshots a 1080x1350 viewport. */
export const playwrightRender: RenderFn = async (html: string): Promise<Buffer> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle" });
    const png = await page.screenshot({ type: "png" });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
};
