package com.devquest.progress;

import com.devquest.progress.ProgressService.CourseProgress;
import com.devquest.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * 내 진행도.
 * <ul>
 *   <li>GET /api/progress → { courses: { 과목: {data, version, updatedAt} } } (저장한 과목만)</li>
 *   <li>GET /api/progress/{course} → {data, version, updatedAt} (없으면 data=null, version=0)</li>
 *   <li>PUT /api/progress/{course} {data, version} → 새 {data, version, updatedAt}. version 이 다르면 409 와 최신 기록(current)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/progress")
public class ProgressController {

    private final ProgressService progress;
    private final UserRepository users;

    public ProgressController(ProgressService progress, UserRepository users) {
        this.progress = progress;
        this.users = users;
    }

    public record AllProgress(Map<String, CourseProgress> courses) {
    }

    public record SaveRequest(
            @NotNull(message = "data 가 필요해요.") JsonNode data,
            @PositiveOrZero(message = "version 은 0 이상이에요.") long version) {
    }

    @GetMapping
    public AllProgress all(@AuthenticationPrincipal UserDetails user) {
        return new AllProgress(progress.getAll(userId(user)));
    }

    @GetMapping("/{course}")
    public CourseProgress one(@AuthenticationPrincipal UserDetails user, @PathVariable String course) {
        return progress.get(userId(user), course);
    }

    @PutMapping("/{course}")
    public CourseProgress save(@AuthenticationPrincipal UserDetails user, @PathVariable String course,
            @Valid @RequestBody SaveRequest body) {
        return progress.save(userId(user), course, body.data(), body.version());
    }

    private long userId(UserDetails user) {
        return users.findIdByUsername(user.getUsername())
                .orElseThrow(() -> new UsernameNotFoundException(user.getUsername())); // 로그인 중에 계정이 지워진 경우
    }
}
