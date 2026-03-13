package com.comet.opik.api.resources.v1.priv;

import com.codahale.metrics.annotation.Timed;
import com.comet.opik.domain.ollie.OllieComputeResponse;
import com.comet.opik.domain.ollie.OllieComputeService;
import com.comet.opik.domain.ollie.OllieInstallResponse;
import com.comet.opik.infrastructure.OpikConfiguration;
import com.comet.opik.infrastructure.auth.RequestContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.inject.Inject;
import jakarta.inject.Provider;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Path("/v1/private/ollie")
@Produces(MediaType.APPLICATION_JSON)
@Timed
@Slf4j
@RequiredArgsConstructor(onConstructor_ = @Inject)
@Tag(name = "Ollie", description = "Ollie compute engine management")
public class OllieComputeResource {

    private final @NonNull Provider<RequestContext> requestContext;
    private final @NonNull OllieComputeService computeService;
    private final @NonNull OpikConfiguration config;

    @POST
    @Path("/warm")
    @Operation(operationId = "warmOllie", summary = "Pre-warm Ollie pod", description = "Fire-and-forget pre-provisioning. Call on app open.", responses = {
            @ApiResponse(responseCode = "202", description = "Warm-up initiated")
    })
    public Response warm() {
        if (!config.getServiceToggles().isOllieEnabled()) {
            return Response.status(Response.Status.FORBIDDEN).build();
        }

        var ctx = requestContext.get();
        computeService.warmUp(ctx.getUserName(), ctx.getApiKey(), ctx.getWorkspaceId());
        return Response.accepted().build();
    }

    @GET
    @Path("/compute")
    @Operation(operationId = "getOllieCompute", summary = "Get Ollie compute URL", description = "Provisions pod if needed, returns compute URL and sets auth cookie.", responses = {
            @ApiResponse(responseCode = "200", description = "Compute URL", content = @Content(schema = @Schema(implementation = OllieComputeResponse.class)))
    })
    public Response getCompute() {
        if (!config.getServiceToggles().isOllieEnabled()) {
            return Response.ok(new OllieComputeResponse("", false)).build();
        }

        var ctx = requestContext.get();
        OllieInstallResponse res = computeService.provision(
                ctx.getUserName(), ctx.getApiKey(), ctx.getWorkspaceId());
        return Response.ok(new OllieComputeResponse(res.computeUrl(), true))
                .cookie(computeService.generateAuthCookie(res.browserAuth()))
                .build();
    }
}
