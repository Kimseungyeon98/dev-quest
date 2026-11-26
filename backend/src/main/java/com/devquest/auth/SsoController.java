package com.devquest.auth;

import com.devquest.user.AccountService.AccountException;
import com.devquest.user.IdentityService;
import com.devquest.user.User;
import com.devquest.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * SSO API. 제공자는 SsoEnvironmentPostProcessor 가 환경 변수(키)로 켜요.
 * <ul>
 *   <li>GET /api/auth/providers — 켜진 제공자 목록 (로그인 화면 버튼). 없으면 []</li>
 *   <li>GET /api/auth/sso/{provider}?next=/sql/ — SSO 로그인 시작 (돌아갈 주소를 기억하고 제공자로 보내요)</li>
 *   <li>GET /api/me/identities — 내 계정에 연결된 로그인과 비밀번호가 있는지</li>
 *   <li>POST /api/me/identities/{provider}/link — 연결 시작 (CSRF 토큰이 필요한 POST 라서 남이 몰래 연결시키지 못해요) → { url }</li>
 *   <li>DELETE /api/me/identities/{provider} — 연결 끊기</li>
 * </ul>
 */
@RestController
@RequestMapping("/api")
public class SsoController {

    private final ObjectProvider<ClientRegistrationRepository> registrations;
    private final IdentityService identities;
    private final UserService users;

    public SsoController(ObjectProvider<ClientRegistrationRepository> registrations, IdentityService identities, UserService users) {
        this.registrations = registrations;
        this.identities = identities;
        this.users = users;
    }

    public record Provider(String id, String name) {
    }

    public record Identities(boolean hasPassword, List<IdentityService.Identity> identities, List<Provider> providers) {
    }

    @GetMapping("/auth/providers")
    public List<Provider> providers() {
        List<Provider> list = new ArrayList<>();
        ClientRegistrationRepository repo = registrations.getIfAvailable();
        if (repo instanceof Iterable<?> all) {
            for (Object o : all) {
                ClientRegistration r = (ClientRegistration) o;
                list.add(new Provider(r.getRegistrationId(), IdentityService.label(r.getRegistrationId())));
            }
        }
        return list;
    }

    @GetMapping("/auth/sso/{provider}")
    public void start(@PathVariable String provider, @RequestParam(required = false) String next,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!enabled(provider)) { response.sendRedirect("/login/"); return; }
        request.getSession().setAttribute(SsoLoginHandler.NEXT, SsoLoginHandler.safeNext(next));
        request.getSession().removeAttribute(SsoLoginHandler.LINK_USER);
        response.sendRedirect("/oauth2/authorization/" + provider);
    }

    @GetMapping("/me/identities")
    public Identities mine(@AuthenticationPrincipal UserDetails me) {
        User user = users.find(me.getUsername());
        return new Identities(user.getPasswordHash() != null, identities.list(user.getId()), providers());
    }

    @PostMapping("/me/identities/{provider}/link")
    public Map<String, String> link(@AuthenticationPrincipal UserDetails me, @PathVariable String provider, HttpServletRequest request) {
        if (!enabled(provider)) throw new AccountException("지금은 쓸 수 없는 로그인 서비스예요.", "provider");
        request.getSession().setAttribute(SsoLoginHandler.LINK_USER, me.getUsername());
        return Map.of("url", "/oauth2/authorization/" + provider);
    }

    @DeleteMapping("/me/identities/{provider}")
    public ResponseEntity<Identities> unlink(@AuthenticationPrincipal UserDetails me, @PathVariable String provider) {
        identities.unlink(me.getUsername(), provider);
        return ResponseEntity.ok(mine(me));
    }

    private boolean enabled(String provider) {
        return providers().stream().anyMatch(p -> p.id().equals(provider));
    }
}
