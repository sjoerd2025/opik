package com.comet.opik.api.resources.v1.priv;

import com.codahale.metrics.annotation.Timed;
import com.comet.opik.infrastructure.AuthenticationConfig;
import com.comet.opik.infrastructure.OpikConfiguration;
import com.comet.opik.infrastructure.auth.RequestContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.inject.Inject;
import jakarta.inject.Provider;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.URI;

@Path("/v1/private/ollie")
@Produces(MediaType.APPLICATION_JSON)
@Timed
@Slf4j
@RequiredArgsConstructor(onConstructor_ = @Inject)
@Tag(name = "Ollie Compute", description = "Ollie compute engine resources")
public class OllieComputeResource {

    private final @NonNull Client httpClient;
    private final @NonNull OpikConfiguration config;
    private final @NonNull Provider<RequestContext> requestContext;

    @GET
    @Path("/compute")
    @Operation(operationId = "getOllieCompute", summary = "Get Ollie compute URL", description = "Proxies to comet-backend to provision an Ollie pod and return its compute URL", responses = {
            @ApiResponse(responseCode = "200", description = "Compute URL response"),
            @ApiResponse(responseCode = "503", description = "Ollie not enabled")
    })
    public Response getCompute() {
        if (!config.getServiceToggles().isOllieEnabled()) {
            return Response.ok()
                    .entity(new DisabledResponse("", false))
                    .build();
        }

        AuthenticationConfig.UrlConfig reactService = config.getAuthentication().getReactService();
        String apiKey = requestContext.get().getApiKey();

        try (Response upstreamResponse = httpClient.target(URI.create(reactService.url()))
                .path("opik")
                .path("ollie")
                .path("compute")
                .request(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, apiKey)
                .get()) {

            String body = upstreamResponse.readEntity(String.class);
            Response.ResponseBuilder builder = Response.status(upstreamResponse.getStatus())
                    .type(MediaType.APPLICATION_JSON)
                    .entity(body);

            for (NewCookie cookie : upstreamResponse.getCookies().values()) {
                builder.cookie(cookie);
            }

            return builder.build();
        } catch (Exception e) {
            log.error("Failed to proxy ollie compute request", e);
            return Response.serverError()
                    .entity(new DisabledResponse("", false))
                    .build();
        }
    }

    record DisabledResponse(String computeUrl, boolean enabled) {
    }
}
