package io.github.opencoderemote.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;

import java.util.Locale;

/**
 * Applies the optional in-app language override. An empty preference means
 * "follow the system language", which is the default.
 */
public final class LocaleHelper {
    public static final String SYSTEM = "";
    private static final String PREFS = "opencode_roam_settings";
    private static final String KEY_LANGUAGE = "language";
    private static final String[] TAGS = {SYSTEM, "it", "en"};

    private LocaleHelper() {
    }

    public static String[] languageTags() {
        return TAGS.clone();
    }

    public static String getLanguage(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY_LANGUAGE, SYSTEM);
        for (String tag : TAGS) {
            if (tag.equals(value)) return tag;
        }
        return SYSTEM;
    }

    public static void setLanguage(Context context, String tag) {
        String value = SYSTEM;
        for (String candidate : TAGS) {
            if (candidate.equals(tag)) {
                value = candidate;
                break;
            }
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LANGUAGE, value)
                .apply();
    }

    public static Context wrap(Context base) {
        String tag = getLanguage(base);
        if (SYSTEM.equals(tag)) return base;

        Locale locale = Locale.forLanguageTag(tag);
        Locale.setDefault(locale);
        Configuration configuration = new Configuration(base.getResources().getConfiguration());
        configuration.setLocale(locale);
        return base.createConfigurationContext(configuration);
    }
}
