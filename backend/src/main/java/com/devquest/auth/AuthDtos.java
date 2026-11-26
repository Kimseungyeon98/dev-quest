package com.devquest.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 인증 API 요청·응답. rememberMe 는 빠져도 되게 Boolean 이에요 (Jackson 3 은 빠진 primitive 를 오류로 봐요) */
public final class AuthDtos {

    private AuthDtos() {
    }

    public record SignupRequest(
            @NotBlank(message = "아이디를 입력해 주세요.")
            @Pattern(regexp = "^[A-Za-z0-9_]{4,20}$", message = "아이디는 영문·숫자·_ 4~20자예요.")
            String username,

            @NotBlank(message = "비밀번호를 입력해 주세요.")
            @Size(min = 8, max = 64, message = "비밀번호는 8~64자예요.")
            @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).*$", message = "비밀번호에 영문과 숫자를 모두 넣어 주세요.")
            String password,

            Boolean rememberMe) {
    }

    public record LoginRequest(
            @NotBlank(message = "아이디를 입력해 주세요.") @Size(max = 64) String username,
            @NotBlank(message = "비밀번호를 입력해 주세요.") @Size(max = 128) String password,
            Boolean rememberMe) {
    }

    /**
     * username 은 로그인 아이디(본인에게만), nickname 은 남에게 보이는 이름. defaultNickname 이면 아직 기본 닉네임이에요.
     * hasRecoveryCode 는 복구 코드를 만들어 뒀는지, recoveryCode 는 방금 새로 만든 코드(이번 응답에서 한 번만, 평소엔 null)예요.
     */
    public record MeResponse(String username, String nickname, boolean defaultNickname, boolean hasRecoveryCode, String recoveryCode,
            boolean hasPassword) {
    }

    public record PasswordChangeRequest(
            @Size(max = 128) String currentPassword, // 비밀번호가 없는 SSO 계정은 비워요 (있는 계정은 서비스에서 확인)
            @NotBlank(message = "새 비밀번호를 입력해 주세요.")
            @Size(min = 8, max = 64, message = "비밀번호는 8~64자예요.")
            @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).*$", message = "비밀번호에 영문과 숫자를 모두 넣어 주세요.")
            String newPassword) {
    }

    /** 비밀번호가 없는 SSO 계정은 password 를 비워요 (있는 계정이 비우면 "지금 비밀번호가 맞지 않아요") */
    public record PasswordConfirmRequest(@Size(max = 128) String password) {
    }

    public record RecoverRequest(
            @NotBlank(message = "아이디를 입력해 주세요.") @Size(max = 64) String username,
            @NotBlank(message = "복구 코드를 입력해 주세요.") @Size(max = 40) String recoveryCode,
            @NotBlank(message = "새 비밀번호를 입력해 주세요.")
            @Size(min = 8, max = 64, message = "비밀번호는 8~64자예요.")
            @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).*$", message = "비밀번호에 영문과 숫자를 모두 넣어 주세요.")
            String newPassword,
            Boolean rememberMe) {
    }

    public record NicknameRequest(@NotBlank(message = "닉네임을 입력해 주세요.") @Size(max = 40) String nickname) {
    }
}
