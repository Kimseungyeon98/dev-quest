plugins {
    java
    id("org.springframework.boot") version "4.1.3"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.devquest"
version = "0.0.1"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

/* 저장소 루트의 학습 사이트(HTML·JS·CSS)를 static/ 으로 복사해서 Spring 이 같은 주소에서 서빙해요.
 * 화이트리스트 방식이라 backend/, .git 같은 파일은 절대 나가지 않아요. 새 과목 폴더를 만들면 여기에도 추가하세요. */
val siteRoot = projectDir.parentFile
val siteIncludes = listOf("index.html", "courses.js", "shared/**", "linux/**", "sql/**", "git/**", "algo/**")

tasks.processResources {
    from(siteRoot) {
        include(siteIncludes)
        exclude("**/tools/**") // 검증·개발용 Node 스크립트
        into("static")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}
