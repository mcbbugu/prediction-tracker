import { sql } from "./db";

// Idempotent schema upgrades for databases created from an older init.sql.
// Several processes (API, worker, scripts) migrate on start; concurrent CREATE TABLE IF NOT EXISTS can still
// collide in pg_type, so migrations run one process at a time under a session advisory lock.
export async function migrate() {
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(hashtext('prediction-tracker-migrate'))`;
    await migrateUnlocked();
  } finally {
    await conn`SELECT pg_advisory_unlock(hashtext('prediction-tracker-migrate'))`.catch(() => {});
    conn.release();
  }
}

async function migrateUnlocked() {
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'agent'`;
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS reviewed_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS claim_events (
      id bigserial PRIMARY KEY,
      claim_id text NOT NULL,
      person_id text NOT NULL,
      action text NOT NULL,
      actor text NOT NULL,
      before jsonb,
      after jsonb,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS claim_events_person_idx ON claim_events (person_id, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS sources (
      id bigserial PRIMARY KEY,
      url text NOT NULL,
      final_url text NOT NULL,
      http_status integer NOT NULL,
      title text NOT NULL DEFAULT '',
      text text NOT NULL,
      sha256 text NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS sources_url_idx ON sources (url, fetched_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS verdict_proposals (
      id bigserial PRIMARY KEY,
      claim_id text NOT NULL,
      person_id text NOT NULL,
      status text NOT NULL,
      actual_result text NOT NULL DEFAULT '',
      rationale text NOT NULL DEFAULT '',
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      rejected_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      search_query text NOT NULL DEFAULT '',
      state text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS verdict_proposals_state_idx ON verdict_proposals (state, created_at)`;
  await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'`;
  await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS quote_original text NOT NULL DEFAULT ''`;
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      query text NOT NULL,
      person_id text,
      state text NOT NULL DEFAULT 'queued',
      result jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS job_events (
      id bigserial PRIMARY KEY,
      job_id uuid NOT NULL,
      step text NOT NULL,
      status text NOT NULL,
      message text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS runner text NOT NULL DEFAULT 'api'`;
  await sql`CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events (job_id, id)`;
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS trigger_claim_id text`;
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS trigger_action text`;
  // 80% interval of the Beta posterior, 0–100; null below 3 judged claims.
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS low numeric`;
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS high numeric`;
  // SPEC 利益关系 (P12): roles, holdings and business ties, each with dates and an archived source.
  await sql`
    CREATE TABLE IF NOT EXISTS interests (
      id bigserial PRIMARY KEY,
      person_id text NOT NULL,
      kind text NOT NULL,
      counterparty text NOT NULL,
      counterparty_zh text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT '',
      started text,
      ended text,
      source_url text NOT NULL,
      source_id bigint,
      quote text NOT NULL,
      publication text NOT NULL DEFAULT 'proposed',
      provenance text NOT NULL DEFAULT 'agent',
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS interests_unique_idx ON interests (person_id, kind, lower(counterparty), lower(role))`;
  // Which interest a claim touches, judged against the relations active on the day it was said.
  await sql`
    CREATE TABLE IF NOT EXISTS claim_interests (
      claim_id text NOT NULL,
      interest_id bigint NOT NULL,
      reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (claim_id, interest_id)
    )
  `;
  // 利益关系的三层数据: scale on layer 1, a shared organisation key, layer 2 exposures and layer 3 claim links.
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS stake_pct numeric`;
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS amount_usd numeric`;
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS org_key text`;
  await sql`ALTER TABLE claim_interests ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'direct'`;
  await sql`
    CREATE TABLE IF NOT EXISTS org_exposures (
      id bigserial PRIMARY KEY,
      org_key text NOT NULL,
      dimension text NOT NULL,
      target text NOT NULL,
      target_zh text NOT NULL DEFAULT '',
      country text,
      metric_kind text,
      metric_value numeric,
      metric_year integer,
      started text,
      ended text,
      source_url text NOT NULL,
      source_id bigint,
      quote text NOT NULL,
      publication text NOT NULL DEFAULT 'proposed',
      provenance text NOT NULL DEFAULT 'agent',
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS org_exposures_unique_idx
    ON org_exposures (org_key, dimension, lower(target), coalesce(metric_kind, ''), coalesce(metric_year, 0))
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS claim_exposures (
      claim_id text NOT NULL,
      exposure_id bigint NOT NULL,
      level text NOT NULL DEFAULT 'indirect',
      reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (claim_id, exposure_id)
    )
  `;
  // Every Ark call, from any process: the shared rate limiter reserves slots here and the AFP budget sums it.
  await sql`
    CREATE TABLE IF NOT EXISTS ark_calls (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,
      path text NOT NULL,
      caller text NOT NULL DEFAULT '',
      slot_at timestamptz NOT NULL,
      afp numeric NOT NULL DEFAULT 0,
      tokens integer,
      ok boolean,
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ark_calls_kind_slot_idx ON ark_calls (kind, slot_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ark_calls_created_idx ON ark_calls (created_at DESC)`;
  // Queue fields: one worker claims queued jobs; payload carries per-kind input (e.g. claim_id).
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now()`;
  await sql`CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (state, run_after, created_at)`;
  // Which judged claims (id + status) a snapshot counted, so a change can be explained claim by claim.
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS basis jsonb`;
  // 原话 (direct) or 可核实转述 (reported): a reliable source attributes the statement to the person (SPEC 原则 2).
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS quote_kind text NOT NULL DEFAULT 'direct'`;
  // P9 更正通道: a public counter-example. Pending rows are the review queue; the claim stays published.
  await sql`
    CREATE TABLE IF NOT EXISTS challenges (
      id bigserial PRIMARY KEY,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      person_id text NOT NULL,
      url text NOT NULL,
      note text NOT NULL,
      state text NOT NULL DEFAULT 'pending',
      source_id bigint,
      decision_note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS challenges_pending_idx ON challenges (state, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS challenges_target_idx ON challenges (target_kind, target_id)`;
}

export async function logEvent(event: {
  claim_id: string;
  person_id: string;
  action: string;
  actor: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}) {
  await sql`
    INSERT INTO claim_events (claim_id, person_id, action, actor, before, after, note)
    VALUES (
      ${event.claim_id},
      ${event.person_id},
      ${event.action},
      ${event.actor},
      ${event.before === undefined ? null : sql.json(event.before as never)},
      ${event.after === undefined ? null : sql.json(event.after as never)},
      ${event.note ?? ""}
    )
  `;
}

if (import.meta.main) {
  await migrate();
  console.log("migrated");
  await sql.end();
}
