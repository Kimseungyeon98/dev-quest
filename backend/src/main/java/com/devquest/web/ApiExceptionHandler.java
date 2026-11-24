package com.devquest.web;

import com.devquest.auth.AuthController.BadLoginException;
import com.devquest.auth.AuthController.TooManyAttemptsException;
import com.devquest.progress.ProgressService.BadProgressException;
import com.devquest.progress.ProgressService.ProgressTooLargeException;
import com.devquest.progress.ProgressService.UnknownCourseException;
import com.devquest.progress.ProgressService.VersionConflictException;
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

    @ExceptionHandler(UnknownCourseException.class)
    ResponseEntity<Map<String, String>> unknownCourse(UnknownCourseException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(BadProgressException.class)
    ResponseEntity<Map<String, String>> badProgress(BadProgressException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(ProgressTooLargeException.class)
    ResponseEntity<Map<String, String>> tooLarge(ProgressTooLargeException e) {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE).body(Map.of("error", e.getMessage()));
    }

    /** 다른 기기에서 먼저 저장했어요. 최신 기록(current)을 같이 줘서 프론트가 합친 뒤 다시 저장해요 */
    @ExceptionHandler(VersionConflictException.class)
    ResponseEntity<Map<String, Object>> conflict(VersionConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage(), "current", e.getCurrent()));
    }
}
