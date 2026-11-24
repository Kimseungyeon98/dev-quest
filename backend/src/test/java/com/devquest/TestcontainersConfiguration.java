package com.devquest;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * 테스트용 PostgreSQL. 기본은 Testcontainers 로 띄우고(Docker 필요),
 * Docker 가 없는 곳에서는 DEVQUEST_TEST_EXTERNAL_DB=true 와 SPRING_DATASOURCE_URL 등으로 이미 떠 있는 DB 를 써요.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    @ConditionalOnProperty(name = "devquest.test.external-db", havingValue = "false", matchIfMissing = true)
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:16-alpine");
    }
}
