--liquibase formatted sql
--changeset danield:000064_add_execution_policy_to_experiments
--comment: Add execution_policy column to experiments table for evaluation suite pass_rate computation

ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}'
    ADD COLUMN IF NOT EXISTS execution_policy String DEFAULT '';

--rollback ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}' DROP COLUMN IF EXISTS execution_policy;
