package com.comet.opik.domain.ollie;

import com.comet.opik.infrastructure.OllieConfig;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.Entity;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Singleton
@RequiredArgsConstructor(onConstructor_ = @Inject)
@Slf4j
public class OllieOrchestratorClient {

    private static final String INSTALL_PATH = "/orchestrator/install/";

    private final @NonNull Client httpClient;
    private final @NonNull OllieConfig config;

    public OllieInstallResponse install(String label, OllieInstallRequest request) {
        String url = config.getOrchestratorUrl() + INSTALL_PATH + label;

        Response response = httpClient.target(url)
                .request(MediaType.APPLICATION_JSON)
                .post(Entity.json(request));

        try {
            if (response.getStatus() == Response.Status.TOO_MANY_REQUESTS.getStatusCode()) {
                throw new OllieProvisioningException("Failed to provision Ollie pod: too many requests");
            }
            if (response.getStatusInfo().getFamily() != Response.Status.Family.SUCCESSFUL) {
                String body = response.readEntity(String.class);
                log.error("Orchestrator install failed: status={}, body={}", response.getStatus(), body);
                throw new OllieProvisioningException(
                        "Failed to provision Ollie pod: orchestrator returned " + response.getStatus());
            }
            return response.readEntity(OllieInstallResponse.class);
        } finally {
            response.close();
        }
    }

    public void installAsync(String label, OllieInstallRequest request) {
        Thread.ofVirtual().start(() -> {
            try {
                install(label, request);
            } catch (Exception e) {
                log.warn("Async Ollie warm-up failed for label={}: {}", label, e.getMessage());
            }
        });
    }
}
