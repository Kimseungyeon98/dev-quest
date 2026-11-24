package com.devquest.user;

import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository users, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    /** 아이디는 대소문자를 구분하지 않아서 소문자로 맞춰 저장·비교해요 */
    public static String normalize(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public User signUp(String username, String rawPassword) {
        String name = normalize(username);
        if (users.findByUsernameIgnoreCase(name).isPresent()) throw new DuplicateUsernameException(name);
        try {
            return users.saveAndFlush(new User(name, passwordEncoder.encode(rawPassword)));
        } catch (DataIntegrityViolationException e) { // 동시에 같은 아이디로 가입한 경우 (유일 인덱스)
            throw new DuplicateUsernameException(name);
        }
    }

    public static class DuplicateUsernameException extends RuntimeException {
        public DuplicateUsernameException(String username) {
            super("이미 사용 중인 아이디예요: " + username);
        }
    }
}
