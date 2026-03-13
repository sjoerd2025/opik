package com.comet.opik.infrastructure;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class OllieConfig {

    @Valid @NotNull @JsonProperty
    private String orchestratorUrl = "http://python-panels-orchestrator:4100";

    @Valid @NotNull @JsonProperty
    private long redisLabelTtlSeconds = 86400;

    @Valid @NotNull @JsonProperty
    private String cookiePath = "/";

    @Valid @JsonProperty
    private String cookieDomain;

    @Valid @NotNull @JsonProperty
    private int cookieMaxAge = 86400;

    @Valid @NotNull @JsonProperty
    private boolean cookieSecure = true;

    @Valid @NotNull @JsonProperty
    private boolean cookieHttpOnly = true;

    @Valid @NotNull @JsonProperty
    private String cookieSameSite = "None";
}
