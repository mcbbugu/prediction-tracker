// 承诺还是预测。规则能判的不打模型；判不了才走 KIND_V1，结果进 011 的缓存。
import { ArkStopped, arkJson } from "../core/ark";
import { sql } from "../core/db";
import { orgKey } from "../interests/orgs";

export const KIND_V1 = "KIND_V1";
export type ClaimKind = "promise" | "forecast" | "uncertain";

export type OrgTie = {
  name: string;
  nameZh: string;
  orgKey: string;
  started: string | null;
  ended: string | null;
  endKind: string | null;
};

const PROMPT = [
  "判断这句话是承诺还是预测。只根据给出的主体、原话，以及说话当天他任职或控股的机构。",
  "promise：结果在说话人本人，或这些机构的控制之内。",
  "forecast：结果不在他控制之内，例如行业、对手、宏观，或一项技术何时出现。",
  "uncertain：信息不够，无法判断控制权在谁。",
  '输出 JSON：{"kind":"promise","reason":"一句话"}。kind 只能是 promise、forecast、uncertain。',
].join("\n");

function fold(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

function sameLabel(subject: string, label: string) {
  const left = fold(subject);
  const right = fold(label);
  if (!left || !right) return false;
  if (left === right) return true;
  const a = orgKey(subject);
  const b = orgKey(label);
  return a.length >= 2 && a === b;
}

export function activeOn(tie: Pick<OrgTie, "started" | "ended" | "endKind">, on: string) {
  if (tie.started && tie.started > on) return false;
  if (tie.ended && tie.ended !== "present" && tie.ended < on) return false;
  if ((!tie.ended || tie.ended === "present") && tie.endKind === "ended") return false;
  return true;
}

// null：规则判不了，交给模型。
function mentions(text: string, label: string) {
  if (sameLabel(text, label)) return true;
  const needle = fold(label);
  if (needle.length < 3) return false;
  const hay = fold(text);
  if (/[a-z]/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay);
  }
  return hay.includes(needle);
}

export function classifyByRule(input: { subject: string; quote?: string; personName: string; personNameEn: string; orgs: OrgTie[]; saidOn: string }): { kind: ClaimKind; reason: string } | null {
  const subject = input.subject.trim();
  const quote = input.quote ?? "";
  if (!subject && !quote.trim()) return null;
  if (subject && (mentions(subject, input.personName) || mentions(subject, input.personNameEn))) {
    return { kind: "promise", reason: "主体是本人，结果在他控制之内。" };
  }
  const named = (text: string) => input.orgs.filter((org) => mentions(text, org.name) || mentions(text, org.nameZh));
  const inSubject = named(subject);
  const inQuote = named(quote);
  if ([...inSubject, ...inQuote].some((org) => activeOn(org, input.saidOn))) {
    return { kind: "promise", reason: "说到的是他说话当天任职或控股的机构。" };
  }
  if (inSubject.length > 0) {
    return { kind: "forecast", reason: "主体是他已经离开的机构，说话时结果不在他控制之内。" };
  }
  if (!subject) return null;
  return { kind: "forecast", reason: "主体不是本人，也不是他任职或控股的机构。" };
}

export function readKind(raw: unknown): { kind: ClaimKind; reason: string } {
  const record = raw && typeof raw === "object" ? (raw as { kind?: unknown; reason?: unknown }) : {};
  const kind = record.kind === "promise" || record.kind === "forecast" || record.kind === "uncertain" ? record.kind : "uncertain";
  const reason = String(record.reason ?? "").trim() || (kind === "uncertain" ? "模型无法判断控制权在谁。" : "模型根据原话判断。");
  return { kind, reason };
}

export async function classifyByModel(input: { subject: string; personName: string; quote: string; saidOn: string; orgs: OrgTie[] }) {
  try {
    const answer = await arkJson(
      PROMPT,
      JSON.stringify({
        person: input.personName,
        said_on: input.saidOn,
        subject: input.subject,
        quote: input.quote,
        orgs: input.orgs.filter((org) => activeOn(org, input.saidOn)).map((org) => org.nameZh || org.name),
      }),
      400,
      KIND_V1,
    );
    return readKind(answer);
  } catch (error) {
    if (error instanceof ArkStopped) throw error;
    return { kind: "uncertain" as const, reason: "判别时模型没有返回可用结果。" };
  }
}

export async function classifyStored(claimId: string) {
  const [claim] = await sql<
    { person_id: string; name: string; name_en: string; quote_zh: string; quote_en: string; said_on: string; subject: string | null }[]
  >`
    SELECT c.person_id, p.name, p.name_en, c.quote_zh, c.quote_en,
           to_char(c.published_date, 'YYYY-MM-DD') AS said_on,
           pr.subject
    FROM claims c
    JOIN people p ON p.id = c.person_id
    LEFT JOIN propositions pr ON pr.claim_id = c.id AND pr.superseded_by IS NULL
    WHERE c.id = ${claimId}
    LIMIT 1
  `;
  if (!claim) return { kind: "uncertain" as const, reason: "库里没有这条主张。" };
  const orgs = await loadOrgs(claim.person_id);
  const ruled = classifyByRule({
    subject: claim.subject ?? "",
    quote: claim.quote_zh || claim.quote_en,
    personName: claim.name,
    personNameEn: claim.name_en,
    orgs,
    saidOn: claim.said_on,
  });
  if (ruled) return ruled;
  return classifyByModel({
    subject: claim.subject ?? "",
    personName: claim.name,
    quote: claim.quote_zh || claim.quote_en,
    saidOn: claim.said_on,
    orgs,
  });
}

export async function loadOrgs(personId: string) {
  const rows = await sql<{ counterparty: string; counterparty_zh: string; org_key: string | null; started: string | null; ended: string | null; end_kind: string | null }[]>`
    SELECT counterparty, counterparty_zh, org_key, started, ended, end_kind
    FROM interests
    WHERE person_id = ${personId} AND publication = 'published' AND superseded_at IS NULL AND kind IN ('role', 'holding')
  `;
  return rows.map((row) => ({
    name: row.counterparty,
    nameZh: row.counterparty_zh,
    orgKey: row.org_key ?? "",
    started: row.started,
    ended: row.ended,
    endKind: row.end_kind,
  }));
}
