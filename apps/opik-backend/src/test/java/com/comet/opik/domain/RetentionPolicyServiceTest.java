package com.comet.opik.domain;

import com.comet.opik.api.Comment;
import com.comet.opik.api.FeedbackScoreItem.FeedbackScoreBatchItem;
import com.comet.opik.api.ScoreSource;
import com.comet.opik.api.Span;
import com.comet.opik.api.Trace;
import com.comet.opik.api.resources.utils.AuthTestUtils;
import com.comet.opik.api.resources.utils.ClickHouseContainerUtils;
import com.comet.opik.api.resources.utils.ClientSupportUtils;
import com.comet.opik.api.resources.utils.MigrationUtils;
import com.comet.opik.api.resources.utils.MySQLContainerUtils;
import com.comet.opik.api.resources.utils.RedisContainerUtils;
import com.comet.opik.api.resources.utils.TestDropwizardAppExtensionUtils;
import com.comet.opik.api.resources.utils.TestUtils;
import com.comet.opik.api.resources.utils.WireMockUtils;
import com.comet.opik.api.resources.utils.resources.RetentionRuleResourceClient;
import com.comet.opik.api.resources.utils.resources.SpanResourceClient;
import com.comet.opik.api.resources.utils.resources.TraceResourceClient;
import com.comet.opik.api.retention.RetentionPeriod;
import com.comet.opik.extensions.DropwizardAppExtensionProvider;
import com.comet.opik.extensions.RegisterApp;
import com.comet.opik.infrastructure.db.TransactionTemplateAsync;
import com.redis.testcontainers.RedisContainer;
import org.apache.commons.lang3.RandomStringUtils;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.extension.ExtendWith;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.lifecycle.Startables;
import org.testcontainers.mysql.MySQLContainer;
import reactor.core.publisher.Mono;
import ru.vyarus.dropwizard.guice.test.ClientSupport;
import ru.vyarus.dropwizard.guice.test.jupiter.ext.TestDropwizardAppExtension;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static com.comet.opik.api.resources.utils.ClickHouseContainerUtils.DATABASE_NAME;
import static com.comet.opik.api.resources.utils.TestDropwizardAppExtensionUtils.newTestDropwizardAppExtension;
import static org.assertj.core.api.Assertions.assertThat;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(DropwizardAppExtensionProvider.class)
class RetentionPolicyServiceTest {

    private static final String API_KEY = UUID.randomUUID().toString();
    private static final String TEST_WORKSPACE_NAME = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
    private static final String USER = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
    private static final String PROJECT_NAME = "retention-test-project";

    private final RedisContainer REDIS = RedisContainerUtils.newRedisContainer();
    private final MySQLContainer MYSQL_CONTAINER = MySQLContainerUtils.newMySQLContainer();
    private final GenericContainer<?> ZOOKEEPER_CONTAINER = ClickHouseContainerUtils.newZookeeperContainer();
    private final ClickHouseContainer CLICK_HOUSE_CONTAINER = ClickHouseContainerUtils
            .newClickHouseContainer(ZOOKEEPER_CONTAINER);

    private final WireMockUtils.WireMockRuntime wireMock;

    @RegisterApp
    private final TestDropwizardAppExtension APP;

    {
        Startables.deepStart(REDIS, MYSQL_CONTAINER, CLICK_HOUSE_CONTAINER, ZOOKEEPER_CONTAINER).join();

        wireMock = WireMockUtils.startWireMock();

        var databaseAnalyticsFactory = ClickHouseContainerUtils.newDatabaseAnalyticsFactory(
                CLICK_HOUSE_CONTAINER, DATABASE_NAME);

        MigrationUtils.runMysqlDbMigration(MYSQL_CONTAINER);
        MigrationUtils.runClickhouseDbMigration(CLICK_HOUSE_CONTAINER);

        var contextConfig = TestDropwizardAppExtensionUtils.AppContextConfig.builder()
                .jdbcUrl(MYSQL_CONTAINER.getJdbcUrl())
                .databaseAnalyticsFactory(databaseAnalyticsFactory)
                .runtimeInfo(wireMock.runtimeInfo())
                .redisUrl(REDIS.getRedisURI())
                .customConfigs(List.of(
                        new TestDropwizardAppExtensionUtils.CustomConfig("retention.enabled", "true"),
                        new TestDropwizardAppExtensionUtils.CustomConfig("retention.executionsPerDay", "48")))
                .build();

        APP = newTestDropwizardAppExtension(contextConfig);
    }

    private String baseURI;
    private String workspaceId;
    private RetentionRuleResourceClient retentionClient;
    private TraceResourceClient traceClient;
    private SpanResourceClient spanClient;
    private RetentionPolicyService retentionPolicyService;
    private TransactionTemplateAsync templateAsync;
    private IdGenerator idGenerator;

    @BeforeAll
    void beforeAll(ClientSupport client, RetentionPolicyService retentionPolicyService,
            TransactionTemplateAsync templateAsync, IdGenerator idGenerator) {
        this.baseURI = TestUtils.getBaseUrl(client);
        ClientSupportUtils.config(client);

        this.retentionPolicyService = retentionPolicyService;
        this.templateAsync = templateAsync;
        this.idGenerator = idGenerator;
        this.retentionClient = new RetentionRuleResourceClient(client, baseURI);
        this.traceClient = new TraceResourceClient(client, baseURI);
        this.spanClient = new SpanResourceClient(client, baseURI);

        // Workspace ID that falls in fraction 0's range (starts with 00-05)
        this.workspaceId = "00000001-0000-0000-0000-000000000000";

        AuthTestUtils.mockTargetWorkspace(wireMock.server(), API_KEY, TEST_WORKSPACE_NAME, workspaceId, USER);
    }

    @Nested
    @DisplayName("Retention cycle execution")
    @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class RetentionCycleExecution {

        @Test
        @DisplayName("Deletes expired data and keeps recent data")
        void deletesExpiredDataAndKeepsRecentData() {
            // Use unique workspace per test run to avoid data accumulation on surefire retries
            String wsId = randomFraction0WorkspaceId();
            String apiKey = UUID.randomUUID().toString();
            String wsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String user = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), apiKey, wsName, wsId, user);

            var rule = retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D).build();
            retentionClient.createAndGet(rule, apiKey, wsName);

            Instant now = Instant.now();
            Instant oldTime = now.minus(30, ChronoUnit.DAYS);
            Instant recentTime = now.minus(5, ChronoUnit.DAYS);

            // Generate UUID v7 IDs at the old and recent timestamps
            UUID oldTraceId = idGenerator.generateId(oldTime);
            UUID oldSpanId = idGenerator.generateId(oldTime);
            UUID recentTraceId = idGenerator.generateId(recentTime);
            UUID recentSpanId = idGenerator.generateId(recentTime);

            // Insert old data (should be deleted - trace/span IDs are older than retention cutoff)
            createTestTrace(oldTraceId, apiKey, wsName);
            createTestSpan(oldSpanId, oldTraceId, apiKey, wsName);
            createTestFeedbackScore(oldTraceId, apiKey, wsName);
            createTestComment(oldTraceId, apiKey, wsName);

            // Insert recent data (should NOT be deleted - IDs are newer than retention cutoff)
            createTestTrace(recentTraceId, apiKey, wsName);
            createTestSpan(recentSpanId, recentTraceId, apiKey, wsName);
            createTestFeedbackScore(recentTraceId, apiKey, wsName);
            createTestComment(recentTraceId, apiKey, wsName);

            // Wait for ClickHouse async inserts to become visible
            awaitData("traces", wsId, 2);
            awaitData("spans", wsId, 2);
            awaitData("authored_feedback_scores", wsId, 2);
            awaitData("comments", wsId, 2);

            // Execute retention cycle for fraction 0 (our workspace falls in this range)
            retentionPolicyService.executeRetentionCycle(0, now).block();

            // Verify: old data deleted, recent data kept
            assertThat(countRows("traces", wsId)).isEqualTo(1);
            assertThat(countRows("spans", wsId)).isEqualTo(1);
            assertThat(countRows("authored_feedback_scores", wsId)).isEqualTo(1);
            assertThat(countRows("comments", wsId)).isEqualTo(1);

            // Verify the remaining rows are the recent ones
            assertThat(countRowsById("traces", recentTraceId)).isEqualTo(1);
            assertThat(countRowsById("spans", recentSpanId)).isEqualTo(1);
        }

        @Test
        @DisplayName("No rules in range - no deletions")
        void noRulesInRange_noDeletes() {
            String farWsId = "ff000001-0000-0000-0000-000000000000";
            String farApiKey = UUID.randomUUID().toString();
            String farWsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String farUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), farApiKey, farWsName, farWsId, farUser);

            UUID traceId = idGenerator.generateId(Instant.now().minus(30, ChronoUnit.DAYS));
            createTestTrace(traceId, farApiKey, farWsName);

            awaitData("traces", farWsId, 1);

            // Execute fraction 47 - no retention rules exist for this workspace
            retentionPolicyService.executeRetentionCycle(47, Instant.now()).block();

            assertThat(countRows("traces", farWsId)).isEqualTo(1);
        }

        @Test
        @DisplayName("applyToPast=false preserves pre-existing data that applyToPast=true would delete")
        void applyToPastFalsePreservesPreExistingData() {
            // Two workspaces with the SAME retention (14d) and the SAME old data (30d),
            // differing ONLY in applyToPast. This directly proves the flag works.

            // --- Workspace A: applyToPast=true (default) ---
            String wsA = randomFraction0WorkspaceId();
            String apiKeyA = UUID.randomUUID().toString();
            String wsNameA = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String userA = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), apiKeyA, wsNameA, wsA, userA);

            retentionClient.createAndGet(
                    retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D)
                            .applyToPast(true)
                            .build(),
                    apiKeyA, wsNameA);

            // --- Workspace B: applyToPast=false ---
            String wsB = randomFraction0WorkspaceId();
            String apiKeyB = UUID.randomUUID().toString();
            String wsNameB = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String userB = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), apiKeyB, wsNameB, wsB, userB);

            retentionClient.createAndGet(
                    retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D)
                            .applyToPast(false)
                            .build(),
                    apiKeyB, wsNameB);

            Instant now = Instant.now();

            // Insert identical 30-day-old trace in BOTH workspaces (expired by 14d rule)
            UUID traceA = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            UUID traceB = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            createTestTrace(traceA, apiKeyA, wsNameA);
            createTestTrace(traceB, apiKeyB, wsNameB);

            awaitData("traces", wsA, 1);
            awaitData("traces", wsB, 1);

            retentionPolicyService.executeRetentionCycle(0, now).block();

            // Workspace A (applyToPast=true): old trace DELETED — standard retention behavior
            assertThat(countRows("traces", wsA)).isZero();

            // Workspace B (applyToPast=false): old trace PRESERVED — data predates the rule
            // (rule.createdAt ≈ now → minId ≈ now → no data matches id >= minId AND id < cutoff)
            assertThat(countRows("traces", wsB)).isEqualTo(1);
            assertThat(countRowsById("traces", traceB)).isEqualTo(1);
        }

        @Test
        @DisplayName("Unlimited retention rules are ignored")
        void unlimitedRetentionRulesAreIgnored() {
            String unlimitedWsId = randomFraction0WorkspaceId();
            String unlimitedApiKey = UUID.randomUUID().toString();
            String unlimitedWsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String unlimitedUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), unlimitedApiKey, unlimitedWsName, unlimitedWsId,
                    unlimitedUser);

            var rule = retentionClient.buildWorkspaceRule(RetentionPeriod.UNLIMITED).build();
            retentionClient.createAndGet(rule, unlimitedApiKey, unlimitedWsName);

            UUID traceId = idGenerator.generateId(Instant.now().minus(500, ChronoUnit.DAYS));
            createTestTrace(traceId, unlimitedApiKey, unlimitedWsName);

            awaitData("traces", unlimitedWsId, 1);

            retentionPolicyService.executeRetentionCycle(0, Instant.now()).block();

            // Data should still be there - unlimited means no deletion
            assertThat(countRows("traces", unlimitedWsId)).isEqualTo(1);
        }
    }

    @Nested
    @DisplayName("Actual ClickHouse deletion verification")
    @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class DeletionVerification {

        @Test
        @DisplayName("Deletion removes only rows with IDs older than cutoff across all tables")
        void deletesOnlyOldRowsAcrossAllTables() {
            // Use unique workspace per test run to avoid data accumulation on surefire retries
            String wsId = randomFraction0WorkspaceId();
            String apiKey = UUID.randomUUID().toString();
            String wsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String user = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), apiKey, wsName, wsId, user);

            var rule = retentionClient.buildWorkspaceRule(RetentionPeriod.BASE_60D).build();
            retentionClient.createAndGet(rule, apiKey, wsName);

            Instant now = Instant.now();
            Instant oldTime = now.minus(90, ChronoUnit.DAYS);
            Instant recentTime = now.minus(30, ChronoUnit.DAYS);

            UUID oldTraceId = idGenerator.generateId(oldTime);
            UUID oldSpanId = idGenerator.generateId(oldTime);
            UUID recentTraceId = idGenerator.generateId(recentTime);
            UUID recentSpanId = idGenerator.generateId(recentTime);

            // Old data (90 days old > 60 day retention -> deleted)
            createTestTrace(oldTraceId, apiKey, wsName);
            createTestSpan(oldSpanId, oldTraceId, apiKey, wsName);
            createTestFeedbackScore(oldTraceId, apiKey, wsName);
            createTestComment(oldTraceId, apiKey, wsName);

            // Recent data (30 days old < 60 day retention -> kept)
            createTestTrace(recentTraceId, apiKey, wsName);
            createTestSpan(recentSpanId, recentTraceId, apiKey, wsName);
            createTestFeedbackScore(recentTraceId, apiKey, wsName);
            createTestComment(recentTraceId, apiKey, wsName);

            awaitData("traces", wsId, 2);
            awaitData("spans", wsId, 2);
            awaitData("authored_feedback_scores", wsId, 2);
            awaitData("comments", wsId, 2);

            retentionPolicyService.executeRetentionCycle(0, now).block();

            // Only recent rows remain
            assertThat(countRows("traces", wsId)).isEqualTo(1);
            assertThat(countRows("spans", wsId)).isEqualTo(1);
            assertThat(countRows("authored_feedback_scores", wsId)).isEqualTo(1);
            assertThat(countRows("comments", wsId)).isEqualTo(1);

            assertThat(countRowsById("traces", recentTraceId)).isEqualTo(1);
            assertThat(countRowsById("spans", recentSpanId)).isEqualTo(1);
            assertThat(countRowsById("traces", oldTraceId)).isZero();
            assertThat(countRowsById("spans", oldSpanId)).isZero();
        }

        @Test
        @DisplayName("Deletion does not touch rows in other workspaces")
        void deletionIsScopedToTargetWorkspaces() {
            String otherWsId = randomFraction0WorkspaceId();
            String otherApiKey = UUID.randomUUID().toString();
            String otherWsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String otherUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), otherApiKey, otherWsName, otherWsId, otherUser);

            Instant oldTime = Instant.now().minus(90, ChronoUnit.DAYS);

            // Insert old data in the OTHER workspace (no retention rule)
            UUID otherTraceId = idGenerator.generateId(oldTime);
            UUID otherSpanId = idGenerator.generateId(oldTime);
            createTestTrace(otherTraceId, otherApiKey, otherWsName);
            createTestSpan(otherSpanId, otherTraceId, otherApiKey, otherWsName);

            awaitData("traces", otherWsId, 1);
            awaitData("spans", otherWsId, 1);

            retentionPolicyService.executeRetentionCycle(0, Instant.now()).block();

            // Other workspace data should be untouched
            assertThat(countRows("traces", otherWsId)).isEqualTo(1);
            assertThat(countRows("spans", otherWsId)).isEqualTo(1);
        }
    }

    @Nested
    @DisplayName("Rule priority resolution")
    @TestInstance(TestInstance.Lifecycle.PER_CLASS)
    class RulePriorityResolution {

        @Test
        @DisplayName("Workspace rule takes priority over organization rule")
        void workspaceRuleTakesPriorityOverOrgRule() {
            String wsId = randomFraction0WorkspaceId();
            String apiKey = UUID.randomUUID().toString();
            String wsName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String user = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), apiKey, wsName, wsId, user);

            // Org rule: 400 days (very permissive)
            var orgRule = retentionClient.buildOrganizationRule(RetentionPeriod.EXTENDED_400D).build();
            retentionClient.createAndGet(orgRule, apiKey, wsName);

            // Workspace rule: 14 days (restrictive) - should win
            var wsRule = retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D).build();
            retentionClient.createAndGet(wsRule, apiKey, wsName);

            Instant now = Instant.now();

            // 30 days old: within org rule (400d) but outside workspace rule (14d)
            UUID traceId30d = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            createTestTrace(traceId30d, apiKey, wsName);

            // 5 days old: within both rules
            UUID traceId5d = idGenerator.generateId(now.minus(5, ChronoUnit.DAYS));
            createTestTrace(traceId5d, apiKey, wsName);

            awaitData("traces", wsId, 2);

            retentionPolicyService.executeRetentionCycle(0, now).block();

            // Workspace rule (14d) wins: 30-day trace deleted, 5-day trace kept
            assertThat(countRows("traces", wsId)).isEqualTo(1);
            assertThat(countRowsById("traces", traceId5d)).isEqualTo(1);
            assertThat(countRowsById("traces", traceId30d)).isZero();
        }

        @Test
        @DisplayName("Organization rule applies when no workspace rule exists")
        void orgRuleAppliesWhenNoWorkspaceRule() {
            String wsOnlyOrg = randomFraction0WorkspaceId();
            String wsOnlyOrgApiKey = UUID.randomUUID().toString();
            String wsOnlyOrgName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String wsOnlyOrgUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), wsOnlyOrgApiKey, wsOnlyOrgName,
                    wsOnlyOrg, wsOnlyOrgUser);

            // Only org rule: 60 days
            var orgRule = retentionClient.buildOrganizationRule(RetentionPeriod.BASE_60D).build();
            retentionClient.createAndGet(orgRule, wsOnlyOrgApiKey, wsOnlyOrgName);

            Instant now = Instant.now();

            // 90 days old: outside org rule (60d)
            UUID oldTraceId = idGenerator.generateId(now.minus(90, ChronoUnit.DAYS));
            createTestTrace(oldTraceId, wsOnlyOrgApiKey, wsOnlyOrgName);

            // 30 days old: within org rule (60d)
            UUID recentTraceId = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            createTestTrace(recentTraceId, wsOnlyOrgApiKey, wsOnlyOrgName);

            awaitData("traces", wsOnlyOrg, 2);

            retentionPolicyService.executeRetentionCycle(0, now).block();

            // Org rule (60d) applies: old trace deleted, recent trace kept
            assertThat(countRows("traces", wsOnlyOrg)).isEqualTo(1);
            assertThat(countRowsById("traces", recentTraceId)).isEqualTo(1);
        }

        @Test
        @DisplayName("Multiple workspaces with different retention periods are handled correctly")
        void multipleWorkspacesDifferentRetention() {
            String ws14d = randomFraction0WorkspaceId();
            String ws14dApiKey = UUID.randomUUID().toString();
            String ws14dName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String ws14dUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), ws14dApiKey, ws14dName, ws14d, ws14dUser);

            String ws400d = randomFraction0WorkspaceId();
            String ws400dApiKey = UUID.randomUUID().toString();
            String ws400dName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String ws400dUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), ws400dApiKey, ws400dName, ws400d, ws400dUser);

            // ws14d: strict 14-day retention
            retentionClient.createAndGet(
                    retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D).build(),
                    ws14dApiKey, ws14dName);

            // ws400d: lenient 400-day retention
            retentionClient.createAndGet(
                    retentionClient.buildWorkspaceRule(RetentionPeriod.EXTENDED_400D).build(),
                    ws400dApiKey, ws400dName);

            Instant now = Instant.now();

            // 30-day old trace in both workspaces
            UUID trace14d = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            UUID trace400d = idGenerator.generateId(now.minus(30, ChronoUnit.DAYS));
            createTestTrace(trace14d, ws14dApiKey, ws14dName);
            createTestTrace(trace400d, ws400dApiKey, ws400dName);

            awaitData("traces", ws14d, 1);
            awaitData("traces", ws400d, 1);

            retentionPolicyService.executeRetentionCycle(0, now).block();

            // ws14d: 30 days > 14 day retention -> deleted
            assertThat(countRows("traces", ws14d)).isZero();

            // ws400d: 30 days < 400 day retention -> kept
            assertThat(countRows("traces", ws400d)).isEqualTo(1);
        }

        @Test
        @DisplayName("Disabled rules are not executed")
        void disabledRulesNotExecuted() {
            String wsDisabled = randomFraction0WorkspaceId();
            String wsDisabledApiKey = UUID.randomUUID().toString();
            String wsDisabledName = "workspace" + RandomStringUtils.secure().nextAlphanumeric(36);
            String wsDisabledUser = "user-" + RandomStringUtils.secure().nextAlphanumeric(36);
            AuthTestUtils.mockTargetWorkspace(wireMock.server(), wsDisabledApiKey, wsDisabledName,
                    wsDisabled, wsDisabledUser);

            // Create and then deactivate
            var rule = retentionClient.buildWorkspaceRule(RetentionPeriod.SHORT_14D).build();
            var created = retentionClient.createAndGet(rule, wsDisabledApiKey, wsDisabledName);
            retentionClient.deactivate(created.id(), wsDisabledApiKey, wsDisabledName);

            UUID oldTraceId = idGenerator.generateId(Instant.now().minus(90, ChronoUnit.DAYS));
            createTestTrace(oldTraceId, wsDisabledApiKey, wsDisabledName);

            awaitData("traces", wsDisabled, 1);

            retentionPolicyService.executeRetentionCycle(0, Instant.now()).block();

            // Data should still be there - rule was deactivated
            assertThat(countRows("traces", wsDisabled)).isEqualTo(1);
        }
    }

    // Generates unique workspace IDs in fraction 0's hex range (00xxxxxx-...)
    // so each test run gets its own workspace even on surefire retries.
    private static final AtomicInteger WORKSPACE_COUNTER = new AtomicInteger(0);

    private static String randomFraction0WorkspaceId() {
        int seq = WORKSPACE_COUNTER.incrementAndGet();
        return String.format("0000%04x-0000-0000-0000-%012x", seq, System.nanoTime() & 0xFFFFFFFFFFFFL);
    }

    // Waits for ClickHouse async inserts to become visible (eventual consistency).
    private void awaitData(String table, String wsId, long expectedCount) {
        Awaitility.await()
                .atMost(Duration.ofSeconds(10))
                .pollInterval(Duration.ofMillis(500))
                .untilAsserted(() -> assertThat(countRows(table, wsId)).isEqualTo(expectedCount));
    }

    // -- Resource client insert helpers --

    private void createTestTrace(UUID id, String apiKey, String wsName) {
        traceClient.createTrace(Trace.builder()
                .id(id)
                .name("test-trace")
                .projectName(PROJECT_NAME)
                .startTime(Instant.now())
                .build(), apiKey, wsName);
    }

    private void createTestSpan(UUID id, UUID traceId, String apiKey, String wsName) {
        spanClient.createSpan(Span.builder()
                .id(id)
                .traceId(traceId)
                .name("test-span")
                .type(SpanType.general)
                .projectName(PROJECT_NAME)
                .startTime(Instant.now())
                .build(), apiKey, wsName);
    }

    private void createTestFeedbackScore(UUID entityId, String apiKey, String wsName) {
        traceClient.feedbackScores(List.of(FeedbackScoreBatchItem.builder()
                .id(entityId)
                .name("test-score")
                .value(BigDecimal.ONE)
                .source(ScoreSource.SDK)
                .projectName(PROJECT_NAME)
                .build()), apiKey, wsName);
    }

    private void createTestComment(UUID entityId, String apiKey, String wsName) {
        traceClient.createComment(
                Comment.builder().text("test-comment").build(),
                entityId, apiKey, wsName, 201);
    }

    // -- ClickHouse read helpers for verification --

    private long countRows(String table, String wsId) {
        return templateAsync.nonTransaction(connection -> {
            var sql = "SELECT count() as cnt FROM %s WHERE workspace_id = '%s'".formatted(table, wsId);
            return Mono.from(connection.createStatement(sql).execute())
                    .flatMap(result -> Mono.from(result.map((row, metadata) -> row.get("cnt", Long.class))));
        }).block();
    }

    private long countRowsById(String table, UUID id) {
        return templateAsync.nonTransaction(connection -> {
            var sql = "SELECT count() as cnt FROM %s WHERE id = '%s'".formatted(table, id);
            return Mono.from(connection.createStatement(sql).execute())
                    .flatMap(result -> Mono.from(result.map((row, metadata) -> row.get("cnt", Long.class))));
        }).block();
    }
}
