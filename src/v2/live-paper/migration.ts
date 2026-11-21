import {MigrationInterface,QueryRunner} from 'typeorm';
export class ProspectivePaper1795200000000 implements MigrationInterface{
 name='ProspectivePaper1795200000000';
 async up(q:QueryRunner):Promise<void>{await q.query(`
 CREATE TABLE v2_paper_experiments(id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES v2_users(id), config jsonb NOT NULL, config_hash text NOT NULL, state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(config->>'mode'='PAPER'),CHECK(state->'config'=config),CHECK(state->>'configHash'=config_hash));
 CREATE TABLE v2_paper_observations(id bigserial PRIMARY KEY, experiment_id uuid REFERENCES v2_paper_experiments(id), bot text, kind text NOT NULL, at bigint NOT NULL, data jsonb NOT NULL);
 CREATE INDEX ON v2_paper_observations(experiment_id,kind,at);
 CREATE TABLE v2_paper_equity(experiment_id uuid NOT NULL REFERENCES v2_paper_experiments(id),bot text NOT NULL,at bigint NOT NULL,data jsonb NOT NULL,PRIMARY KEY(experiment_id,bot,at));
 CREATE TABLE v2_paper_reports(experiment_id uuid NOT NULL REFERENCES v2_paper_experiments(id),period text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(experiment_id,period));
 CREATE TABLE v2_paper_feed(id text PRIMARY KEY,data jsonb NOT NULL);
 CREATE TABLE v2_paper_quotes(id text PRIMARY KEY,at bigint NOT NULL,data jsonb NOT NULL);
 CREATE INDEX ON v2_paper_quotes(at);
 CREATE FUNCTION v2_paper_immutable_config() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE bot text; kind text; previous jsonb; current jsonb;
 BEGIN
 IF NEW.config IS DISTINCT FROM OLD.config OR NEW.config_hash IS DISTINCT FROM OLD.config_hash OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN RAISE EXCEPTION 'PAPER_CONFIG_IMMUTABLE'; END IF;
 FOREACH bot IN ARRAY ARRAY['pullback-4h','momentum-1h'] LOOP
 IF NEW.state#>ARRAY['bots',bot,'s','account','initialCapital'] IS DISTINCT FROM OLD.state#>ARRAY['bots',bot,'s','account','initialCapital'] THEN RAISE EXCEPTION 'INITIAL_CAPITAL_IMMUTABLE'; END IF;
 FOREACH kind IN ARRAY ARRAY['fills','ledger','decisions'] LOOP
 previous=OLD.state#>ARRAY['bots',bot,'s',kind];current=NEW.state#>ARRAY['bots',bot,'s',kind];
 IF NOT current @> previous THEN RAISE EXCEPTION 'PAPER_HISTORY_APPEND_ONLY'; END IF;
 END LOOP; END LOOP;
 IF OLD.state->>'startedAt' IS NOT NULL AND NEW.state->>'startedAt' IS DISTINCT FROM OLD.state->>'startedAt' THEN RAISE EXCEPTION 'EXPERIMENT_START_IMMUTABLE'; END IF;
 IF OLD.state->>'endsAt' IS NOT NULL AND NEW.state->>'endsAt' IS DISTINCT FROM OLD.state->>'endsAt' THEN RAISE EXCEPTION 'EXPERIMENT_END_IMMUTABLE'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER v2_paper_config_guard BEFORE UPDATE ON v2_paper_experiments FOR EACH ROW EXECUTE FUNCTION v2_paper_immutable_config();
 CREATE FUNCTION v2_paper_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PAPER_AUDIT_APPEND_ONLY'; END $$;
 CREATE TRIGGER v2_paper_audit_guard BEFORE UPDATE OR DELETE ON v2_paper_observations FOR EACH ROW EXECUTE FUNCTION v2_paper_append_only();
 CREATE TRIGGER v2_paper_equity_guard BEFORE UPDATE OR DELETE ON v2_paper_equity FOR EACH ROW EXECUTE FUNCTION v2_paper_append_only();
 `);}
 async down():Promise<void>{throw Error('PAPER_HISTORY_REQUIRES_EXPLICIT_ARCHIVE; automatic rollback forbidden');}
}
