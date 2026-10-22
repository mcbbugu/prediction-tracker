// Settings that differ between this laptop and a public deployment.

export const isProduction = process.env.NODE_ENV === "production";

// 本机模式（AUTO_PUBLISH=1）lets agent results go public without review or calibration. It exists for the
// local, not-yet-public site only (SPEC 核对分层); in production it must never be on.
export function localPublishMode() {
  return process.env.AUTO_PUBLISH === "1" && !isProduction;
}

// Called at the start of every long-running process (API, worker, batch).
export function assertSafeToStart(processName: string) {
  if (isProduction && process.env.AUTO_PUBLISH === "1") {
    throw new Error(`${processName}：生产环境不能开本机模式 AUTO_PUBLISH=1（机器判定会绕过校准门槛直接公开）。请去掉这个环境变量。`);
  }
  if (isProduction && (process.env.REVIEW_TOKEN ?? "").length < 24) {
    throw new Error(`${processName}：生产环境的 REVIEW_TOKEN 至少 24 个字符。`);
  }
}

// Origins allowed to call the API from a browser. CORS_ORIGINS="https://a.example,https://b.example";
// unset = reflect any origin (local development). The review endpoints are guarded by x-review-token either way.
export function corsOrigin(): true | string[] {
  const list = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
}
