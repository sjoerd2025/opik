package com.comet.opik.infrastructure.llm;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;

@Builder(toBuilder = true)
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LlmModelDefinition(
        @JsonProperty("id") String id,
        @JsonProperty("qualifiedName") String qualifiedName,
        @JsonProperty("structuredOutput") boolean structuredOutput,
        @JsonProperty("reasoning") boolean reasoning) {
}
