package com.devquest.web;

import com.devquest.auth.AuthController.BadLoginException;
import com.devquest.auth.AuthController.TooManyAttemptsException;
import com.devquest.user.UserService.DuplicateUsernameException;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** API 오류는 모두 {"error": "화면에 그대로 보여 줄 문장"} 모양으로 돌려줘요 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> invalid(MethodArgumentNotValidException e) {
        var error = e.getBindingResult().getFieldErrors().stream().findFirst();
        String message = error.map(f -> f.getDefaultMessage()).orElse("입력값을 확인해 주세요.");
        String field = error.map(f -> f.getField()).orElse("");
        return ResponseEntity.badRequest().body(Map.of("error", message, "field", field));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> unreadable() {
        return ResponseEntity.badRequest().body(Map.of("error", "요청 형식이 올바르지 않아요."));
    }

    @ExceptionHandler(DuplicateUsernameException.class)
    ResponseEntity<Map<String, String>> duplicate() {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", "이미 사용 중인 아이디예요.", "field", "username"));
    }

    @ExceptionHandler(BadLoginException.class)
    ResponseEntity<Map<String, String>> badLogin(BadLoginException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(TooManyAttemptsException.class)
    ResponseEntity<Map<String, String>> tooMany(TooManyAttemptsException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(Math.max(1, e.getRetryAfter().toSeconds())))
                .body(Map.of("error", e.getMessage()));
    }
}
