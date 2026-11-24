package com.devquest.auth;

import jakarta.servlet.DispatcherType;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.authentication.rememberme.JdbcTokenRepositoryImpl;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfFilter;

/**
 * 로그인하지 않으면 로그인 화면 말고는 아무것도 볼 수 없어요.
 * <ul>
 *   <li>로그인 상태는 세션(DB 저장, Spring Session JDBC)으로 유지</li>
 *   <li>"로그인 유지"를 고르면 DB 토큰 방식 자동 로그인 쿠키(30일)를 줘요</li>
 *   <li>CSRF: XSRF-TOKEN 쿠키 값을 X-XSRF-TOKEN 헤더로 보내야 POST/PUT/DELETE 가 통과해요 (shared/dq.js 의 DevQuest.api)</li>
 * </ul>
 */
@Configuration
@EnableScheduling
public class SecurityConfig {

    public static final Duration REMEMBER_ME_VALIDITY = Duration.ofDays(30);

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, SafeRememberMeServices rememberMe) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers("/login", "/login/", "/login/**", "/shared/dq.css", "/shared/dq.js", "/favicon.ico").permitAll()
                .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/signup").permitAll()
                .anyRequest().authenticated())
            .csrf(csrf -> csrf.spa())
            .addFilterAfter(new CsrfCookieFilter(), CsrfFilter.class)
            .rememberMe(rm -> rm.rememberMeServices(rememberMe).key(rememberMe.getKey()))
            .logout(logout -> logout
                .logoutUrl("/api/auth/logout")
                .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT))
                .deleteCookies("SESSION"))
            .exceptionHandling(ex -> ex.authenticationEntryPoint(new LoginRedirectEntryPoint()))
            .requestCache(cache -> cache.disable()) // 돌아갈 주소는 로그인 화면의 next 로 넘겨요
            .formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable);
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder(); // 기본 bcrypt, 나중에 바꿔도 옛 해시를 읽을 수 있어요
    }

    @Bean
    AuthenticationManager authenticationManager(UserDetailsService users, PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(users);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    @Bean
    PersistentTokenRepository persistentTokenRepository(DataSource dataSource) {
        JdbcTokenRepositoryImpl tokens = new JdbcTokenRepositoryImpl();
        tokens.setDataSource(dataSource);
        return tokens;
    }

    /** key 는 자동 로그인 인증 객체를 이 서버가 만든 것인지 확인하는 값이에요. 토큰 검증 자체는 DB 로 해요. */
    @Bean
    SafeRememberMeServices rememberMeServices(@Value("${devquest.remember-me.key:}") String key,
            UserDetailsService users, PersistentTokenRepository tokens) {
        SafeRememberMeServices services =
                new SafeRememberMeServices(key.isBlank() ? UUID.randomUUID().toString() : key, users, tokens);
        services.setTokenValiditySeconds((int) REMEMBER_ME_VALIDITY.toSeconds());
        services.setCookieName("remember-me");
        return services;
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SessionAuthenticationStrategy sessionAuthenticationStrategy() {
        return new ChangeSessionIdAuthenticationStrategy(); // 로그인하면 세션 ID 를 바꿔 세션 고정 공격을 막아요
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** 로그인 실패: 같은 아이디+IP 로 15분 안에 5번 틀리면 15분 동안 막아요 */
    @Bean
    AttemptLimiter loginLimiter(Clock clock,
            @Value("${devquest.limits.login-failures:5}") int max) {
        return new AttemptLimiter(max, Duration.ofMinutes(15), clock);
    }

    /** 회원가입: 같은 IP 에서 1시간에 10번까지 */
    @Bean
    AttemptLimiter signupLimiter(Clock clock,
            @Value("${devquest.limits.signups-per-hour:10}") int max) {
        return new AttemptLimiter(max, Duration.ofHours(1), clock);
    }
}
