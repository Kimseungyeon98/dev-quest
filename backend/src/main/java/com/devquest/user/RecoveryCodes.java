package com.devquest.user;

import java.security.SecureRandom;
import java.util.Locale;

/**
 * 복구 코드: 헷갈리는 글자(0 O 1 I L)를 뺀 대문자·숫자 16자, 4자씩 하이픈으로 나눠 보여 줘요 (ABCD-EFGH-JKMN-PQRS).
 * 입력할 때는 대소문자·하이픈·공백을 신경 쓰지 않아도 돼요.
 */
public final class RecoveryCodes {

    private static final char[] ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".toCharArray();
    private static final int LENGTH = 16;
    private static final SecureRandom RANDOM = new SecureRandom();

    private RecoveryCodes() {
    }

    public static String generate() {
        StringBuilder sb = new StringBuilder(LENGTH + 3);
        for (int i = 0; i < LENGTH; i++) {
            if (i > 0 && i % 4 == 0) sb.append('-');
            sb.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
        }
        return sb.toString();
    }

    /** 비교·해시용 모양: 영문·숫자만 대문자로 */
    public static String normalize(String input) {
        return input == null ? "" : input.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }
}
