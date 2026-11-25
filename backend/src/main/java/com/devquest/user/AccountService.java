package com.devquest.user;

import java.security.SecureRandom;
import java.util.Map;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 비밀번호 변경·복구 코드·관리자 재설정, 그리고 다른 기기 로그인 끊기 */
@Service
public class AccountService {

    private static final char[] TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final UserService userService;
    private final PasswordEncoder passwordEncoder;
    private final PersistentTokenRepository rememberMeTokens;
    private final FindByIndexNameSessionRepository<?> sessions;
    /** 없는 아이디로 복구를 시도해도 bcrypt 비교를 한 번 해서, 응답 시간으로 아이디가 있는지 알 수 없게 해요 */
    private final String dummyHash;

    public AccountService(UserRepository users, UserService userService, PasswordEncoder passwordEncoder,
            PersistentTokenRepository rememberMeTokens, FindByIndexNameSessionRepository<?> sessions) {
        this.users = users;
        this.userService = userService;
        this.passwordEncoder = passwordEncoder;
        this.rememberMeTokens = rememberMeTokens;
        this.sessions = sessions;
        this.dummyHash = passwordEncoder.encode(RecoveryCodes.normalize(RecoveryCodes.generate()));
    }

    /** 새 복구 코드를 만들어 해시만 저장하고, 원래 코드는 이번 한 번만 돌려줘요 */
    @Transactional
    public String issueRecoveryCode(String username) {
        User user = userService.find(username);
        String code = RecoveryCodes.generate();
        user.changeRecoveryCode(passwordEncoder.encode(RecoveryCodes.normalize(code)));
        users.save(user);
        return code;
    }

    /** 계정 메뉴에서 복구 코드를 (다시) 만들 때는 비밀번호를 한 번 더 확인해요 */
    @Transactional
    public String reissueRecoveryCode(String username, String password) {
        checkPassword(userService.find(username), password);
        return issueRecoveryCode(username);
    }

    @Transactional
    public void changePassword(String username, String currentPassword, String newPassword) {
        User user = userService.find(username);
        checkPassword(user, currentPassword);
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) throw new AccountException("지금과 다른 비밀번호를 정해 주세요.", "newPassword");
        user.changePassword(passwordEncoder.encode(newPassword));
        users.save(user);
    }

    /**
     * 아이디 + 복구 코드로 새 비밀번호를 정해요. 맞으면 쓴 복구 코드는 버리고 새 코드를 돌려줘요.
     * 틀리면 아이디가 없는지 코드가 틀렸는지 구분하지 않고 같은 오류를 내요.
     */
    @Transactional
    public String recover(String username, String recoveryCode, String newPassword) {
        User user = users.findByUsernameIgnoreCase(UserService.normalize(username)).orElse(null);
        String normalized = RecoveryCodes.normalize(recoveryCode);
        boolean ok = user != null && user.getRecoveryCodeHash() != null && !normalized.isEmpty()
                && passwordEncoder.matches(normalized, user.getRecoveryCodeHash());
        if (!ok) {
            if (user == null || user.getRecoveryCodeHash() == null) passwordEncoder.matches(normalized, dummyHash);
            throw new AccountException("아이디 또는 복구 코드가 맞지 않아요.", "recoveryCode");
        }
        user.changePassword(passwordEncoder.encode(newPassword));
        String next = RecoveryCodes.generate();
        user.changeRecoveryCode(passwordEncoder.encode(RecoveryCodes.normalize(next)));
        users.save(user);
        return next;
    }

    /** 관리자 임시 비밀번호 발급 (영문 소문자·숫자 12자, 숫자 하나 이상) */
    @Transactional
    public String adminResetPassword(String username) {
        User user = users.findByUsernameIgnoreCase(UserService.normalize(username))
                .orElseThrow(() -> new AccountException("없는 아이디예요.", "username"));
        String temp;
        do {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) sb.append(TEMP_ALPHABET[RANDOM.nextInt(TEMP_ALPHABET.length)]);
            temp = sb.toString();
        } while (!temp.matches(".*\\d.*") || !temp.matches(".*[a-z].*"));
        user.changePassword(passwordEncoder.encode(temp));
        users.save(user);
        return temp;
    }

    /** 이 계정의 다른 세션과 자동 로그인 토큰을 모두 끊어요. keepSessionId 세션(지금 이 기기)만 남겨요 */
    public int endOtherLogins(String username, String keepSessionId) {
        rememberMeTokens.removeUserTokens(username);
        Map<String, ?> all = sessions.findByPrincipalName(username);
        int ended = 0;
        for (String id : all.keySet()) {
            if (id.equals(keepSessionId)) continue;
            sessions.deleteById(id);
            ended++;
        }
        return ended;
    }

    public boolean hasRecoveryCode(User user) {
        return user.getRecoveryCodeHash() != null;
    }

    private void checkPassword(User user, String password) {
        if (password == null || user.getPasswordHash() == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AccountException("지금 비밀번호가 맞지 않아요.", "currentPassword");
        }
    }

    /** 화면에 그대로 보여 줄 문장과 문제가 있는 입력칸 */
    public static class AccountException extends RuntimeException {
        private final String field;

        public AccountException(String message, String field) {
            super(message);
            this.field = field;
        }

        public String getField() {
            return field;
        }
    }
}
