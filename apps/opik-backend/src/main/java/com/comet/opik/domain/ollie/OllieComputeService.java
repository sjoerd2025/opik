package com.comet.opik.domain.ollie;

import com.comet.opik.infrastructure.OllieConfig;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import jakarta.ws.rs.core.NewCookie;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RBucket;
import org.redisson.api.RedissonClient;

import java.security.SecureRandom;
import java.util.concurrent.TimeUnit;

@Singleton
@RequiredArgsConstructor(onConstructor_ = @Inject)
@Slf4j
public class OllieComputeService {

    private static final String REDIS_KEY_PREFIX = "ollie_label_";
    private static final String PPAUTH_COOKIE_KEY = "PPAUTH";
    private static final String LABEL_PREFIX = "ollie";
    private static final int LABEL_RANDOM_LENGTH = 15;
    private static final String LABEL_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final @NonNull OllieOrchestratorClient orchestratorClient;
    private final @NonNull OllieConfig config;
    private final @NonNull RedissonClient redisClient;

    public void warmUp(String userName, String apiKey, String workspace) {
        String label = getOrCreateLabel(userName);
        var request = new OllieInstallRequest(userName, apiKey, workspace);
        orchestratorClient.installAsync(label, request);
    }

    public OllieInstallResponse provision(String userName, String apiKey, String workspace) {
        String label = getOrCreateLabel(userName);
        var request = new OllieInstallRequest(userName, apiKey, workspace);
        return orchestratorClient.install(label, request);
    }

    public NewCookie generateAuthCookie(String browserAuth) {
        return new NewCookie(
                PPAUTH_COOKIE_KEY,
                browserAuth,
                config.getCookiePath() + ";SameSite=" + config.getCookieSameSite(),
                config.getCookieDomain(),
                "",
                config.getCookieMaxAge(),
                config.isCookieSecure(),
                config.isCookieHttpOnly());
    }

    private String getOrCreateLabel(String userName) {
        String redisKey = REDIS_KEY_PREFIX + userName;
        RBucket<String> bucket = redisClient.getBucket(redisKey);
        String label = bucket.get();
        if (label == null) {
            label = generateLabel();
            bucket.set(label, config.getRedisLabelTtlSeconds(), TimeUnit.SECONDS);
        }
        return label;
    }

    private String generateLabel() {
        StringBuilder sb = new StringBuilder(LABEL_PREFIX);
        for (int i = 0; i < LABEL_RANDOM_LENGTH; i++) {
            sb.append(LABEL_CHARS.charAt(RANDOM.nextInt(LABEL_CHARS.length())));
        }
        return sb.toString();
    }
}
