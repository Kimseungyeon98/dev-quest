package com.devquest.auth;

import com.devquest.user.AccountService.AccountException;
import com.devquest.user.IdentityService;
import com.devquest.user.IdentityService.Profile;
import com.devquest.user.User;
import com.devquest.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;

/**
 * SSO 로그인이 끝났을 때 (Spring OAuth2 로그인 → 여기).
 * <ul>
 *   <li>로그인: 연결된 계정으로 로그인하고, 없으면 새 계정을 만들어요 (IdentityService)</li>
 *   <li>연결: 계정 메뉴에서 [연결하기]로 시작했으면(세션에 LINK 표시) 지금 계정에 연결해요</li>
 * </ul>
 * 어느 쪽이든 끝나면 SSO 토큰 대신 우리 계정(UserDetails)으로 세션을 다시 만들어요. 그래야 다른 API 가 똑같이 동작해요.
 */
@Component
public class SsoLoginHandler implements AuthenticationSuccessHandler, AuthenticationFailureHandler {

    private static final Logger log = LoggerFactory.getLogger(SsoLoginHandler.class);

    /** 계정 연결을 시작한 계정 아이디 (SsoController 가 넣어요) */
    static final String LINK_USER = "devquest.sso.link";
    /** 로그인 뒤 돌아갈 주소 (SsoController 가 넣어요) */
    static final String NEXT = "devquest.sso.next";
    /** 비밀번호가 없는 SSO 계정의 UserDetails 비밀번호 자리 (아무것과도 맞지 않는 값) */
    private static final String NO_PASSWORD = "{noop}" + UUID.randomUUID() + UUID.randomUUID();

    private final IdentityService identities;
    private final UserService users;
    private final SecurityContextRepository contextRepository;

    public SsoLoginHandler(IdentityService identities, UserService users, SecurityContextRepository contextRepository) {
        this.identities = identities;
        this.users = users;
        this.contextRepository = contextRepository;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response, Authentication auth) throws IOException {
        OAuth2AuthenticationToken token = (OAuth2AuthenticationToken) auth;
        Profile profile = profile(token.getAuthorizedClientRegistrationId(), token.getPrincipal());
        HttpSession session = request.getSession();
        String linkUser = (String) session.getAttribute(LINK_USER);
        String next = (String) session.getAttribute(NEXT);
        session.removeAttribute(LINK_USER);
        session.removeAttribute(NEXT);

        if (linkUser != null) {
            String result;
            try {
                identities.link(linkUser, profile);
                result = "sso=linked&provider=" + enc(profile.provider());
                log.info("SSO 연결: {} ← {}", linkUser, profile.provider());
            } catch (AccountException e) {
                result = "sso_error=" + enc(e.getMessage());
            }
            signIn(users.find(linkUser), request, response); // 연결하던 계정 그대로
            response.sendRedirect("/?" + result + "#account");
            return;
        }

        IdentityService.Login login = identities.login(profile);
        signIn(login.user(), request, response);
        if (login.created()) log.info("SSO 새 계정: {} ({})", login.user().getUsername(), profile.provider());
        response.sendRedirect(login.created() ? "/?sso=new" : safeNext(next));
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response, AuthenticationException e) throws IOException {
        log.info("SSO 로그인 실패: {}", e.getMessage());
        HttpSession session = request.getSession(false);
        boolean linking = session != null && session.getAttribute(LINK_USER) != null;
        if (session != null) { session.removeAttribute(LINK_USER); session.removeAttribute(NEXT); }
        String msg = "로그인 서비스에서 로그인하지 못했어요. 다시 시도해 주세요.";
        response.sendRedirect(linking ? "/?sso_error=" + enc(msg) + "#account" : "/login/?sso_error=" + enc(msg));
    }

    /** 우리 계정으로 세션을 다시 만들어요 */
    private void signIn(User user, HttpServletRequest request, HttpServletResponse response) {
        UserDetails details = userDetails(user);
        Authentication auth = UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
    }

    static UserDetails userDetails(User user) {
        return org.springframework.security.core.userdetails.User.withUsername(user.getUsername())
                .password(user.getPasswordHash() != null ? user.getPasswordHash() : NO_PASSWORD)
                .roles("USER").build();
    }

    /** 서비스마다 다른 사용자 정보 모양을 하나로 */
    @SuppressWarnings("unchecked")
    static Profile profile(String provider, OAuth2User u) {
        Map<String, Object> a = u.getAttributes();
        String subject = u.getName(); // user-name-attribute (google: sub, github·kakao: id)
        String email = str(a.get("email"));
        String name = str(a.get("name"));
        switch (provider) {
            case "github" -> { if (name == null) name = str(a.get("login")); }
            case "kakao" -> {
                Object account = a.get("kakao_account");
                if (account instanceof Map<?, ?> acc) {
                    email = str(acc.get("email"));
                    if (acc.get("profile") instanceof Map<?, ?> prof) name = str(prof.get("nickname"));
                }
                if (name == null && a.get("properties") instanceof Map<?, ?> props) name = str(props.get("nickname"));
            }
            default -> { }
        }
        return new Profile(provider, subject, email, name);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /** 이 사이트 안의 주소만 (//다른사이트 같은 건 막아요) */
    static String safeNext(String next) {
        if (next == null || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.contains("\r") || next.contains("\n")) return "/";
        return next;
    }
}
