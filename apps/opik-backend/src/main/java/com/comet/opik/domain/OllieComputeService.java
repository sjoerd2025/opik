package com.comet.opik.domain;

import com.comet.opik.infrastructure.AuthenticationConfig;
import com.comet.opik.infrastructure.OpikConfiguration;
import com.comet.opik.infrastructure.auth.RequestContext;
import com.google.inject.Singleton;
import jakarta.inject.Inject;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.Invocation;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.URI;
import java.util.Map;

@Singleton
@Slf4j
@RequiredArgsConstructor(onConstructor_ = @Inject)
public class OllieComputeService {

    private final @NonNull Client httpClient;
    private final @NonNull OpikConfiguration config;

    public record OllieComputeResponse(String computeUrl, boolean enabled) {
    }

    public record ProxyResult(int status, String body, Map<String, NewCookie> cookies) {
    }

    private static final OllieComputeResponse DISABLED_RESPONSE = new OllieComputeResponse("", false);

    public OllieComputeResponse getDisabledResponse() {
        return DISABLED_RESPONSE;
    }

    public boolean isEnabled() {
        return config.getServiceToggles().isOllieEnabled();
    }

    public boolean isConfigured() {
        AuthenticationConfig.UrlConfig reactService = config.getAuthentication().getReactService();
        return reactService != null && reactService.url() != null && !reactService.url().isBlank();
    }

    public ProxyResult proxyCompute(String apiKey, String workspaceName, Map<String, Cookie> cookies) {
        AuthenticationConfig.UrlConfig reactService = config.getAuthentication().getReactService();

        Invocation.Builder upstream = httpClient.target(URI.create(reactService.url()))
                .path("opik")
                .path("ollie")
                .path("compute")
                .request(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, apiKey)
                .header(RequestContext.WORKSPACE_HEADER, workspaceName);

        for (Cookie cookie : cookies.values()) {
            upstream = upstream.cookie(cookie);
        }

        try (Response upstreamResponse = upstream.get()) {
            String body = upstreamResponse.readEntity(String.class);
            return new ProxyResult(upstreamResponse.getStatus(), body, upstreamResponse.getCookies());
        }
    }
}
