// node src/evidence/render.mjs <url>
// Opens one page in a local headless Chromium and prints JSON to stdout: { status, finalUrl, contentType, html }.
// Called by sources.ts as a fallback for pages that only show their text after JavaScript runs. Runs under Node
// (Playwright is not reliable under Bun) in its own process, so a hung page can simply be killed.
// No stealth tricks: if a site answers with a bot check, that is the answer.
import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: "en-US" });
  // Text is all we keep; skip images, media and fonts.
  await page.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  process.stdout.write(
    JSON.stringify({
      status: response?.status() ?? 0,
      finalUrl: page.url(),
      contentType: response?.headers()["content-type"] ?? "text/html",
      html: await page.content(),
    }),
  );
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error?.message ?? error).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
