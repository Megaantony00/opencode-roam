package io.github.opencoderemote.app;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Lightweight GitHub Releases update check. */
public final class UpdateChecker {
    public static final class Release {
        public final String version;
        public final String releaseUrl;
        public final String apkUrl;
        public final String apkName;
        public final long apkSize;
        public final String notes;

        Release(String version, String releaseUrl, String apkUrl, String apkName, long apkSize, String notes) {
            this.version = version;
            this.releaseUrl = releaseUrl;
            this.apkUrl = apkUrl == null ? "" : apkUrl;
            this.apkName = apkName == null ? "" : apkName;
            this.apkSize = apkSize;
            this.notes = notes == null ? "" : notes;
        }
    }

    public interface Listener {
        /**
         * @param release the newer release, or null when no update is available;
         * @param upToDate true when the check succeeded and the installed version is current;
         * @param error a user-safe error summary, or null on success.
         */
        void onResult(Release release, boolean upToDate, String error);
    }

    private UpdateChecker() {
    }

    public static void check(String repo, String currentVersion, Listener listener) {
        if (repo == null || repo.isEmpty() || repo.startsWith("OWNER/")) {
            post(listener, null, false, "repository not configured");
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "OpenCodeRoam-Android");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);

                int code = connection.getResponseCode();
                if (code != 200) {
                    post(listener, null, false, "HTTP " + code);
                    return;
                }

                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }

                JSONObject release = new JSONObject(body.toString());
                String tag = release.optString("tag_name", "").replaceFirst("^v", "");
                String htmlUrl = release.optString("html_url", "");
                if (tag.isEmpty() || htmlUrl.isEmpty()) {
                    post(listener, null, false, "invalid release");
                    return;
                }
                if (!isNewer(tag, currentVersion)) {
                    post(listener, null, true, null);
                    return;
                }

                String apkUrl = "";
                String apkName = "";
                long apkSize = 0;
                String notes = release.optString("body", "").trim();
                if (notes.length() > 600) notes = notes.substring(0, 600).trim() + "…";
                JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    JSONObject fallback = null;
                    for (int index = 0; index < assets.length(); index += 1) {
                        JSONObject asset = assets.optJSONObject(index);
                        if (asset == null) continue;
                        String name = asset.optString("name", "");
                        if (!name.toLowerCase().endsWith(".apk")) continue;
                        if (name.toLowerCase().contains("release")) {
                            fallback = asset;
                            break;
                        }
                        if (fallback == null) fallback = asset;
                    }
                    if (fallback != null) {
                        apkUrl = fallback.optString("browser_download_url", "");
                        apkName = fallback.optString("name", "");
                        apkSize = fallback.optLong("size", 0);
                    }
                }

                post(listener, new Release(tag, htmlUrl, apkUrl, apkName, apkSize, notes), false, null);
            } catch (Exception error) {
                post(listener, null, false, error.getClass().getSimpleName());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "opencode-roam-update").start();
    }

    private static void post(Listener listener, Release release, boolean upToDate, String error) {
        new Handler(Looper.getMainLooper()).post(() -> listener.onResult(release, upToDate, error));
    }

    static boolean isNewer(String remote, String current) {
        String[] left = String.valueOf(remote).replaceFirst("^v", "").split("\\.");
        String[] right = String.valueOf(current).replaceFirst("^v", "").split("\\.");
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
