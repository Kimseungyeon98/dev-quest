package com.devquest.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 인증 API 요청·응답 */
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

            boolean rememberMe) {
    }

    public record LoginRequest(
            @NotBlank(message = "아이디를 입력해 주세요.") @Size(max = 64) String username,
            @NotBlank(message = "비밀번호를 입력해 주세요.") @Size(max = 128) String password,
            boolean rememberMe) {
    }

    public record MeResponse(String username) {
    }
}
