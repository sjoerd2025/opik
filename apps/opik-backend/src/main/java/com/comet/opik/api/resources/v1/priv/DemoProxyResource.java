package com.comet.opik.api.resources.v1.priv;

import com.comet.opik.infrastructure.OpikConfiguration;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.Entity;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;

/**
 * Temporary proxy to forward demo GEPA trigger requests to the python-backend.
 * AI_REMOVAL_NOTE: Delete this file to remove demo trigger support.
 */
@Path("/v1/demo")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RequiredArgsConstructor(onConstructor_ = @Inject)
public class DemoProxyResource {

    private final @NonNull Client client;
    private final @NonNull OpikConfiguration config;

    private String pythonUrl() {
        return config.getPythonEvaluator().getUrl();
    }

    @POST
    @Path("/run/{scriptKey}")
    public Response runScript(@PathParam("scriptKey") String scriptKey, String body) {
        var resp = client.target(pythonUrl() + "/v1/private/demo/run/" + scriptKey)
                .request(MediaType.APPLICATION_JSON)
                .post(Entity.json(body));
        return Response.status(resp.getStatus()).entity(resp.readEntity(String.class)).build();
    }

    @GET
    @Path("/status")
    public Response status() {
        var resp = client.target(pythonUrl() + "/v1/private/demo/status")
                .request(MediaType.APPLICATION_JSON)
                .get();
        return Response.status(resp.getStatus()).entity(resp.readEntity(String.class)).build();
    }

    @POST
    @Path("/stop/{scriptKey}")
    public Response stopScript(@PathParam("scriptKey") String scriptKey) {
        var resp = client.target(pythonUrl() + "/v1/private/demo/stop/" + scriptKey)
                .request(MediaType.APPLICATION_JSON)
                .post(Entity.json("{}"));
        return Response.status(resp.getStatus()).entity(resp.readEntity(String.class)).build();
    }
}
