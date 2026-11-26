package com.devquest.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** 환경 변수에 키가 있는 SSO 제공자만 켜져요 */
class SsoEnvironmentPostProcessorTest {

    private static Map<String, Object> props(Map<String, String> env) {
        return SsoEnvironmentPostProcessor.properties(env::get);
    }

    @Test
    void 키가_없으면_아무것도_켜지_않음() {
        assertThat(props(Map.of())).isEmpty();
        assertThat(props(Map.of("GOOGLE_CLIENT_ID", "id-only"))).as("비밀 키까지 있어야").isEmpty();
        assertThat(props(Map.of("GITHUB_CLIENT_ID", " ", "GITHUB_CLIENT_SECRET", "s"))).isEmpty();
    }

    @Test
    void 구글_깃허브() {
        Map<String, Object> p = props(Map.of("GOOGLE_CLIENT_ID", "g-id", "GOOGLE_CLIENT_SECRET", "g-secret",
                "GITHUB_CLIENT_ID", "h-id", "GITHUB_CLIENT_SECRET", "h-secret"));
        assertThat(p).containsEntry("spring.security.oauth2.client.registration.google.client-id", "g-id")
                .containsEntry("spring.security.oauth2.client.registration.google.scope", "openid,profile,email")
                .containsEntry("spring.security.oauth2.client.registration.github.client-secret", "h-secret");
        assertThat(p.keySet()).noneMatch(k -> k.contains("kakao"));
    }

    @Test
    void 카카오는_비밀_키가_선택() {
        Map<String, Object> p = props(Map.of("KAKAO_CLIENT_ID", "k-id"));
        assertThat(p).containsEntry("spring.security.oauth2.client.registration.kakao.client-authentication-method", "none")
                .containsEntry("spring.security.oauth2.client.provider.kakao.user-name-attribute", "id")
                .doesNotContainKey("spring.security.oauth2.client.registration.kakao.client-secret");
        assertThat(props(Map.of("KAKAO_CLIENT_ID", "k-id", "KAKAO_CLIENT_SECRET", "k-sec")))
                .containsEntry("spring.security.oauth2.client.registration.kakao.client-authentication-method", "client_secret_post");
    }
}
