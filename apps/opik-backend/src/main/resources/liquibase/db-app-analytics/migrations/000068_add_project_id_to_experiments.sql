--liquibase formatted sql
--changeset thiaghora:000068_add_project_id_to_experiments
--comment: Add project_id column to experiments table for project-scoped operations (OPIK-4932)

-- Add nullable project_id column to store direct project association
ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}'
    ADD COLUMN IF NOT EXISTS project_id Nullable(FixedString(36));
--rollback ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}' DROP COLUMN IF EXISTS project_id;

-- Add minmax index on project_id for efficient filtering
ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}'
    ADD INDEX IF NOT EXISTS idx_project_id project_id TYPE minmax GRANULARITY 4;
--rollback ALTER TABLE ${ANALYTICS_DB_DATABASE_NAME}.experiments ON CLUSTER '{cluster}' DROP INDEX IF EXISTS idx_project_id;

