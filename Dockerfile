# Dev Quest 배포 이미지 (Railway 가 이 파일로 빌드해요)
# 빌드 컨텍스트는 저장소 루트예요. 학습 사이트 파일(루트)과 백엔드(backend/)를 함께 써요.

# ---- 1) 빌드: Gradle 로 jar 만들기 (학습 사이트 파일이 jar 안 static/ 으로 들어가요) ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src

# 의존성 먼저 받아 두기 (소스만 바뀌면 이 층은 캐시를 써요)
COPY backend/gradlew backend/settings.gradle.kts backend/build.gradle.kts backend/
COPY backend/gradle backend/gradle
RUN sed -i 's/\r$//' backend/gradlew && chmod +x backend/gradlew \
 && cd backend && ./gradlew --no-daemon -q dependencies > /dev/null

COPY . .
RUN sed -i 's/\r$//' backend/gradlew && chmod +x backend/gradlew \
 && cd backend && ./gradlew --no-daemon -q bootJar -x test \
 && cp build/libs/dev-quest-*.jar /src/app.jar

# ---- 2) 실행: JRE 만 담은 작은 이미지 ----
FROM eclipse-temurin:21-jre
RUN groupadd --system app && useradd --system --gid app --home /app app
WORKDIR /app

# 컨테이너 메모리의 75% 까지 힙으로 써요. 포트는 Railway 가 PORT 로 알려 줘요 (기본 8080).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

# 빨리 깨어나기 (Railway Serverless 로 잠들었다 깰 때 기다리는 시간을 줄여요):
#  - jar 를 풀어 두고(-Djarmode=tools extract), 한 번 미리 띄워서 읽은 클래스를 CDS 아카이브(app.jsa)로 저장해요.
#    다음부터는 아카이브에서 클래스를 바로 올려서 시작 시간이 절반 가까이 줄어요.
#  - 미리 띄울 때는 DB 가 없어서 DB 에 붙는 일(Flyway·스키마 검사)만 끄고, 스프링 컨텍스트가 다 뜨면 바로 끝내요.
#  - 아카이브가 맞지 않으면 JVM 이 그냥 아카이브 없이 떠요 (기본 -Xshare:auto).
COPY --from=build /src/app.jar /tmp/app.jar
RUN java -Djarmode=tools -jar /tmp/app.jar extract --destination /app && rm /tmp/app.jar \
 && java -XX:ArchiveClassesAtExit=/app/app.jsa -Dspring.context.exit=onRefresh \
      -Dspring.flyway.enabled=false -Dspring.jpa.hibernate.ddl-auto=none \
      -Dspring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect \
      -Dspring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false \
      -Dspring.datasource.url=jdbc:postgresql://127.0.0.1:1/none -Dlogging.level.root=warn \
      -jar /app/app.jar > /tmp/cds.log 2>&1 || (cat /tmp/cds.log; exit 1) \
 && rm -f /tmp/cds.log && ls -la /app/app.jsa
USER app

EXPOSE 8080
ENTRYPOINT ["java", "-XX:SharedArchiveFile=/app/app.jsa", "-jar", "/app/app.jar"]
