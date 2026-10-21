import { sql } from "./db";

// Idempotent schema upgrades for databases created from an older init.sql.
export async function migrate() {
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
