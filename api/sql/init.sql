CREATE TABLE people (
  id text PRIMARY KEY,
  name text NOT NULL,
  name_en text NOT NULL,
  title text NOT NULL,
  portrait_path text,
  portrait_credit text,
  portrait_source_url text,
  portrait_license text
);

CREATE TABLE claims (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people (id),
  category text NOT NULL,
  claim_type text NOT NULL DEFAULT 'prediction',
  quote_en text NOT NULL,
  quote_zh text NOT NULL,
  source_url text NOT NULL,
  published_date date NOT NULL,
  deadline date NOT NULL,
  actual_result text NOT NULL DEFAULT '',
  status text NOT NULL,
  publication text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  provenance text NOT NULL DEFAULT 'agent',
  reviewed_at timestamptz
);

CREATE TABLE claim_events (
  id bigserial PRIMARY KEY,
  claim_id text NOT NULL,
  person_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  before jsonb,
  after jsonb,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id text,
  step text NOT NULL,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id text NOT NULL REFERENCES people (id),
  domain text NOT NULL,
  value numeric,
  n integer NOT NULL,
  confidence text NOT NULL,
  formula_version text NOT NULL,
  trigger_claim_id text,
  trigger_action text,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claims_person_publication_idx ON claims (person_id, publication);
CREATE INDEX score_snapshots_person_idx ON score_snapshots (person_id, computed_at DESC);
CREATE INDEX claim_events_person_idx ON claim_events (person_id, created_at DESC);
