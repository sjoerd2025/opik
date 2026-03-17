package com.comet.opik.infrastructure.llm;

import com.comet.opik.infrastructure.LlmModelRegistryConfig;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
public class LlmModelRegistryService {

    private static final ObjectMapper YAML_MAPPER = new ObjectMapper(new YAMLFactory());
    private static final TypeReference<Map<String, List<LlmModelDefinition>>> REGISTRY_TYPE = new TypeReference<>() {
    };

    private final LlmModelRegistryConfig config;
    private volatile Map<String, List<LlmModelDefinition>> registry;

    public LlmModelRegistryService(@NonNull LlmModelRegistryConfig config) {
        this.config = config;
        this.registry = load();
    }

    public Map<String, List<LlmModelDefinition>> getRegistry() {
        return registry;
    }

    public void reload() {
        try {
            registry = load();
            log.info("LLM model registry reloaded successfully");
        } catch (Exception e) {
            log.error("Failed to reload LLM model registry, keeping previous version", e);
        }
    }

    private Map<String, List<LlmModelDefinition>> load() {
        var defaults = loadClasspathResource(config.getDefaultResource());
        var overridePath = config.getLocalOverridePath();

        if (overridePath == null || overridePath.isBlank()) {
            return Map.copyOf(defaults);
        }

        var path = Path.of(overridePath);
        if (!Files.exists(path)) {
            log.debug("Local override file not found at '{}', using defaults only", overridePath);
            return Map.copyOf(defaults);
        }

        var overrides = loadFileResource(path);
        return Map.copyOf(merge(defaults, overrides));
    }

    private Map<String, List<LlmModelDefinition>> loadClasspathResource(String resourceName) {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            if (is == null) {
                throw new IllegalStateException(
                        "Classpath resource not found: " + resourceName);
            }
            return YAML_MAPPER.readValue(is, REGISTRY_TYPE);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load classpath resource: " + resourceName, e);
        }
    }

    private Map<String, List<LlmModelDefinition>> loadFileResource(Path path) {
        try (InputStream is = Files.newInputStream(path)) {
            return YAML_MAPPER.readValue(is, REGISTRY_TYPE);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load file: " + path, e);
        }
    }

    static Map<String, List<LlmModelDefinition>> merge(
            Map<String, List<LlmModelDefinition>> defaults,
            Map<String, List<LlmModelDefinition>> overrides) {
        var result = new LinkedHashMap<>(defaults);

        overrides.forEach((provider, overrideModels) -> {
            var existing = result.getOrDefault(provider, List.of());
            var existingIds = new LinkedHashMap<String, LlmModelDefinition>();
            existing.forEach(m -> existingIds.put(m.id(), m));

            overrideModels.forEach(m -> existingIds.put(m.id(), m));

            result.put(provider, List.copyOf(existingIds.values()));
        });

        return result;
    }
}
