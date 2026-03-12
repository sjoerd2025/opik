package com.comet.opik.domain;

import com.comet.opik.api.AssertionResult;
import com.comet.opik.api.ExecutionPolicy;
import com.comet.opik.api.ExperimentItem;
import com.comet.opik.api.ExperimentRunSummary;
import lombok.experimental.UtilityClass;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@UtilityClass
class AssertionResultMapper {

    static final String SUITE_ASSERTION_CATEGORY = "suite_assertion";

    static ExperimentItem enrichWithAssertions(ExperimentItem item) {
        var feedbackScores = item.feedbackScores();
        if (feedbackScores == null || feedbackScores.isEmpty()) {
            return item;
        }

        var partitioned = feedbackScores.stream()
                .collect(Collectors.partitioningBy(
                        fs -> SUITE_ASSERTION_CATEGORY.equals(fs.categoryName())));

        var assertions = partitioned.get(true);
        var regularScores = partitioned.get(false);

        if (assertions.isEmpty()) {
            return item;
        }

        var assertionResults = assertions.stream()
                .map(fs -> AssertionResult.builder()
                        .value(fs.name())
                        .passed(fs.value().compareTo(BigDecimal.ONE) >= 0)
                        .reason(fs.reason())
                        .build())
                .toList();

        boolean allPassed = assertionResults.stream().allMatch(AssertionResult::passed);

        return item.toBuilder()
                .feedbackScores(regularScores.isEmpty() ? null : regularScores)
                .assertionResults(assertionResults)
                .status(allPassed ? "passed" : "failed")
                .build();
    }

    static Map<String, ExperimentRunSummary> computeRunSummaries(List<ExperimentItem> items) {
        if (items == null || items.isEmpty()) {
            return null;
        }

        var byExperiment = items.stream()
                .collect(Collectors.groupingBy(ExperimentItem::experimentId));

        Map<String, ExperimentRunSummary> summaries = new LinkedHashMap<>();

        for (var entry : byExperiment.entrySet()) {
            var group = entry.getValue();
            boolean hasAssertions = group.stream()
                    .anyMatch(i -> i.assertionResults() != null);

            if (!hasAssertions || group.size() <= 1) {
                continue;
            }

            long passedRuns = group.stream()
                    .filter(i -> "passed".equals(i.status()))
                    .count();
            int totalRuns = group.size();

            int passThreshold = group.stream()
                    .map(ExperimentItem::executionPolicy)
                    .filter(ep -> ep != null)
                    .findFirst()
                    .map(ExecutionPolicy::passThreshold)
                    .orElse(1);

            String itemStatus = passedRuns >= passThreshold ? "passed" : "failed";

            summaries.put(entry.getKey().toString(),
                    ExperimentRunSummary.builder()
                            .passedRuns((int) passedRuns)
                            .totalRuns(totalRuns)
                            .status(itemStatus)
                            .build());
        }

        return summaries.isEmpty() ? null : summaries;
    }
}
