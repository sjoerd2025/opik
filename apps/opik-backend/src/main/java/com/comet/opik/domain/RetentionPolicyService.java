package com.comet.opik.domain;

import com.comet.opik.api.InstantToUUIDMapper;
import com.comet.opik.api.retention.RetentionLevel;
import com.comet.opik.api.retention.RetentionRule;
import com.comet.opik.infrastructure.RetentionConfig;
import com.comet.opik.utils.RetentionUtils;
import com.google.common.collect.Lists;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import ru.vyarus.dropwizard.guice.module.yaml.bind.Config;
import ru.vyarus.guicey.jdbi3.tx.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static com.comet.opik.infrastructure.db.TransactionTemplateAsync.READ_ONLY;

@Slf4j
@Singleton
@RequiredArgsConstructor(onConstructor_ = @Inject)
public class RetentionPolicyService {

    private final @NonNull TransactionTemplate template;
    private final @NonNull TraceDAO traceDAO;
    private final @NonNull SpanDAO spanDAO;
    private final @NonNull FeedbackScoreDAO feedbackScoreDAO;
    private final @NonNull CommentDAO commentDAO;
    private final @NonNull InstantToUUIDMapper uuidMapper;
    private final @NonNull @Config("retention") RetentionConfig config;

    /**
     * Resolved retention parameters for a single workspace.
     * cutoffId: everything with id < cutoffId is eligible for deletion.
     * minId: if non-null, only data with id >= minId is eligible (applyToPast=false).
     */
    private record WorkspaceRetention(String workspaceId, UUID cutoffId, UUID minId) {
    }

    /**
     * Execute one retention cycle for the given fraction.
     * Testable: takes explicit fraction and timestamp, no timer/clock dependency.
     */
    public Mono<Void> executeRetentionCycle(int fraction, Instant now) {
        var range = RetentionUtils.computeWorkspaceRange(fraction, config.getTotalFractions());
        log.info("Retention cycle starting: fraction='{}', range=['{}', '{}')", fraction, range[0], range[1]);

        return Mono.fromCallable(() -> template.inTransaction(READ_ONLY, handle -> {
            var dao = handle.attach(RetentionRuleDAO.class);
            return dao.findActiveWorkspaceRulesInRange(range[0], range[1]);
        }))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(rules -> {
                    if (rules.isEmpty()) {
                        log.info("Retention cycle: no active rules in range, skipping");
                        return Mono.empty();
                    }

                    List<WorkspaceRetention> resolved = resolveRetentionParams(rules, now);
                    log.info("Retention cycle: '{}' workspaces to process", resolved.size());

                    return executeDeletes(resolved);
                })
                .doOnSuccess(__ -> log.info("Retention cycle completed: fraction='{}'", fraction));
    }

    /**
     * Resolve priority per workspace (WORKSPACE > ORGANIZATION), compute cutoffId and
     * optional minId (for applyToPast=false rules), and filter out unlimited rules.
     */
    private List<WorkspaceRetention> resolveRetentionParams(List<RetentionRule> rules, Instant now) {
        var priorityOrder = Comparator.comparing(
                (RetentionRule r) -> r.level() == RetentionLevel.WORKSPACE ? 0 : 1);

        return rules.stream()
                .collect(Collectors.groupingBy(RetentionRule::workspaceId))
                .values().stream()
                .map(rulesForWs -> rulesForWs.stream().min(priorityOrder).orElseThrow())
                .filter(rule -> rule.retention() != null && rule.retention().getDays() != null
                        && rule.retention().getDays() > 0)
                .map(rule -> {
                    var cutoff = now.truncatedTo(ChronoUnit.DAYS)
                            .minus(rule.retention().getDays(), ChronoUnit.DAYS);
                    var cutoffId = uuidMapper.toLowerBound(cutoff);
                    UUID minId = null;
                    if (!Boolean.TRUE.equals(rule.applyToPast()) && rule.createdAt() != null) {
                        minId = uuidMapper.toLowerBound(rule.createdAt());
                    }
                    return new WorkspaceRetention(rule.workspaceId(), cutoffId, minId);
                })
                .toList();
    }

    private Mono<Void> executeDeletes(List<WorkspaceRetention> resolved) {
        // Group by cutoffId — workspaces with the same retention period share the same cutoff
        // (cutoff is normalized to start-of-day, and periods are pre-defined enum values).
        Map<UUID, List<WorkspaceRetention>> byCutoff = resolved.stream()
                .collect(Collectors.groupingBy(WorkspaceRetention::cutoffId));

        // Sequential execution (concatMap) to avoid overloading ClickHouse — retention
        // deletes can be very large and we don't want to saturate connections or cause
        // excessive merge pressure from parallel mutations.
        return Flux.fromIterable(byCutoff.entrySet())
                .concatMap(entry -> deleteForCutoff(entry.getKey(), entry.getValue()))
                .then();
    }

    /**
     * For a single cutoff, split into two patterns:
     * 1) applyToPast=true (minId=null): simple batch DELETE ... WHERE workspace_id IN (...) AND id < cutoff
     * 2) applyToPast=false (minId!=null): per-workspace bounded DELETE with OR conditions,
     *    packed into a single statement to reduce query count.
     */
    private Flux<Long> deleteForCutoff(UUID cutoffId, List<WorkspaceRetention> workspaces) {
        var applyToPast = workspaces.stream()
                .filter(wr -> wr.minId() == null)
                .map(WorkspaceRetention::workspaceId)
                .toList();

        // Preserve insertion order for deterministic query generation
        var bounded = workspaces.stream()
                .filter(wr -> wr.minId() != null)
                .collect(Collectors.toMap(
                        WorkspaceRetention::workspaceId,
                        WorkspaceRetention::minId,
                        (a, b) -> a,
                        LinkedHashMap::new));

        return Flux.concat(
                deleteApplyToPast(applyToPast, cutoffId),
                deleteBounded(bounded, cutoffId));
    }

    /**
     * Pattern 1: applyToPast=true — standard batch delete, all workspaces in a single IN clause.
     * Order: feedback_scores → comments → spans → traces (children first).
     */
    private Flux<Long> deleteApplyToPast(List<String> workspaceIds, UUID cutoffId) {
        if (workspaceIds.isEmpty()) {
            return Flux.empty();
        }
        var batches = Lists.partition(workspaceIds, config.getWorkspaceBatchSize());
        return Flux.fromIterable(batches)
                .concatMap(batch -> Flux.concat(
                        feedbackScoreDAO.deleteForRetention(batch, cutoffId)
                                .onErrorResume(e -> logAndSkip("feedback_scores", batch.size(), e)),
                        commentDAO.deleteForRetention(batch, cutoffId)
                                .onErrorResume(e -> logAndSkip("comments", batch.size(), e)),
                        spanDAO.deleteForRetention(batch, cutoffId)
                                .onErrorResume(e -> logAndSkip("spans", batch.size(), e)),
                        traceDAO.deleteForRetention(batch, cutoffId)
                                .onErrorResume(e -> logAndSkip("traces", batch.size(), e))));
    }

    /**
     * Pattern 2: applyToPast=false — per-workspace bounded delete.
     * Each workspace has its own minId (derived from the rule's createdAt), packed into a single
     * query using OR conditions:
     *   WHERE id < :cutoff AND ((workspace_id = :w0 AND id >= :min0) OR (workspace_id = :w1 AND id >= :min1) ...)
     * Order: feedback_scores → comments → spans → traces (children first).
     */
    private Flux<Long> deleteBounded(Map<String, UUID> workspaceMinIds, UUID cutoffId) {
        if (workspaceMinIds.isEmpty()) {
            return Flux.empty();
        }
        // Batch by workspaceBatchSize to keep statement size reasonable
        var entries = List.copyOf(workspaceMinIds.entrySet());
        var batches = Lists.partition(entries, config.getWorkspaceBatchSize());
        return Flux.fromIterable(batches)
                .concatMap(batch -> {
                    var batchMap = batch.stream()
                            .collect(Collectors.toMap(
                                    Map.Entry::getKey, Map.Entry::getValue,
                                    (a, b) -> a, LinkedHashMap::new));
                    return Flux.concat(
                            feedbackScoreDAO.deleteForRetentionBounded(batchMap, cutoffId)
                                    .onErrorResume(e -> logAndSkip("feedback_scores", batch.size(), e)),
                            commentDAO.deleteForRetentionBounded(batchMap, cutoffId)
                                    .onErrorResume(e -> logAndSkip("comments", batch.size(), e)),
                            spanDAO.deleteForRetentionBounded(batchMap, cutoffId)
                                    .onErrorResume(e -> logAndSkip("spans", batch.size(), e)),
                            traceDAO.deleteForRetentionBounded(batchMap, cutoffId)
                                    .onErrorResume(e -> logAndSkip("traces", batch.size(), e)));
                });
    }

    private Mono<Long> logAndSkip(String table, int batchSize, Throwable error) {
        log.error("Retention delete failed: table='{}', batchSize='{}'", table, batchSize, error);
        return Mono.just(0L);
    }

}
