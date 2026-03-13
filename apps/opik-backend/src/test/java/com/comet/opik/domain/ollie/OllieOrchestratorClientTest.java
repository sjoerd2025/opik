package com.comet.opik.domain.ollie;

import com.comet.opik.infrastructure.OllieConfig;
import com.github.tomakehurst.wiremock.WireMockServer;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OllieOrchestratorClientTest {

    private WireMockServer wireMock;
    private OllieOrchestratorClient client;
    private Client httpClient;

    @BeforeAll
    void beforeAll() {
        wireMock = new WireMockServer(0);
        wireMock.start();

        httpClient = ClientBuilder.newClient();
        OllieConfig config = new OllieConfig();
        config.setOrchestratorUrl("http://localhost:" + wireMock.port());
        client = new OllieOrchestratorClient(httpClient, config);
    }

    @AfterAll
    void afterAll() {
        wireMock.stop();
        httpClient.close();
    }

    @BeforeEach
    void setUp() {
        wireMock.resetAll();
    }

    @Test
    void install__sendsCorrectRequestAndParsesResponse() {
        wireMock.stubFor(post(urlEqualTo("/orchestrator/install/ollielabel123"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("""
                                {"computeUrl": "http://pod:9080/api", "browserAuth": "token123"}
                                """)));

        var request = new OllieInstallRequest("user1", "apikey1", "workspace1");
        OllieInstallResponse response = client.install("ollielabel123", request);

        assertThat(response.computeUrl()).isEqualTo("http://pod:9080/api");
        assertThat(response.browserAuth()).isEqualTo("token123");

        wireMock.verify(postRequestedFor(urlEqualTo("/orchestrator/install/ollielabel123"))
                .withRequestBody(equalToJson("""
                        {"userName": "user1", "opikApiKey": "apikey1", "opikWorkspace": "workspace1"}
                        """)));
    }

    @Test
    void install__on429__throwsProvisioningException() {
        wireMock.stubFor(post(urlEqualTo("/orchestrator/install/ollielabel"))
                .willReturn(aResponse().withStatus(429)));

        var request = new OllieInstallRequest("user1", "key1", "ws1");

        assertThatThrownBy(() -> client.install("ollielabel", request))
                .isInstanceOf(OllieProvisioningException.class)
                .hasMessageContaining("too many requests");
    }

    @Test
    void install__on500__throwsProvisioningException() {
        wireMock.stubFor(post(urlEqualTo("/orchestrator/install/ollielabel"))
                .willReturn(aResponse().withStatus(500).withBody("internal error")));

        var request = new OllieInstallRequest("user1", "key1", "ws1");

        assertThatThrownBy(() -> client.install("ollielabel", request))
                .isInstanceOf(OllieProvisioningException.class)
                .hasMessageContaining("500");
    }

    @Test
    void installAsync__firesRequestWithoutBlocking() throws InterruptedException {
        wireMock.stubFor(post(urlEqualTo("/orchestrator/install/ollielabel"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("""
                                {"computeUrl": "http://pod:9080", "browserAuth": "tok"}
                                """)));

        var request = new OllieInstallRequest("user1", "key1", "ws1");
        client.installAsync("ollielabel", request);

        // Give virtual thread time to execute
        Thread.sleep(500);

        wireMock.verify(postRequestedFor(urlEqualTo("/orchestrator/install/ollielabel")));
    }

    @Test
    void installAsync__doesNotThrowOnFailure() throws InterruptedException {
        wireMock.stubFor(post(urlEqualTo("/orchestrator/install/ollielabel"))
                .willReturn(aResponse().withStatus(500)));

        var request = new OllieInstallRequest("user1", "key1", "ws1");

        // Should not throw — errors are logged and swallowed
        client.installAsync("ollielabel", request);
        Thread.sleep(500);
    }
}
