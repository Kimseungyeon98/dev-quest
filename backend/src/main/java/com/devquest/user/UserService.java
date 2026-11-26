package com.devquest.user;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    /** 가입할 때 붙는 기본 닉네임 "모험가1234". 이 모양은 직접 고를 수 없어요 (기본 닉네임과 겹치지 않게) */
    public static final String DEFAULT_NICKNAME_PREFIX = "모험가";
    private static final Pattern DEFAULT_NICKNAME = Pattern.compile("^" + DEFAULT_NICKNAME_PREFIX + "\\d+$");
    /** 한글·영문·숫자·_ 2~12자 */
    public static final Pattern NICKNAME = Pattern.compile("^[가-힣A-Za-z0-9_]{2,12}$");
    private static final Set<String> RESERVED = Set.of("admin", "administrator", "관리자", "운영자", "devquest", "system");

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom random = new SecureRandom();

    public UserService(UserRepository users, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    /** 아이디는 대소문자를 구분하지 않아서 소문자로 맞춰 저장·비교해요 */
    public static String normalize(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }

    public static boolean isDefaultNickname(String nickname) {
        return nickname != null && DEFAULT_NICKNAME.matcher(nickname).matches();
    }

    @Transactional
    public User signUp(String username, String rawPassword) {
        String name = normalize(username);
        if (users.findByUsernameIgnoreCase(name).isPresent()) throw new DuplicateUsernameException(name);
        try {
            return users.saveAndFlush(new User(name, passwordEncoder.encode(rawPassword), newDefaultNickname()));
        } catch (DataIntegrityViolationException e) { // 동시에 같은 아이디로 가입한 경우 (유일 인덱스)
            throw new DuplicateUsernameException(name);
        }
    }

    /**
     * SSO 로 처음 로그인한 사람의 계정을 만들어요. 비밀번호는 없고(비밀번호 로그인 불가),
     * 아이디는 영문 소문자·숫자로 자동으로 정해요 (예: g_k3j9x2ab). 계정 메뉴에서 비밀번호를 만들면 아이디로도 로그인할 수 있어요.
     */
    @Transactional
    public User createSsoUser(String provider) {
        String prefix = (provider == null || provider.isEmpty() ? "s" : provider.substring(0, 1).toLowerCase()) + "_";
        for (int i = 0; i < 20; i++) {
            StringBuilder sb = new StringBuilder(prefix);
            for (int k = 0; k < 8; k++) sb.append(SSO_ALPHABET.charAt(RANDOM.nextInt(SSO_ALPHABET.length())));
            String name = sb.toString();
            if (users.findByUsernameIgnoreCase(name).isPresent()) continue;
            try {
                return users.saveAndFlush(new User(name, null, newDefaultNickname()));
            } catch (DataIntegrityViolationException e) { /* 드물게 겹치면 다시 */ }
        }
        throw new IllegalStateException("SSO 계정 아이디를 만들지 못했어요.");
    }

    private static final String SSO_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
    private static final java.security.SecureRandom RANDOM = new java.security.SecureRandom();

    @Transactional(readOnly = true)
    public User findById(long id) {
        return users.findById(id).orElseThrow(() -> new IllegalStateException("계정이 없어요: " + id));
    }

    @Transactional(readOnly = true)
    public User find(String username) {
        return users.findByUsernameIgnoreCase(username).orElseThrow(() -> new IllegalStateException("계정이 없어요: " + username));
    }

    @Transactional
    public User changeNickname(String username, String requested) {
        String nickname = requested == null ? "" : requested.trim();
        User user = find(username);
        if (nickname.equals(user.getNickname())) return user;
        if (!NICKNAME.matcher(nickname).matches()) throw new InvalidNicknameException("닉네임은 한글·영문·숫자·_ 2~12자예요.");
        if (isDefaultNickname(nickname) || RESERVED.contains(nickname.toLowerCase(Locale.ROOT))) {
            throw new InvalidNicknameException("쓸 수 없는 닉네임이에요.");
        }
        if (!nickname.equalsIgnoreCase(user.getNickname()) && users.existsByNicknameIgnoreCase(nickname)) {
            throw new DuplicateNicknameException();
        }
        user.changeNickname(nickname);
        try {
            return users.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) { // 동시에 같은 닉네임으로 바꾼 경우
            throw new DuplicateNicknameException();
        }
    }

    private String newDefaultNickname() {
        for (int i = 0; i < 20; i++) {
            String candidate = DEFAULT_NICKNAME_PREFIX + (1000 + random.nextInt(9_000_000));
            if (!users.existsByNicknameIgnoreCase(candidate)) return candidate;
        }
        throw new IllegalStateException("기본 닉네임을 만들지 못했어요");
    }

    public static class DuplicateUsernameException extends RuntimeException {
        public DuplicateUsernameException(String username) {
            super("이미 사용 중인 아이디예요: " + username);
        }
    }

    public static class DuplicateNicknameException extends RuntimeException {
        public DuplicateNicknameException() {
            super("이미 사용 중인 닉네임이에요.");
        }
    }

    public static class InvalidNicknameException extends RuntimeException {
        public InvalidNicknameException(String message) {
            super(message);
        }
    }
}
