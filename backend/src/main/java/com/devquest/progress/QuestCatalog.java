package com.devquest.progress;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 과목별 퀘스트 목록과 XP 규칙. shared/quests.json (node shared/tools/build-quest-catalog.js 로 생성)을 읽어요.
 * 학습 사이트 파일과 함께 jar 의 static/ 으로 들어와요.
 * 저장할 수 있는 과목도 이 목록으로 정해요 (새 과목은 courses.js 에 추가하고 카탈로그를 다시 만들면 끝).
 */
@Component
public class QuestCatalog {

    static final String RESOURCE = "static/shared/quests.json";

    public record Course(String id, String name, String icon, String doneField, Map<String, Integer> questXp, int maxXp) {
    }

    /** 진행 기록 하나에서 계산한 점수 */
    public record Score(int xp, int done) {
    }

    private final Map<String, Course> courses = new LinkedHashMap<>();

    public QuestCatalog(ObjectMapper json) throws IOException {
        JsonNode root;
        try (InputStream in = new ClassPathResource(RESOURCE).getInputStream()) {
            root = json.readTree(in);
        }
        JsonNode xpTable = root.required("xp");
        for (Map.Entry<String, JsonNode> c : root.required("courses").properties()) {
            JsonNode course = c.getValue();
            Map<String, Integer> questXp = new LinkedHashMap<>();
            for (Map.Entry<String, JsonNode> q : course.required("quests").properties()) {
                questXp.put(q.getKey(), xpTable.required(q.getValue().asString()).asInt());
            }
            int maxXp = questXp.values().stream().mapToInt(Integer::intValue).sum();
            courses.put(c.getKey(), new Course(c.getKey(), course.path("name").asString(c.getKey()),
                    course.path("icon").asString(""), course.required("doneField").asString(), Map.copyOf(questXp), maxXp));
        }
    }

    public Set<String> courseIds() {
        return courses.keySet();
    }

    public Course course(String id) {
        return courses.get(id);
    }

    public Iterable<Course> courses() {
        return courses.values();
    }

    public int maxXpAll() {
        return courses.values().stream().mapToInt(Course::maxXp).sum();
    }

    public int questCountAll() {
        return courses.values().stream().mapToInt(c -> c.questXp().size()).sum();
    }

    /**
     * 진행 기록에서 완료한 퀘스트를 꺼내 XP 를 더해요. 카탈로그에 없는 id 는 세지 않아요 (최대 XP 를 넘을 수 없어요).
     * doneField 가 배열이면 id 목록, 객체면 값이 있는(null·false·0·빈 문자열이 아닌) 키를 완료로 봐요.
     */
    public Score score(String courseId, JsonNode data) {
        Course course = courses.get(courseId);
        Set<String> ids = doneIds(courseId, data);
        int xp = 0;
        for (String id : ids) xp += course.questXp().get(id);
        return new Score(xp, ids.size());
    }

    /** 진행 기록에서 완료한 퀘스트 id (카탈로그에 있는 것만) */
    public Set<String> doneIds(String courseId, JsonNode data) {
        Course course = courses.get(courseId);
        Set<String> ids = new java.util.LinkedHashSet<>();
        if (course == null || data == null) return ids;
        JsonNode done = data.path(course.doneField());
        if (done.isArray()) {
            for (JsonNode id : done) if (id.isValueNode()) ids.add(id.asString());
        } else if (done.isObject()) {
            for (Map.Entry<String, JsonNode> e : done.properties()) if (truthy(e.getValue())) ids.add(e.getKey());
        }
        ids.retainAll(course.questXp().keySet());
        return ids;
    }

    /** 진행 기록이 완료 시각을 함께 저장해 둔 경우(Git Quest 의 done[id].t, ms) 그 시각. 없으면 null */
    public java.time.Instant recordedAt(String courseId, JsonNode data, String questId) {
        Course course = courses.get(courseId);
        if (course == null || data == null) return null;
        JsonNode t = data.path(course.doneField()).path(questId).path("t");
        return t.isNumber() && t.asLong() > 0 ? java.time.Instant.ofEpochMilli(t.asLong()) : null;
    }

    private static boolean truthy(JsonNode v) {
        if (v == null || v.isNull() || v.isMissingNode()) return false;
        if (v.isBoolean()) return v.booleanValue();
        if (v.isNumber()) return v.doubleValue() != 0;
        if (v.isString()) return !v.asString().isEmpty();
        return true;
    }
}
