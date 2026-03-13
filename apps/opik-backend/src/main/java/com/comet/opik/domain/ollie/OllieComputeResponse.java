package com.comet.opik.domain.ollie;

import com.fasterxml.jackson.annotation.JsonProperty;

public record OllieComputeResponse(
        @JsonProperty("computeUrl") String computeUrl,
        @JsonProperty("enabled") boolean enabled) {
}
