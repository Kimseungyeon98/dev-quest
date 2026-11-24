package com.devquest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@org.springframework.test.context.ActiveProfiles("test")
@Import(TestcontainersConfiguration.class)
@Transactional
class SchemaTest {

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void 아이디는_대소문자를_구분하지_않고_하나만() {
        jdbc.update("insert into users (username, password_hash) values ('DevKim', 'x')");
        assertThatThrownBy(() -> jdbc.update("insert into users (username, password_hash) values ('devkim', 'x')"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void 계정을_지우면_진행도도_지워짐() {
        Long id = jdbc.queryForObject(
                "insert into users (username, password_hash) values ('tester', 'x') returning id", Long.class);
        jdbc.update("insert into progress (user_id, course_id, data) values (?, 'algo', '{\"solved\":[]}'::jsonb)", id);
        jdbc.update("delete from users where id = ?", id);
        assertThat(jdbc.queryForObject("select count(*) from progress where user_id = ?", Integer.class, id)).isZero();
    }
}
