package com.comet.opik.infrastructure.ollie;

import com.comet.opik.domain.ollie.OllieOrchestratorClient;
import com.comet.opik.infrastructure.OllieConfig;
import com.comet.opik.infrastructure.OpikConfiguration;
import com.google.inject.AbstractModule;
import com.google.inject.Provides;
import jakarta.inject.Singleton;
import jakarta.ws.rs.client.Client;

public class OllieModule extends AbstractModule {

    @Provides
    @Singleton
    public OllieConfig ollieConfig(OpikConfiguration config) {
        return config.getOllie();
    }

    @Provides
    @Singleton
    public OllieOrchestratorClient orchestratorClient(Client httpClient, OllieConfig config) {
        return new OllieOrchestratorClient(httpClient, config);
    }
}
