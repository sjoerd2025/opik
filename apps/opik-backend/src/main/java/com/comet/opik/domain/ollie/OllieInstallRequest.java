package com.comet.opik.domain.ollie;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OllieInstallRequest(
        @JsonProperty("userName") String userName,
        @JsonProperty("opikApiKey") String opikApiKey,
        @JsonProperty("opikWorkspace") String opikWorkspace) {
}
