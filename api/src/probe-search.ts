// Checks whether the configured Ark model can search the web. Run: pnpm api:probe
import { arkConfigured, arkPost, arkSearch } from "./ark";

const QUESTION =
  "特斯拉 Model 3 在 2023 年在中国的年交付量大约是多少？请联网搜索，回答时列出你引用的网页链接。";

if (!arkConfigured()) {
  console.log("缺少 ARK_API_KEY、ARK_BASE_URL 或 ARK_MODEL（写在 api/.env）");
  process.exit(1);
}

console.log(`模型 ${process.env.ARK_MODEL} · 接口 ${process.env.ARK_BASE_URL}`);
const started = Date.now();
try {
  const result = await arkSearch(QUESTION);
  console.log(`\n[responses + web_search] 成功，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`回答前 300 字：${result.text.slice(0, 300) || "（空）"}`);
  console.log(`找到链接 ${result.urls.length} 个：`);
  for (const url of result.urls.slice(0, 10)) console.log(`  ${url}`);
  const types = Array.isArray((result.raw as { output?: unknown[] }).output)
    ? ((result.raw as { output: { type?: string }[] }).output.map((item) => item.type).join(", "))
    : "无 output";
  console.log(`输出结构：${types}`);
} catch (error) {
  console.log(`\n[responses + web_search] 失败：${error instanceof Error ? error.message : error}`);
  try {
    const body = (await arkPost("/chat/completions", {
      model: process.env.ARK_MODEL,
      messages: [{ role: "user", content: QUESTION }],
      tools: [{ type: "web_search" }],
      thinking: { type: "disabled" },
    })) as { choices?: { message?: { content?: string } }[] };
    console.log(`[chat/completions + web_search] 成功：${(body.choices?.[0]?.message?.content || "").slice(0, 300)}`);
  } catch (fallback) {
    console.log(`[chat/completions + web_search] 也失败：${fallback instanceof Error ? fallback.message : fallback}`);
  }
}
