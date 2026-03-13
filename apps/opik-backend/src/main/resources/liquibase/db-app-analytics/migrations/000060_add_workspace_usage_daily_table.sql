--liquibase formatted sql
--changeset daniela:create_workspace_usage_daily_table

CREATE TABLE IF NOT EXISTS ${ANALYTICS_DB_DATABASE_NAME}.workspace_usage_daily
(
    day            Date,
    workspace_id   FixedString(36),
    resource_type  LowCardinality(String),
    project_id     FixedString(36) DEFAULT '',
    record_count   Int64,
    size_bytes     Int64
)
ENGINE = SummingMergeTree((record_count, size_bytes))
ORDER BY (workspace_id, day, resource_type, project_id);

--rollback DROP TABLE IF EXISTS ${ANALYTICS_DB_DATABASE_NAME}.workspace_usage_daily;
