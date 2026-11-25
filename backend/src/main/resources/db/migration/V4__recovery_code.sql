-- 복구 코드: 비밀번호를 잊었을 때 아이디 + 복구 코드로 새 비밀번호를 정해요 (이메일이 없어서).
-- 가입할 때 한 번만 보여 주고 bcrypt 해시만 저장해요. 쓰면 새 코드로 바뀌어요. 기존 계정은 계정 메뉴에서 만들어요.
alter table users add column recovery_code_hash varchar(100);
