package com.devquest.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 항상 소문자로 저장해요 ({@link UserService#normalize}) */
    @Column(nullable = false, length = 20)
    private String username;

    /** {bcrypt}... 형식. SSO 로만 가입한 계정은 null (비밀번호 로그인 불가) */
    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    /** 다른 사람에게 보이는 이름 (랭킹 등). 대소문자를 구분하지 않고 하나만 */
    @Column(nullable = false, length = 20)
    private String nickname;

    /** 복구 코드의 {bcrypt} 해시. 아직 만들지 않았으면 null */
    @Column(name = "recovery_code_hash", length = 100)
    private String recoveryCodeHash;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected User() {
    }

    public User(String username, String passwordHash, String nickname) {
        this.username = username;
        this.passwordHash = passwordHash;
        this.nickname = nickname;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getNickname() {
        return nickname;
    }

    public String getRecoveryCodeHash() {
        return recoveryCodeHash;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
        this.updatedAt = Instant.now();
    }

    public void changeRecoveryCode(String recoveryCodeHash) {
        this.recoveryCodeHash = recoveryCodeHash;
        this.updatedAt = Instant.now();
    }

    public void changeNickname(String nickname) {
        this.nickname = nickname;
        this.updatedAt = Instant.now();
    }
}
