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
        // Group workspaces that share the same (cutoffId, minId) for batching
        Map<CutoffKey, List<WorkspaceRetention>> grouped = resolved.stream()
                .collect(Collectors.groupingBy(wr -> new CutoffKey(wr.cutoffId(), wr.minId())));

        // Sequential execution (concatMap) to avoid overloading ClickHouse — retention
        // deletes can be very large and we don't want to saturate connections or cause
        // excessive merge pressure from parallel mutations.
        return Flux.fromIterable(grouped.entrySet())
                .concatMap(entry -> {
                    var key = entry.getKey();
                    var workspaceIds = entry.getValue().stream()
                            .map(WorkspaceRetention::workspaceId)
                            .toList();
                    return deleteForRetentionLevel(workspaceIds, key.cutoffId(), key.minId());
                })
                .then();
    }

    private record CutoffKey(UUID cutoffId, UUID minId) {
    }

    /**
     * Delete expired data across all tables for a single retention level.
     * Workspace batching is done here so each DAO receives a pre-split batch.
     * Order: feedback_scores → comments → spans → traces (children first).
     */
    private Flux<Long> deleteForRetentionLevel(List<String> workspaceIds, UUID cutoffId, UUID minId) {
        var batches = Lists.partition(workspaceIds, config.getWorkspaceBatchSize());

        return Flux.fromIterable(batches)
                .concatMap(batch -> deleteBatchAcrossTables(batch, cutoffId, minId));
    }

    private Flux<Long> deleteBatchAcrossTables(List<String> batch, UUID cutoffId, UUID minId) {
        return Flux.concat(
                feedbackScoreDAO.deleteForRetention(batch, cutoffId, minId)
                        .onErrorResume(e -> logAndSkip("feedback_scores", batch.size(), e)),
                commentDAO.deleteForRetention(batch, cutoffId, minId)
                        .onErrorResume(e -> logAndSkip("comments", batch.size(), e)),
                spanDAO.deleteForRetention(batch, cutoffId, minId)
                        .onErrorResume(e -> logAndSkip("spans", batch.size(), e)),
                traceDAO.deleteForRetention(batch, cutoffId, minId)
                        .onErrorResume(e -> logAndSkip("traces", batch.size(), e)));
    }

    private Mono<Long> logAndSkip(String table, int batchSize, Throwable error) {
        log.error("Retention delete failed: table='{}', batchSize='{}'", table, batchSize, error);
        return Mono.just(0L);
    }

}
