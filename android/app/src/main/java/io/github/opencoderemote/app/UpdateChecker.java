package io.github.opencoderemote.app;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Lightweight GitHub Releases update check. Never installs silently. */
public final class UpdateChecker {
    public interface Listener {
        void onUpdate(String version, String releaseUrl);
    }

    private UpdateChecker() {
    }

    public static void check(String repo, String currentVersion, Listener listener) {
        if (repo == null || repo.isEmpty() || repo.startsWith("OWNER/")) return;

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "OpenCodeRoam-Android");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);

                if (connection.getResponseCode() != 200) return;

                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }

                JSONObject release = new JSONObject(body.toString());
                String tag = release.optString("tag_name", "").replaceFirst("^v", "");
                String htmlUrl = release.optString("html_url", "");
                if (htmlUrl.isEmpty() || !isNewer(tag, currentVersion)) return;

                new Handler(Looper.getMainLooper()).post(() -> listener.onUpdate(tag, htmlUrl));
            } catch (Exception ignored) {
                // Update checks are best effort and must not interrupt the app.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "opencode-roam-update").start();
    }

    private static boolean isNewer(String remote, String current) {
        String[] left = remote.split("\\.");
        String[] right = current.split("\\.");
        int count = Math.max(left.length, right.length);
        for (int index = 0; index < count; index += 1) {
            int a = parsePart(left, index);
            int b = parsePart(right, index);
            if (a != b) return a > b;
        }
        return false;
    }

    private static int parsePart(String[] parts, int index) {
        if (index >= parts.length) return 0;
        try {
            return Integer.parseInt(parts[index].replaceAll("[^0-9].*$", ""));
        } catch (NumberFormatException error) {
            return 0;
        }
    }
}
