package com.devquest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.user.IdentityService.Profile;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;

/** 서비스마다 다른 사용자 정보 → (provider, subject, email, 이름) */
class SsoProfileTest {

    private static Profile of(String provider, Map<String, Object> attrs, String nameKey) {
        return SsoLoginHandler.profile(provider, new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("USER")), attrs, nameKey));
    }

    @Test
    void 구글() {
        Profile p = of("google", Map.of("sub", "1081", "email", "a@gmail.com", "name", "김개발"), "sub");
        assertThat(p).isEqualTo(new Profile("google", "1081", "a@gmail.com", "김개발"));
    }

    @Test
    void 깃허브는_이름이_없으면_로그인_아이디() {
        Profile p = of("github", Map.of("id", 42, "login", "octocat"), "id");
        assertThat(p).isEqualTo(new Profile("github", "42", null, "octocat"));
    }

    @Test
    void 카카오() {
        Profile p = of("kakao", Map.of("id", 777L, "kakao_account", Map.of("email", "k@kakao.com", "profile", Map.of("nickname", "카카오친구"))), "id");
        assertThat(p).isEqualTo(new Profile("kakao", "777", "k@kakao.com", "카카오친구"));
        Profile old = of("kakao", Map.of("id", 778L, "properties", Map.of("nickname", "옛닉")), "id");
        assertThat(old.displayName()).isEqualTo("옛닉");
    }

    @Test
    void 돌아갈_주소는_이_사이트_안만() {
        assertThat(SsoLoginHandler.safeNext("/sql/#q1")).isEqualTo("/sql/#q1");
        assertThat(SsoLoginHandler.safeNext("//evil.com")).isEqualTo("/");
        assertThat(SsoLoginHandler.safeNext("/\\evil.com")).isEqualTo("/");
        assertThat(SsoLoginHandler.safeNext("https://evil.com")).isEqualTo("/");
        assertThat(SsoLoginHandler.safeNext(null)).isEqualTo("/");
    }
}
