package com.devquest.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

class DatabaseUrlEnvironmentPostProcessorTest {

    /** 테스트를 돌리는 컴퓨터의 환경 변수(SPRING_DATASOURCE_URL 등)가 섞이지 않게 비워요 */
    private static StandardEnvironment isolatedEnvironment() {
        var env = new StandardEnvironment();
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        return env;
    }

    @Test
    void Railway_형식을_JDBC_설정으로() {
        var props = DatabaseUrlEnvironmentPostProcessor.toDatasourceProperties(
                "postgresql://postgres:p%40ss%2Fw0rd@postgres.railway.internal:5432/railway");
        assertThat(props).containsEntry("spring.datasource.url", "jdbc:postgresql://postgres.railway.internal:5432/railway")
                .containsEntry("spring.datasource.username", "postgres")
                .containsEntry("spring.datasource.password", "p@ss/w0rd");
    }

    @Test
    void 포트가_없거나_쿼리가_있어도() {
        var props = DatabaseUrlEnvironmentPostProcessor.toDatasourceProperties("postgres://u:pw@db.example.com/app?sslmode=require");
        assertThat(props.get("spring.datasource.url")).isEqualTo("jdbc:postgresql://db.example.com:5432/app?sslmode=require");
    }

    @Test
    void 다른_형식은_무시() {
        assertThat(DatabaseUrlEnvironmentPostProcessor.toDatasourceProperties("mysql://u:p@h/db")).isEmpty();
        assertThat(DatabaseUrlEnvironmentPostProcessor.toDatasourceProperties("not a url")).isEmpty();
    }

    @Test
    void SPRING_DATASOURCE_URL_을_직접_주면_그걸_씀() {
        var env = isolatedEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "DATABASE_URL", "postgresql://u:p@h:5432/db", "SPRING_DATASOURCE_URL", "jdbc:postgresql://other/db")));
        new DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(env, new SpringApplication());
        assertThat(env.getPropertySources().contains(DatabaseUrlEnvironmentPostProcessor.SOURCE_NAME)).isFalse();
    }

    @Test
    void DATABASE_URL_이_application_yml_보다_우선() {
        var env = isolatedEnvironment();
        env.getPropertySources().addLast(new MapPropertySource("applicationYml", Map.of("spring.datasource.url", "jdbc:postgresql://localhost:5433/devquest")));
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of("DATABASE_URL", "postgresql://u:p@h:6543/db")));
        new DatabaseUrlEnvironmentPostProcessor().postProcessEnvironment(env, new SpringApplication());
        assertThat(env.getProperty("spring.datasource.url")).isEqualTo("jdbc:postgresql://h:6543/db");
        assertThat(env.getProperty("spring.datasource.password")).isEqualTo("p");
    }
}
