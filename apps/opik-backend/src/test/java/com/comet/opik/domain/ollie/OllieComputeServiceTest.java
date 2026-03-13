package com.comet.opik.domain.ollie;

import com.comet.opik.infrastructure.OllieConfig;
import jakarta.ws.rs.core.NewCookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.redisson.api.RBucket;
import org.redisson.api.RedissonClient;

import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OllieComputeServiceTest {

    @Mock
    private OllieOrchestratorClient orchestratorClient;
    @Mock
    private RedissonClient redisClient;
    @Mock
    private RBucket<String> bucket;

    private OllieConfig config;
    private OllieComputeService service;

    @BeforeEach
    void setUp() {
        config = new OllieConfig();
        config.setRedisLabelTtlSeconds(86400);
        config.setCookiePath("/");
        config.setCookieSameSite("None");
        config.setCookieSecure(true);
        config.setCookieHttpOnly(true);
        config.setCookieMaxAge(86400);
        service = new OllieComputeService(orchestratorClient, config, redisClient);
    }

    @Nested
    class LabelManagement {

        @Test
        void provision__whenNoLabelInRedis__generatesAndStoresNewLabel() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn(null);
            when(orchestratorClient.install(anyString(), any()))
                    .thenReturn(new OllieInstallResponse("http://pod:9080", "auth123"));

            service.provision("user1", "key1", "ws1");

            ArgumentCaptor<String> labelCaptor = ArgumentCaptor.forClass(String.class);
            verify(bucket).set(labelCaptor.capture(), eq(86400L), eq(TimeUnit.SECONDS));

            String label = labelCaptor.getValue();
            assertThat(label).startsWith("ollie");
            assertThat(label).hasSize(20); // "ollie" (5) + 15 random chars
            assertThat(label).matches("[a-z0-9]+");
        }

        @Test
        void provision__whenLabelExistsInRedis__reusesExistingLabel() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn("olliexyz123abc456de");
            when(orchestratorClient.install(anyString(), any()))
                    .thenReturn(new OllieInstallResponse("http://pod:9080", "auth123"));

            service.provision("user1", "key1", "ws1");

            verify(orchestratorClient).install(eq("olliexyz123abc456de"), any());
        }

        @Test
        void provision__redisKeyIsUserScoped() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn("olliexyz");
            when(orchestratorClient.install(anyString(), any()))
                    .thenReturn(new OllieInstallResponse("http://pod:9080", "auth123"));

            service.provision("user1", "key1", "ws1");

            verify(redisClient).getBucket("ollie_label_user1");
        }
    }

    @Nested
    class Provisioning {

        @Test
        void provision__sendsCorrectRequestToOrchestrator() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn("ollielabel123");
            when(orchestratorClient.install(anyString(), any()))
                    .thenReturn(new OllieInstallResponse("http://pod:9080", "auth123"));

            service.provision("user1", "apikey1", "workspace1");

            ArgumentCaptor<OllieInstallRequest> requestCaptor = ArgumentCaptor.forClass(OllieInstallRequest.class);
            verify(orchestratorClient).install(eq("ollielabel123"), requestCaptor.capture());

            OllieInstallRequest request = requestCaptor.getValue();
            assertThat(request.userName()).isEqualTo("user1");
            assertThat(request.opikApiKey()).isEqualTo("apikey1");
            assertThat(request.opikWorkspace()).isEqualTo("workspace1");
        }

        @Test
        void provision__returnsOrchestratorResponse() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn("ollielabel123");
            when(orchestratorClient.install(anyString(), any()))
                    .thenReturn(new OllieInstallResponse("http://pod:9080/api", "browsertoken"));

            OllieInstallResponse response = service.provision("user1", "key1", "ws1");

            assertThat(response.computeUrl()).isEqualTo("http://pod:9080/api");
            assertThat(response.browserAuth()).isEqualTo("browsertoken");
        }
    }

    @Nested
    class WarmUp {

        @Test
        void warmUp__callsAsyncInstall() {
            when(redisClient.<String>getBucket(anyString())).thenReturn(bucket);
            when(bucket.get()).thenReturn("ollielabel123");

            service.warmUp("user1", "key1", "ws1");

            ArgumentCaptor<OllieInstallRequest> requestCaptor = ArgumentCaptor.forClass(OllieInstallRequest.class);
            verify(orchestratorClient).installAsync(eq("ollielabel123"), requestCaptor.capture());

            OllieInstallRequest request = requestCaptor.getValue();
            assertThat(request.userName()).isEqualTo("user1");
            assertThat(request.opikApiKey()).isEqualTo("key1");
            assertThat(request.opikWorkspace()).isEqualTo("ws1");
        }
    }

    @Nested
    class CookieGeneration {

        @Test
        void generateAuthCookie__setsCorrectAttributes() {
            NewCookie cookie = service.generateAuthCookie("mytoken123");

            assertThat(cookie.getName()).isEqualTo("PPAUTH");
            assertThat(cookie.getValue()).isEqualTo("mytoken123");
            assertThat(cookie.getPath()).startsWith("/");
            assertThat(cookie.getPath()).contains("SameSite=None");
            assertThat(cookie.getMaxAge()).isEqualTo(86400);
            assertThat(cookie.isSecure()).isTrue();
            assertThat(cookie.isHttpOnly()).isTrue();
        }

        @Test
        void generateAuthCookie__respectsConfig() {
            config.setCookiePath("/ollie");
            config.setCookieSameSite("Lax");
            config.setCookieMaxAge(3600);
            config.setCookieSecure(false);

            NewCookie cookie = service.generateAuthCookie("token");

            assertThat(cookie.getPath()).startsWith("/ollie");
            assertThat(cookie.getPath()).contains("SameSite=Lax");
            assertThat(cookie.getMaxAge()).isEqualTo(3600);
            assertThat(cookie.isSecure()).isFalse();
        }
    }
}
