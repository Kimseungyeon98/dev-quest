-- 로그인 세션 (Spring Session JDBC). 서버를 재배포해도 로그인이 유지되도록 DB 에 저장해요.
-- spring-session-jdbc 의 schema-postgresql.sql 과 같은 내용이에요.
create table spring_session (
    primary_id            char(36)     not null,
    session_id            char(36)     not null,
    creation_time         bigint       not null,
    last_access_time      bigint       not null,
    max_inactive_interval int          not null,
    expiry_time           bigint       not null,
    principal_name        varchar(100),
    constraint spring_session_pk primary key (primary_id)
);
create unique index spring_session_ix1 on spring_session (session_id);
create index spring_session_ix2 on spring_session (expiry_time);
create index spring_session_ix3 on spring_session (principal_name);

create table spring_session_attributes (
    session_primary_id char(36)     not null,
    attribute_name     varchar(200) not null,
    attribute_bytes    bytea        not null,
    constraint spring_session_attributes_pk primary key (session_primary_id, attribute_name),
    constraint spring_session_attributes_fk foreign key (session_primary_id)
        references spring_session (primary_id) on delete cascade
);

-- 자동 로그인 토큰 (Spring Security PersistentTokenBasedRememberMeServices).
-- 쿠키에는 series·token 만 들어가고, 쓸 때마다 token 이 바뀌어요. 같은 series 에 옛 token 이 들어오면
-- 쿠키를 도둑맞은 것으로 보고 그 계정의 자동 로그인을 모두 끊어요.
create table persistent_logins (
    username  varchar(64) not null,
    series    varchar(64) primary key,
    token     varchar(64) not null,
    last_used timestamp   not null
);
create index ix_persistent_logins_username on persistent_logins (username);
create index ix_persistent_logins_last_used on persistent_logins (last_used);
