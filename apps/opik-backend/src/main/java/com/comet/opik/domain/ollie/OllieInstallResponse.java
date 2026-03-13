package com.comet.opik.domain.ollie;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OllieInstallResponse(
        @JsonProperty("computeUrl") String computeUrl,
        @JsonProperty("browserAuth") String browserAuth) {
}
