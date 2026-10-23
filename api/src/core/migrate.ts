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
  // auto = on-demand analysis, not yet cross-checked. reviewed = a person decided. cross_checked is set by task 010.
  const curationAdded = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'curation'
    ) AS exists
  `;
  if (!curationAdded[0]?.exists) {
    await sql`ALTER TABLE people ADD COLUMN curation text NOT NULL DEFAULT 'reviewed'`;
    await sql`
      UPDATE people p SET curation = 'auto'
      WHERE EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.person_id = p.id AND j.kind = 'analyze_person' AND j.state = 'done'
          AND coalesce((j.result->>'person_created')::boolean, false)
      )
    `;
  }
  await sql`CREATE INDEX IF NOT EXISTS people_public_name_idx ON people (name) WHERE visibility = 'public'`;
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
  // Uniqueness of live interests rows: interests_live_unique_idx below (partial, ignores superseded rows).
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
  // Person pages and consult look up claims by interest, the reverse of the primary key.
  await sql`CREATE INDEX IF NOT EXISTS claim_interests_interest_idx ON claim_interests (interest_id, claim_id)`;
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
    CREATE TABLE IF NOT EXISTS claim_exposures (
      claim_id text NOT NULL,
      exposure_id bigint NOT NULL,
      level text NOT NULL DEFAULT 'indirect',
      reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (claim_id, exposure_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS claim_exposures_exposure_idx ON claim_exposures (exposure_id, claim_id)`;
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
  // Why a call failed (network / server / rate / denied / request): the circuit breaker in ark.ts reads it.
  await sql`ALTER TABLE ark_calls ADD COLUMN IF NOT EXISTS error_kind text`;
  // Evidence store standard: the raw bytes as fetched (gzip) and their hash, how the page was reached,
  // and an independent Wayback Machine capture as third-party corroboration.
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS raw_gz bytea`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS raw_sha256 text`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS content_type text`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS fetched_via text NOT NULL DEFAULT 'direct'`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS wayback_url text`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS wayback_at timestamptz`;
  await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS wayback_error text`;
  // Where an exposure came from. 'crawl' = the bulk web crawl of 2026-10 (frozen, shown as unverified);
  // 'sec_xbrl' = parsed from a 10-K's XBRL with units and dimensions, which replaces crawled rows of the same kind.
  await sql`ALTER TABLE org_exposures ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'crawl'`;
  // One row per source basis: a filed number and an earlier crawled one for the same thing can both be kept.
  await sql`DROP INDEX IF EXISTS org_exposures_unique_idx`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS org_exposures_unique_basis_idx
    ON org_exposures (org_key, dimension, lower(target), coalesce(metric_kind, ''), coalesce(metric_year, 0), basis)
  `;
  await sql`CREATE INDEX IF NOT EXISTS org_exposures_org_published_idx ON org_exposures (org_key, dimension, target) WHERE publication = 'published'`;
  // Organisation-level annual revenue (SPEC 推算规则), from filings.
  await sql`
    CREATE TABLE IF NOT EXISTS org_financials (
      id bigserial PRIMARY KEY,
      org_key text NOT NULL,
      fiscal_year integer NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      revenue_usd numeric NOT NULL,
      concept text NOT NULL,
      form text NOT NULL,
      accession text NOT NULL,
      source_url text NOT NULL,
      source_id bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_key, period_end, form)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS org_financials_org_period_idx ON org_financials (org_key, period_end DESC)`;
  // Queue fields: one worker claims queued jobs; payload carries per-kind input (e.g. claim_id).
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now()`;
  await sql`CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (state, run_after, created_at)`;
  // Hashed client address for the on-demand analysis cap. Never the raw IP.
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_ip text`;
  await sql`CREATE INDEX IF NOT EXISTS jobs_client_ip_created_idx ON jobs (client_ip, created_at DESC) WHERE client_ip IS NOT NULL`;
  // Open when a second, independent verdict disagreed. Null once a person resolves it.
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS disagreement jsonb`;
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id bigserial PRIMARY KEY,
      condition text NOT NULL,
      message text NOT NULL DEFAULT '',
      sent_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS notifications_condition_idx ON notifications (condition, sent_at DESC)`;
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
  await sql`CREATE INDEX IF NOT EXISTS challenges_claim_pending_idx ON challenges (target_id) WHERE target_kind = 'claim' AND state = 'pending'`;
  // 改期合并 (formula v1.3): restatements of one commitment share a thread; the thread's judged claims
  // count √k in total. thread_source says who linked them (agent / manual).
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS thread_id text`;
  await sql`ALTER TABLE claims ADD COLUMN IF NOT EXISTS thread_source text`;
  await sql`CREATE INDEX IF NOT EXISTS claims_thread_idx ON claims (thread_id) WHERE thread_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS claims_published_deadline_idx ON claims (deadline, id) WHERE publication = 'published'`;
  await sql`CREATE INDEX IF NOT EXISTS claims_person_published_date_idx ON claims (person_id, published_date, id) WHERE publication = 'published'`;
  await sql`CREATE INDEX IF NOT EXISTS claims_published_person_status_idx ON claims (person_id, status) WHERE publication = 'published'`;
  // 证据不足 is void (not scored); how many were voided is published next to the score.
  await sql`ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS voided integer NOT NULL DEFAULT 0`;
  // 校准协议: blind human labels for agent verdicts. purpose = calibration (the stratified sample that opens
  // auto-publishing) or audit (the ongoing 5% sample that can close it again).
  await sql`
    CREATE TABLE IF NOT EXISTS calibration_items (
      id bigserial PRIMARY KEY,
      proposal_id bigint NOT NULL UNIQUE,
      claim_id text NOT NULL,
      model_status text NOT NULL,
      stratum text NOT NULL,
      purpose text NOT NULL DEFAULT 'calibration',
      human_status text,
      labeler text,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      labeled_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS calibration_items_open_idx ON calibration_items (purpose, labeled_at)`;
  // 利益关系双时态 (2026-10-22). Valid time: started/ended plus end_kind, so a missing end date is "unknown",
  // never silently "still in office": ongoing (source says present) / ended / planned (end date in the future) /
  // unknown. Transaction time: created_at is when we recorded it; a correction closes the old row
  // (superseded_at, superseded_by) and adds a new one, so "what did we believe on day X" stays answerable.
  // Latest snapshot per (person, domain): DISTINCT ON (person_id, domain) ORDER BY computed_at DESC.
  await sql`CREATE INDEX IF NOT EXISTS score_snapshots_person_domain_idx ON score_snapshots (person_id, domain, computed_at DESC)`;
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS end_kind text`;
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS superseded_at timestamptz`;
  await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS superseded_by bigint`;
  // One live row per (person, kind, organisation, role); corrected rows stay alongside as history.
  // (Replaces interests_unique_idx, which counted superseded rows too and forced workarounds.)
  await sql`DROP INDEX IF EXISTS interests_unique_idx`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS interests_live_unique_idx
    ON interests (person_id, kind, lower(counterparty), lower(role)) WHERE superseded_at IS NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS interests_person_live_idx ON interests (person_id, kind, counterparty) WHERE publication = 'published' AND superseded_at IS NULL`;
  await sql`
    UPDATE interests SET role = regexp_replace(role, '[\u200B-\u200D\uFEFF]+', '', 'g')
    WHERE role ~ '[\u200B-\u200D\uFEFF]'
  `;
  await sql`
    UPDATE interests SET end_kind = CASE
      WHEN ended = 'present' THEN 'ongoing'
      WHEN ended IS NULL OR ended = '' THEN 'unknown'
      WHEN ended > to_char(now(), 'YYYY-MM-DD') THEN 'planned'
      ELSE 'ended'
    END
    WHERE end_kind IS NULL
  `;
  // P13 可信度（一致性）. One row per topic the collector looked at (see data/consistency/README.md):
  // reversal = later statement says the opposite (consistent only when he explained the change),
  // reaffirm = later statement keeps the stance, walk = his advice to others vs his own action.
  // Side a / b / explanation each carry an archived source and whether the quote was found word for word.
  // label stays null until a person reviews it; nothing here is scored before calibration.
  await sql`
    CREATE TABLE IF NOT EXISTS consistency_pairs (
      id text PRIMARY KEY,
      person_id text NOT NULL,
      domain text NOT NULL,
      topic text NOT NULL,
      kind text NOT NULL,
      a jsonb NOT NULL,
      b jsonb NOT NULL,
      explanation jsonb,
      proposed_label text NOT NULL,
      rationale text NOT NULL DEFAULT '',
      label text,
      publication text NOT NULL DEFAULT 'proposed',
      provenance text NOT NULL DEFAULT 'cursor',
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS consistency_pairs_person_idx ON consistency_pairs (person_id, domain)`;
  // Trigram indexes for ILIKE name lookup and future SQL-side quote search. Superuser is required.
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE INDEX IF NOT EXISTS people_name_trgm_idx ON people USING gin (name gin_trgm_ops, name_en gin_trgm_ops)`;
  await sql`CREATE INDEX IF NOT EXISTS claims_quote_trgm_idx ON claims USING gin (quote_zh gin_trgm_ops, quote_en gin_trgm_ops)`;
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
