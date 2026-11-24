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
COPY --from=build /src/app.jar /app/app.jar
USER app

# 컨테이너 메모리의 75% 까지 힙으로 써요. 포트는 Railway 가 PORT 로 알려 줘요 (기본 8080).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
