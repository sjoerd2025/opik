package com.comet.opik.domain.retention;

import com.comet.opik.api.retention.RetentionLevel;
import com.comet.opik.api.retention.RetentionPeriod;
import com.comet.opik.api.retention.RetentionRule;
import com.comet.opik.domain.CommentDAO;
import com.comet.opik.domain.FeedbackScoreDAO;
import com.comet.opik.domain.IdGenerator;
import com.comet.opik.domain.SpanDAO;
import com.comet.opik.domain.TraceDAO;
import com.comet.opik.infrastructure.RetentionConfig;
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
    private final @NonNull IdGenerator idGenerator;
    private final @NonNull @Config("retention") RetentionConfig config;

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

                    Map<RetentionPeriod, List<String>> grouped = groupByRetention(rules);
                    log.info("Retention cycle: '{}' rules across '{}' retention levels",
                            rules.size(), grouped.size());

                    return executeDeletes(grouped, now);
                })
                .doOnSuccess(__ -> log.info("Retention cycle completed: fraction='{}'", fraction));
    }

    private Mono<Void> executeDeletes(Map<RetentionPeriod, List<String>> grouped, Instant now) {
        return Flux.fromIterable(grouped.entrySet())
                .concatMap(entry -> {
                    var period = entry.getKey();
                    var workspaceIds = entry.getValue();
                    var cutoff = now.minus(period.getDays(), ChronoUnit.DAYS);
                    var cutoffId = idGenerator.generateId(cutoff);

                    return deleteForRetentionLevel(workspaceIds, cutoffId);
                })
                .then();
    }

    /**
     * Delete expired data across all tables for a single retention level.
     * Workspace batching is done here so each DAO receives a pre-split batch.
     * Order: feedback_scores → comments → spans → traces (children first).
     */
    private Flux<Long> deleteForRetentionLevel(List<String> workspaceIds, UUID cutoffId) {
        var batches = Lists.partition(workspaceIds, config.getWorkspaceBatchSize());

        return Flux.fromIterable(batches)
                .concatMap(batch -> deleteBatchAcrossTables(batch, cutoffId));
    }

    private Flux<Long> deleteBatchAcrossTables(List<String> batch, UUID cutoffId) {
        return Flux.concat(
                feedbackScoreDAO.deleteForRetention(batch, cutoffId)
                        .onErrorResume(e -> logAndSkip("feedback_scores", batch.size(), e)),
                commentDAO.deleteForRetention(batch, cutoffId)
                        .onErrorResume(e -> logAndSkip("comments", batch.size(), e)),
                spanDAO.deleteForRetention(batch, cutoffId)
                        .onErrorResume(e -> logAndSkip("spans", batch.size(), e)),
                traceDAO.deleteForRetention(batch, cutoffId)
                        .onErrorResume(e -> logAndSkip("traces", batch.size(), e)));
    }

    private Mono<Long> logAndSkip(String table, int batchSize, Throwable error) {
        log.error("Retention delete failed: table='{}', batchSize='{}'", table, batchSize, error);
        return Mono.just(0L);
    }

    /**
     * Resolve priority per workspace (WORKSPACE > ORGANIZATION), then group by retention period.
     * If a workspace has both a WORKSPACE-level and an ORGANIZATION-level rule,
     * only the WORKSPACE-level rule is used.
     */
    private Map<RetentionPeriod, List<String>> groupByRetention(List<RetentionRule> rules) {
        // Priority: WORKSPACE (ordinal 1) < ORGANIZATION (ordinal 0), so higher ordinal wins
        var priorityOrder = Comparator.comparing(
                (RetentionRule r) -> r.level() == RetentionLevel.WORKSPACE ? 0 : 1);

        return rules.stream()
                .collect(Collectors.groupingBy(RetentionRule::workspaceId))
                .values().stream()
                .map(rulesForWs -> rulesForWs.stream().min(priorityOrder).orElseThrow())
                .filter(rule -> Boolean.TRUE.equals(rule.applyToPast()))
                .collect(Collectors.groupingBy(
                        RetentionRule::retention,
                        Collectors.mapping(RetentionRule::workspaceId, Collectors.toList())));
    }

}
