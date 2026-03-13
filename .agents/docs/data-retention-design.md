# Data Retention System Design

## Overview

A multi-level data retention system for Opik that supports workspace and project-level rules, with future support for filter-based rules (e.g., "if tag='dev', retention=14d"). Rules are stored in MySQL for transactional integrity; deletions are executed against ClickHouse traces/spans tables.

Product is requesting organization-level retention. However, "organization" is **not** an abstraction that Opik supports — it only exists in EM (Comet API). Opik's top-level entity is the **workspace**. To support org-level retention, the **Opik admin dashboard (FE)** is responsible for the translation:
  1. When a user sets an "org-level rule", the dashboard calls EM to retrieve all workspaces for that organization
  2. The dashboard then fans out, calling Opik's retention API once per workspace to create individual workspace-level rules
  3. For newly created workspaces, the dashboard (or EM via a hook) must apply the org rule by creating a workspace-level rule in Opik
  4. When an org-level rule is updated or deleted, the dashboard repeats the fan-out to keep workspace-level rules in sync

  EM's role is limited to being the **source of truth for the org → workspaces mapping**. It does not call Opik's retention API directly.

  From Opik's perspective, there is **no ORGANIZATION entity type** — all rules are stored as WORKSPACE or PROJECT level. 

## Key Design Decisions

- **Pre-defined retention periods**: SHORT_14D, BASE_60D, EXTENDED_400D, UNLIMITED. Additional pre-defined values can be added over time, but they must remain a small, fixed set (not user-defined arbitrary durations). This constraint is critical for the batch deletion strategy — the cleanup job groups workspaces by retention tier, so a bounded number of tiers keeps the number of DELETE passes small and predictable
- **Entity hierarchy**: WORKSPACE > PROJECT (most specific wins).
- **Future support rules**: Future support to `project` level and `filter` column (e.g., `tag = 'dev'`)
- **apply_to_past toggle**: When false, only data ingested after the rule is set will be subject to retention
- **Soft-disable**: `enabled` flag for audit trail without deleting rules
- **Default behavior**: No rule at any level = UNLIMITED (no deletion)
- **Storage**: MySQL for rules (transactional), ClickHouse for data deletion
- **workspace_id is critical**: All ClickHouse queries are workspace-scoped (sort key prefix), so workspace_id must be present for efficient deletion

## Data Model

### MySQL Table: `retention_rules`

```sql
CREATE TABLE retention_rules (
    id CHAR(36) NOT NULL,                    -- UUIDv7
    workspace_id VARCHAR(36) NOT NULL,       -- Parent workspace (for collision avoidance + cascading deletes)
    entity_type ENUM('WORKSPACE', 'PROJECT') NOT NULL,
    entity_id VARCHAR(36) NOT NULL,          -- The workspace/project ID
    retention ENUM('SHORT_14D', 'BASE_60D', 'EXTENDED_400D', 'UNLIMITED') NOT NULL,
    filter VARCHAR(255) NOT NULL DEFAULT '', -- Future: conditions like "tag = 'dev'"
    apply_to_past BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Generated column: non-NULL only when enabled=true. MySQL excludes NULLs from
    -- unique constraints, so unlimited inactive (disabled) rules are allowed while
    -- enforcing at most one active rule per (workspace, entity_type, entity, filter).
    active_entity_id VARCHAR(36) AS (IF(enabled, entity_id, NULL)) STORED,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_by VARCHAR(255) NOT NULL,
    last_updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    last_updated_by VARCHAR(255) NOT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_active_rule (workspace_id, entity_type, active_entity_id, filter),
    INDEX idx_active_workspace (enabled, workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Key constraints:**
- `workspace_id` is always populated — even for WORKSPACE-level rules (workspace_id = entity_id)
- `active_entity_id` is a generated column: non-NULL when `enabled=true`, NULL when `enabled=false`. MySQL excludes NULLs from unique indexes, so the unique key `uk_active_rule` enforces **at most one active rule** per `(workspace, entity_type, entity, filter)` while allowing unlimited inactive (audit history) rows with the same combination
- `filter` defaults to '' (empty string) not NULL, so the unique constraint works correctly
- `idx_active_workspace (enabled, workspace_id)` is the hot index for the deletion job: it fetches all active rules for a workspace ID range in one query (`WHERE enabled = true AND workspace_id >= ? AND workspace_id < ?`), then groups by retention tier in Java

### Java Enums

```java
public enum RetentionEntityType {
    WORKSPACE,
    PROJECT
}

public enum RetentionPeriod {
    SHORT_14D(14),
    BASE_60D(60),
    EXTENDED_400D(400),
    UNLIMITED(null);
    
    private final Integer days;
}
```

### API Model

```java
public record RetentionRule(
    UUID id,
    String workspaceId,
    RetentionEntityType entityType,
    String entityId,
    RetentionPeriod retention,
    String filter,
    Boolean applyToPast,
    Boolean enabled,
    Instant createdAt,
    String createdBy,
    Instant lastUpdatedAt,
    String lastUpdatedBy
) {}
```

## Effective Retention Resolution

When determining retention for a trace/span:

1. Check for matching filter-based PROJECT rule
2. Check for default PROJECT rule (filter='')
3. Check for matching filter-based WORKSPACE rule
4. Check for default WORKSPACE rule (filter='')
5. Default: UNLIMITED

## API Endpoints

New endpoints under `/v1/private/retention`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/private/retention/rules` | Create a new rule. Auto-deactivates any existing active rule for the same `(entity_type, entity_id, filter)` to ensure at most one active rule per scope |
| GET | `/v1/private/retention/rules?includeInactive=false` | List rules for caller's workspace (workspace-level + all project-level). `workspaceId` from `Comet-Workspace` header. Defaults to active only; pass `includeInactive=true` to include deactivated rules for audit history |
| GET | `/v1/private/retention/rules/{id}` | Get specific rule |
| DELETE | `/v1/private/retention/rules/{id}` | Soft-deactivate: sets `enabled=false`. No hard deletes — rules are preserved for audit trail |

**Rules are immutable.** To change retention for an entity, create a new rule — the old one is auto-deactivated. No PUT/update endpoint. This preserves a full audit history of retention policy changes.

## Deletion Strategy: Two-Track System

### Why Two Tracks?

With 100K+ workspaces and skewed data distribution, a single deletion approach doesn't work:
- Small workspaces: Light, quick deletes
- Large workspaces with new retention rules: Potentially TB of data to purge

### Track 1: Caught-Up Workspaces (Steady State)

For workspaces already compliant with their retention policy.

**Schedule:** Hourly, rotating through workspace ID ranges (e.g., 00*-3f*, 40*-7f*, etc.)

**Process:**
1. Select workspace range for this hour
2. For each retention tier (14d, 60d, 400d):
   - Find workspaces in range with this retention AND caught_up=true
   - Execute lightweight DELETE for newly expired data

```sql
-- Light delete for caught-up workspaces
DELETE FROM traces
WHERE workspace_id >= :range_start AND workspace_id < :range_end
  AND id < generateUUIDv7(toUnixTimestamp(now() - INTERVAL :retention_days DAY) * 1000)
  AND workspace_id IN (SELECT workspace_id FROM ... WHERE retention_days = :retention_days)
```

### Track 2: Backfill Workspaces (Initial Purge)

For workspaces that need large historical data purged (new rule or changed retention).

**Schedule:** Continuous background processing with rate limiting

**Process:**
1. Track progress in `retention_backfill_state` table
2. Process incrementally by time chunks (e.g., month by month)
3. Risk-weighted frequency: 14d retention (most data) gets finer chunks than 400d

**State tracking table (MySQL):**

```sql
CREATE TABLE retention_backfill_state (
    workspace_id VARCHAR(36) NOT NULL,
    retention_rule_id CHAR(36) NOT NULL,
    last_processed_id CHAR(36),           -- Last deleted trace ID (UUIDv7)
    status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED') NOT NULL,
    started_at TIMESTAMP(6),
    completed_at TIMESTAMP(6),
    PRIMARY KEY (workspace_id, retention_rule_id)
);
```

## Implementation Files

| File | Description |
|------|-------------|
| `000053_create_retention_rules_table.sql` | MySQL (db-app-state) migration for retention_rules |
| `000054_create_retention_backfill_state_table.sql` | MySQL (db-app-state) migration for backfill tracking |
| `RetentionRule.java` | API model |
| `RetentionEntityType.java` | Enum (in `com.comet.opik.api.retention` or `com.comet.opik.domain.retention`) |
| `RetentionPeriod.java` | Enum |
| `RetentionRuleDAO.java` | MySQL DAO |
| `RetentionRuleService.java` | Business logic + effective retention resolution |
| `RetentionResource.java` | REST endpoints |
| `DataRetentionCleanupJob.java` | Two-track deletion job |
| `RetentionBackfillStateDAO.java` | Track backfill progress |

## Notes

- **No frontend work** in this phase (Admin Dashboard handled separately by EM)
- **SDK support**: Endpoints designed for easy SDK integration so users can set retention programmatically
- **workspace_id importance**: ClickHouse tables use `workspace_id` as sort key prefix - all DELETE queries must include it for efficiency
- **UUIDv7 for time filtering**: DELETE uses `id < generateUUIDv7(...)` for time-based filtering, leveraging UUIDv7's timestamp encoding
- **Existing EntityType conflict**: There are already **three** `EntityType` enums in the codebase (`com.comet.opik.domain.EntityType`, `com.comet.opik.api.attachment.EntityType`, `com.comet.opik.api.ManualEvaluationEntityType`). The codebase convention is `{Feature}EntityType`, so this should be `RetentionEntityType` in package `com.comet.opik.api.retention` or `com.comet.opik.domain.retention`

## Implementation Plan

### Scope cuts for Phase 1
- **Project-level retention**: Phase 1 supports only org/workspace-level retention. Project-level rules deferred to a next phase
- **Filter-based rules**: Column exists in schema, but resolution logic is not implemented (filter='' only)
- **Structured metrics**: Basic logging only; counters/gauges deferred to follow-up

### Task 1: API + Data Model (1 day)

Endpoints and data model — CRUD for retention rules stored in MySQL, plus an endpoint to list existing rules for a workspace (including project-level ones).

**Delivers:**
- MySQL migrations: `000053_create_retention_rules_table.sql`, `000054_create_retention_backfill_state_table.sql`
- Enums: `RetentionEntityType`, `RetentionPeriod`
- API model: `RetentionRule` record
- DAO: `RetentionRuleDAO` (JDBI interface)
- Service: `RetentionRuleService` — CRUD operations. Retention resolution logic (project > workspace > UNLIMITED) lives here but is consumed internally by the deletion jobs, not exposed as a separate endpoint
- Resource: `RetentionResource` — REST endpoints under `/v1/private/retention` (CRUD only, no effective-retention endpoint in Phase 1)
- Tests

**Standalone and shippable** — rules can be created/read but nothing deletes yet.

### Task 2: Admin Config Dashboard (parallel)

UI for setting and viewing retention rules. Consumes Task 1's API.

### Task 3: Data Retention Service — Base Job (2 days)

The steady-state deletion job that runs multiple times a day, rotating through workspace ID ranges and deleting newly expired data using the rules from Task 1.

**Delivers:**
- `DataRetentionCleanupJob` — Dropwizard `@Every` job
- Workspace range rotation (e.g., 4 ranges cycled hourly)
- Per-tier DELETE passes: query MySQL for workspace IDs per retention tier, then execute batched ClickHouse DELETEs
- Trace and span deletion only (Phase 1). Cascading deletes to feedback scores, comments, attachments deferred to Phase 2
- `apply_to_past=false` enforcement via additional UUIDv7 time filter on `rule.created_at`
- Distributed locking via existing `LockService` to prevent duplicate processing across instances
- ClickHouse mutation batching — one DELETE per tier/range, not per workspace, to avoid overwhelming mutation queue
- `SETTINGS log_comment` tagging on all ClickHouse queries

**Key decision:** Spans are deleted by `(workspace_id, project_id, trace_id <= cutoff)`, which aligns with the spans sort key for efficient navigation. Traces deleted by `(workspace_id, project_id, id <= cutoff)`.

### Task 4: Data Retention Service — Catch-Up (2 days)

The backfill path for new/changed rules. Until a rule catches up to "live" state, it processes incrementally with throttling and then graduates to the base job (Task 3).

**Delivers:**
- `RetentionBackfillStateDAO` — tracks progress per rule in `retention_backfill_state` table (with error tracking fields)
- Incremental processing by time chunks (e.g., month-by-month, finer for shorter retention tiers)
- Throttling: configurable max records/mutations per cycle to avoid overloading ClickHouse
- Graduation: when `last_processed_id` reaches the retention cutoff, mark as COMPLETED — rule is now eligible for the base job
- Rule lifecycle handling: disabling/deleting a rule sets backfill status to CANCELLED
- Traces and spans deletion in small incremental chunks (e.g., "2 days' worth per cycle" — even large workspaces never overwhelm CH mutation queue)
- Adapts Task 3's base job to skip rules still in catch-up (only processes COMPLETED rules)

### Dependency & Deployment

```
Task 1 (API + model) ─── 1 day
  ├── Task 2 (UI, EM-side) ── parallel, different team
  └── Task 3 (base job) ───── 2 days
       └── Task 4 (catch-up) ── 2 days (adapts Task 3)
```

Tasks 3 and 4 are a **single deployment unit** — both ship together. On first deploy, all rules enter through the catch-up path (Task 4) and graduate into the steady-state path (Task 3).
