package io.github.opencoderemote.app;

import android.app.Activity;
import android.app.Dialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String STATE_REOPEN_SETTINGS = "reopen_settings";
    private static final String STATE_SETTINGS_SCREEN = "settings_screen";
    private static final String INSTALL_ACTION = "io.github.opencoderemote.app.INSTALL_RESULT";

    private static final int BG = Color.rgb(15, 17, 21);
    private static final int PANEL = Color.rgb(30, 34, 43);
    private static final int PANEL_2 = Color.rgb(36, 50, 74);
    private static final int TEXT = Color.rgb(232, 234, 240);
    private static final int MUTED = Color.rgb(154, 163, 178);
    private static final int TEAL = Color.rgb(20, 184, 166);
    private static final int WARN = Color.rgb(251, 191, 36);
    private static final int RED = Color.rgb(248, 113, 113);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SecureStore secureStore;
    private FrameLayout root;
    private QuoteWebView webView;
    private TextView nativeStatusBullet;
    private TextView nativeStatusText;
    private TextView nativeVersionBadge;
    private String baseUrl;
    private String bridgeHost;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingShare;
    private boolean updateChecked;
    private boolean checkingUpdates;
    private boolean onSettingsScreen;
    private boolean reopenSettings;
    private UpdateChecker.Release pendingInstallPermission;
    private Dialog downloadDialog;
    private volatile boolean downloadCancelled;
    private BroadcastReceiver installReceiver;

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(LocaleHelper.wrap(newBase));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        secureStore = new SecureStore(this);
        reopenSettings = savedInstanceState != null
                && (savedInstanceState.getBoolean(STATE_REOPEN_SETTINGS, false)
                || savedInstanceState.getBoolean(STATE_SETTINGS_SCREEN, false));

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(0, bars.top, 0, bars.bottom);
            } else {
                view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);

        handleShareIntent(getIntent());
        if (secureStore.hasCredentials() && !reopenSettings) {
            showChat();
        } else {
            showSettings(!secureStore.hasCredentials(), null);
        }
        reopenSettings = false;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean(STATE_REOPEN_SETTINGS, reopenSettings);
        outState.putBoolean(STATE_SETTINGS_SCREEN, onSettingsScreen);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallPermission != null) {
            UpdateChecker.Release release = pendingInstallPermission;
            pendingInstallPermission = null;
            if (canInstallPackages()) downloadAndInstall(release);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (handleShareIntent(intent) && webView != null) {
            setCookieAndLoad();
        }
    }

    @Override
    public void onBackPressed() {
        if (onSettingsScreen && secureStore.hasCredentials()) {
            showChat();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        unregisterInstallReceiver();
        if (downloadDialog != null) {
            downloadDialog.dismiss();
            downloadDialog = null;
        }
        executor.shutdownNow();
        destroyWebView();
        super.onDestroy();
    }

    private boolean handleShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return false;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return false;
        pendingShare = text.trim();
        return true;
    }

    private void showSettings(boolean firstRun, String message) {
        onSettingsScreen = true;
        baseUrl = null;
        bridgeHost = null;
        destroyWebView();
        root.removeAllViews();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(24), dp(28), dp(24), dp(24));
        scroll.addView(layout, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text(getString(firstRun ? R.string.setup_title : R.string.settings_title), 28, TEXT, true);
        layout.addView(title);

        TextView subtitle = text(
                getString(firstRun ? R.string.setup_subtitle : R.string.settings_subtitle),
                14, MUTED, false);
        subtitle.setPadding(0, dp(6), 0, dp(18));
        layout.addView(subtitle);

        layout.addView(section(getString(R.string.section_connection)));

        layout.addView(label(getString(R.string.label_bridge_url)));
        EditText urlInput = field(
                secureStore.getUrl() == null ? "" : secureStore.getUrl(),
                getString(R.string.hint_bridge_url),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        layout.addView(urlInput);

        layout.addView(label(getString(R.string.label_web_token)));
        EditText tokenInput = field(
                "",
                getString(secureStore.hasCredentials()
                        ? R.string.hint_web_token_keep
                        : R.string.hint_web_token_paste),
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(tokenInput);

        TextView status = text(message == null ? "" : message, 13, message == null ? MUTED : RED, false);
        status.setPadding(0, dp(10), 0, dp(4));
        layout.addView(status);

        Button test = button(getString(R.string.test_connection));
        test.setOnClickListener(view -> testConnection(urlInput, tokenInput, status));
        layout.addView(test);

        Button save = button(getString(R.string.save_open));
        save.setOnClickListener(view -> saveAndOpen(urlInput, tokenInput, status));
        layout.addView(save);

        if (secureStore.hasCredentials()) {
            Button back = button(getString(R.string.back_to_chat));
            back.setOnClickListener(view -> showChat());
            layout.addView(back);

            Button logout = button(getString(R.string.logout_forget));
            logout.setTextColor(RED);
            logout.setOnClickListener(view -> {
                secureStore.clear();
                CookieManager.getInstance().removeAllCookies(null);
                CookieManager.getInstance().flush();
                showSettings(true, null);
            });
            layout.addView(logout);
        }

        layout.addView(section(getString(R.string.section_app)));

        layout.addView(label(getString(R.string.language)));
        Spinner language = languageSpinner();
        layout.addView(language, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView version = text(
                getString(R.string.version_label, BuildConfig.VERSION_NAME),
                13, MUTED, false);
        version.setPadding(0, dp(14), 0, 0);
        layout.addView(version);

        TextView updateStatus = text("", 13, MUTED, false);
        updateStatus.setPadding(0, dp(8), 0, 0);
        layout.addView(updateStatus);

        Button checkUpdates = button(getString(R.string.check_updates));
        checkUpdates.setOnClickListener(view -> runUpdateCheck(true, checkUpdates, updateStatus));
        layout.addView(checkUpdates);

        layout.addView(githubRow());

        TextView note = text(getString(R.string.token_note), 12, MUTED, false);
        note.setPadding(0, dp(18), 0, 0);
        layout.addView(note);

        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private Spinner languageSpinner() {
        Spinner spinner = new Spinner(this);
        String[] labels = {
                getString(R.string.language_system),
                getString(R.string.language_italian),
                getString(R.string.language_english),
        };
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(TEXT);
                view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                return view;
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getDropDownView(position, convertView, parent);
                view.setTextColor(TEXT);
                view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                view.setBackgroundColor(PANEL);
                view.setPadding(dp(12), dp(10), dp(12), dp(10));
                return view;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setPopupBackgroundDrawable(rounded(PANEL, 10));
        spinner.setBackground(rounded(PANEL, 12));
        spinner.setPadding(dp(10), dp(6), dp(10), dp(6));

        String[] tags = LocaleHelper.languageTags();
        String current = LocaleHelper.getLanguage(this);
        int selected = 0;
        for (int index = 0; index < tags.length; index += 1) {
            if (tags[index].equals(current)) selected = index;
        }
        spinner.setSelection(selected);

        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            private boolean initial = true;

            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (initial) {
                    initial = false;
                    return;
                }
                String tag = LocaleHelper.languageTags()[position];
                if (tag.equals(LocaleHelper.getLanguage(MainActivity.this))) return;
                LocaleHelper.setLanguage(MainActivity.this, tag);
                reopenSettings = true;
                recreate();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        return spinner;
    }

    private View githubRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setBackground(rounded(PANEL, 12));
        row.setClickable(true);
        row.setFocusable(true);
        row.setContentDescription(getString(R.string.github_open));
        row.setOnClickListener(view -> handleUrl(
                Uri.parse("https://github.com/" + BuildConfig.GITHUB_REPO)));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_github);
        icon.setContentDescription(null);
        row.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));

        TextView label = text(getString(R.string.github_repository), 15, TEXT, false);
        label.setPadding(dp(12), 0, 0, 0);
        row.addView(label, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView arrow = text("↗", 16, MUTED, false);
        row.addView(arrow);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(12);
        row.setLayoutParams(params);
        return row;
    }

    private void showChat() {
        onSettingsScreen = false;

        String savedUrl = secureStore.getUrl();
        String savedToken = secureStore.getToken();
        if (savedUrl == null || savedToken == null) {
            showSettings(true, getString(R.string.token_url_missing));
            return;
        }

        baseUrl = savedUrl;
        try {
            bridgeHost = new URL(baseUrl).getHost();
        } catch (Exception error) {
            showSettings(true, getString(R.string.invalid_bridge_url));
            return;
        }

        destroyWebView();
        root.removeAllViews();
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(BG);

        LinearLayout topbar = new LinearLayout(this);
        topbar.setOrientation(LinearLayout.HORIZONTAL);
        topbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        topbar.setPadding(dp(12), dp(6), dp(8), dp(6));
        topbar.setBackgroundColor(BG);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(28), dp(28));
        logoParams.rightMargin = dp(8);
        topbar.addView(logo, logoParams);

        LinearLayout titleColumn = new LinearLayout(this);
        titleColumn.setOrientation(LinearLayout.VERTICAL);
        TextView title = text("OpenCode Roam", 15, TEXT, true);
        titleColumn.addView(title);

        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        nativeStatusBullet = text("•", 14, WARN, true);
        nativeStatusBullet.setPadding(0, 0, dp(4), 0);
        statusRow.addView(nativeStatusBullet);

        nativeStatusText = text(getString(R.string.status_connecting), 11, MUTED, false);
        statusRow.addView(nativeStatusText);

        nativeVersionBadge = text(getString(R.string.version_short, BuildConfig.VERSION_NAME), 10, TEXT, true);
        nativeVersionBadge.setBackground(rounded(PANEL_2, 4));
        nativeVersionBadge.setPadding(dp(4), dp(1), dp(4), dp(1));
        LinearLayout.LayoutParams versionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        versionParams.leftMargin = dp(6);
        statusRow.addView(nativeVersionBadge, versionParams);
        titleColumn.addView(statusRow);

        topbar.addView(titleColumn, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button reload = topbarButton("⟳", getString(R.string.reload_chat));
        reload.setOnClickListener(view -> {
            if (webView != null) webView.reload();
        });
        topbar.addView(reload);

        Button settings = topbarButton("⚙", getString(R.string.settings_open));
        settings.setOnClickListener(view -> showSettings(false, null));
        topbar.addView(settings);

        column.addView(topbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new QuoteWebView(this);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setMediaPlaybackRequiresUserGesture(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webSettings.setAllowFileAccess(false);
        webSettings.setAllowContentAccess(true);
        webSettings.setSupportMultipleWindows(false);
        webSettings.setUserAgentString(
                webSettings.getUserAgentString() + " OpenCodeRoamApp/" + BuildConfig.VERSION_NAME);
        webView.addJavascriptInterface(new NativeHeaderBridge(), "ocbNativeHeader");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(
                        "(function(){"
                                + "if(window.__ocbSelectionHook)return;"
                                + "window.__ocbSelectionHook=true;"
                                + "document.addEventListener('selectionchange',function(){"
                                + "window.__ocbSelection=window.getSelection?String(window.getSelection().toString()||''):'';"
                                + "});"
                                + "})()",
                        null);

                if (pendingShare != null && !pendingShare.isEmpty()) {
                    String text = pendingShare;
                    pendingShare = null;
                    String script =
                            "(function(){"
                                    + "var t=" + JSONObject.quote(text) + ";"
                                    + "if(window.ocbQuote){window.ocbQuote(t);return;}"
                                    + "var i=document.getElementById('input');"
                                    + "if(!i)return;"
                                    + "var q=t.split('\\n').map(function(l){return '> '+l;}).join('\\n');"
                                    + "i.value=(i.value.trim()?i.value.trim()+'\\n\\n'+q+'\\n\\n':q+'\\n\\n');"
                                    + "i.dispatchEvent(new Event('input',{bubbles:true}));"
                                    + "i.focus();"
                                    + "})()";
                    try {
                        view.evaluateJavascript(script, null);
                    } catch (Exception ignored) {
                        // Keep the app usable if the page is not ready yet.
                    }
                }

                view.evaluateJavascript(
                        "(function(){"
                                + "return !!(document.querySelector('main.offline')"
                                + "||document.querySelector('[data-ocb-offline]'));"
                                + "})()",
                        value -> {
                            if ("true".equals(value)) {
                                view.post(() -> showNativeOffline(getString(R.string.offline_message)));
                            }
                        });
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showNativeOffline(getString(R.string.offline_message));
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame()) return;
                int code = response.getStatusCode();
                if (code == 401) {
                    view.post(() -> showSettings(true, getString(R.string.token_rejected)));
                } else {
                    view.post(() -> showHttpError(code));
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;

                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                if (intent.resolveActivity(getPackageManager()) == null) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.setType("*/*");
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        column.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(column);

        setCookieAndLoad();

        if (!updateChecked) {
            updateChecked = true;
            UpdateChecker.check(BuildConfig.GITHUB_REPO, BuildConfig.VERSION_NAME,
                    (release, upToDate, error) -> {
                        if (isFinishing() || isDestroyed()) return;
                        if (release != null) showUpdateDialog(release);
                    });
        }
    }

    private void setCookieAndLoad() {
        if (webView == null) return;
        try {
            final String url = baseUrl;
            String cookie = "ocb=" + URLEncoder.encode(secureStore.getToken(), "UTF-8")
                    + "; Path=/; HttpOnly; SameSite=Strict"
                    + (url.startsWith("https://") ? "; Secure" : "");
            CookieManager manager = CookieManager.getInstance();
            manager.removeAllCookies(removed -> {
                manager.setCookie(url, cookie);
                manager.flush();
                runOnUiThread(() -> {
                    if (webView != null) {
                        String language = LocaleHelper.getLanguage(MainActivity.this);
                        String path = url + "/chat";
                        if (!language.isEmpty()) {
                            path += "?lang=" + URLEncoder.encode(language);
                        }
                        webView.loadUrl(path);
                    }
                });
            });
        } catch (Exception error) {
            showSettings(true, getString(R.string.cookie_failed));
        }
    }

    private final class NativeHeaderBridge {
        @JavascriptInterface
        public void update(String status, String version) {
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (webView == null || bridgeHost == null) return;
                Uri current = Uri.parse(String.valueOf(webView.getUrl()));
                if (current.getHost() == null
                        || !current.getHost().equalsIgnoreCase(bridgeHost)) return;
                applyNativeHeader(status, version);
            });
        }
    }

    private void applyNativeHeader(String status, String version) {
        if (nativeStatusBullet == null || nativeStatusText == null || nativeVersionBadge == null) {
            return;
        }

        String value = status == null ? "" : status.toLowerCase(Locale.ROOT);
        int color;
        int label;
        if ("connected".equals(value)) {
            color = TEAL;
            label = R.string.status_connected;
        } else if ("busy".equals(value)) {
            color = TEAL;
            label = R.string.status_busy;
        } else if ("offline".equals(value)) {
            color = RED;
            label = R.string.status_offline;
        } else {
            color = WARN;
            label = R.string.status_connecting;
        }

        nativeStatusBullet.setTextColor(color);
        nativeStatusText.setText(label);
        if ("offline".equals(value)) {
            nativeStatusText.setTextColor(RED);
        } else if ("connected".equals(value) || "busy".equals(value)) {
            nativeStatusText.setTextColor(MUTED);
        } else {
            nativeStatusText.setTextColor(WARN);
        }
        nativeVersionBadge.setText(getString(R.string.version_short, BuildConfig.VERSION_NAME));
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();

        if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                && host != null && host.equalsIgnoreCase(bridgeHost)) {
            return false;
        }

        try {
            if ("intent".equalsIgnoreCase(scheme)) {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                startActivity(intent);
            } else {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            }
        } catch (Exception error) {
            Toast.makeText(this, R.string.no_app_open_link, Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showNativeOffline() {
        showNativeOffline("");
    }

    private void showNativeOffline(String message) {
        onSettingsScreen = false;
        destroyWebView();
        root.removeAllViews();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setPadding(dp(28), dp(28), dp(28), dp(28));
        layout.setBackgroundColor(BG);

        layout.addView(text(getString(R.string.offline_title), 24, TEXT, true));
        TextView detail = text(getString(R.string.offline_message), 15, MUTED, false);
        detail.setPadding(0, dp(10), 0, dp(8));
        detail.setGravity(android.view.Gravity.CENTER);
        layout.addView(detail);

        TextView status = text(message == null ? "" : message, 13, message == null || message.isEmpty() ? MUTED : RED, false);
        status.setGravity(android.view.Gravity.CENTER);
        status.setPadding(0, 0, 0, dp(12));
        layout.addView(status);

        Button tailscale = button(getString(R.string.open_tailscale));
        tailscale.setOnClickListener(view -> handleUrl(Uri.parse("tailscale://navigate")));
        layout.addView(tailscale);

        Button retry = button(getString(R.string.retry));
        retry.setOnClickListener(view -> retryConnection(retry, status));
        layout.addView(retry);

        Button settings = button(getString(R.string.settings));
        settings.setOnClickListener(view -> showSettings(false, null));
        layout.addView(settings);

        root.addView(layout, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showHttpError(int code) {
        onSettingsScreen = false;
        destroyWebView();
        root.removeAllViews();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setPadding(dp(28), dp(28), dp(28), dp(28));
        layout.setBackgroundColor(BG);

        layout.addView(text(getString(R.string.http_error_title), 24, TEXT, true));
        TextView detail = text(getString(R.string.http_error_message, code), 15, MUTED, false);
        detail.setPadding(0, dp(10), 0, dp(8));
        detail.setGravity(android.view.Gravity.CENTER);
        layout.addView(detail);

        TextView hint = text(getString(R.string.http_error_hint), 13, MUTED, false);
        hint.setPadding(0, 0, 0, dp(8));
        hint.setGravity(android.view.Gravity.CENTER);
        layout.addView(hint);

        TextView status = text("", 13, MUTED, false);
        status.setGravity(android.view.Gravity.CENTER);
        status.setPadding(0, 0, 0, dp(12));
        layout.addView(status);

        Button retry = button(getString(R.string.retry));
        retry.setOnClickListener(view -> retryConnection(retry, status));
        layout.addView(retry);

        Button settings = button(getString(R.string.settings));
        settings.setOnClickListener(view -> showSettings(false, null));
        layout.addView(settings);

        Button tailscale = button(getString(R.string.open_tailscale));
        tailscale.setOnClickListener(view -> handleUrl(Uri.parse("tailscale://navigate")));
        layout.addView(tailscale);

        root.addView(layout, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void retryConnection(Button retry, TextView status) {
        if (baseUrl == null || baseUrl.isEmpty()) {
            showSettings(true, null);
            return;
        }

        retry.setEnabled(false);
        if (status != null) {
            status.setTextColor(MUTED);
            status.setText(R.string.checking_connection);
        }

        final String healthUrl = baseUrl + "/healthz";
        try {
            executor.execute(() -> {
                HttpURLConnection connection = null;
                int code = 0;
                try {
                    connection = (HttpURLConnection) new URL(healthUrl).openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(6000);
                    connection.setReadTimeout(6000);
                    connection.setRequestProperty("User-Agent", "OpenCodeRoam-Android");
                    code = connection.getResponseCode();
                } catch (Exception ignored) {
                    code = 0;
                } finally {
                    if (connection != null) connection.disconnect();
                }

                final int result = code;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (result == 200) {
                        showChat();
                        return;
                    }
                    retry.setEnabled(true);
                    if (status != null) {
                        status.setTextColor(RED);
                        status.setText(R.string.still_unreachable);
                    }
                });
            });
        } catch (Exception error) {
            retry.setEnabled(true);
            if (status != null) {
                status.setTextColor(RED);
                status.setText(R.string.still_unreachable);
            }
        }
    }

    private void runUpdateCheck(boolean manual, Button button, TextView status) {
        if (checkingUpdates) return;
        checkingUpdates = true;
        if (manual) {
            if (button != null) button.setEnabled(false);
            if (status != null) {
                status.setTextColor(MUTED);
                status.setText(R.string.checking_updates);
            }
        }

        UpdateChecker.check(BuildConfig.GITHUB_REPO, BuildConfig.VERSION_NAME,
                (release, upToDate, error) -> {
                    checkingUpdates = false;
                    if (isFinishing() || isDestroyed()) return;
                    if (button != null) button.setEnabled(true);
                    if (status != null) {
                        if (error != null) {
                            status.setTextColor(RED);
                            status.setText(R.string.update_check_failed);
                        } else if (release != null) {
                            status.setTextColor(TEAL);
                            status.setText(getString(
                                    R.string.update_available_message,
                                    release.version,
                                    BuildConfig.VERSION_NAME));
                        } else if (upToDate) {
                            status.setTextColor(TEAL);
                            status.setText(getString(
                                    R.string.update_up_to_date,
                                    BuildConfig.VERSION_NAME));
                        }
                    }
                    if (release != null) showUpdateDialog(release);
                });
    }

    private void showUpdateDialog(UpdateChecker.Release release) {
        Dialog dialog = new Dialog(this);
        LinearLayout card = cardLayout();

        card.addView(text(getString(R.string.update_available_title), 21, TEXT, true));

        String subtitleText = getString(
                R.string.update_from_to,
                BuildConfig.VERSION_NAME,
                release.version);
        if (release.apkSize > 0) {
            subtitleText += " · " + formatSize(release.apkSize);
        }
        TextView subtitle = text(subtitleText, 13, MUTED, false);
        subtitle.setPadding(0, dp(6), 0, dp(12));
        card.addView(subtitle);

        TextView summary = text(getString(R.string.update_summary), 13, MUTED, false);
        summary.setPadding(0, 0, 0, dp(4));
        card.addView(summary);

        Button primary = primaryButton(getString(
                release.apkUrl.isEmpty() ? R.string.open_release_page : R.string.update_now));
        primary.setOnClickListener(view -> {
            dialog.dismiss();
            if (release.apkUrl.isEmpty()) {
                handleUrl(Uri.parse(release.releaseUrl));
            } else {
                requestInstall(release);
            }
        });
        card.addView(primary);

        Button later = secondaryButton(getString(R.string.later));
        later.setOnClickListener(view -> dialog.dismiss());
        card.addView(later);

        if (!release.apkUrl.isEmpty()) {
            TextView page = linkButton(getString(R.string.open_release_page));
            page.setOnClickListener(view -> {
                dialog.dismiss();
                handleUrl(Uri.parse(release.releaseUrl));
            });
            card.addView(page);
        }

        showCard(dialog, card);
    }

    private void requestInstall(UpdateChecker.Release release) {
        if (release.apkUrl.isEmpty()) {
            Toast.makeText(this, R.string.update_apk_missing, Toast.LENGTH_LONG).show();
            handleUrl(Uri.parse(release.releaseUrl));
            return;
        }
        if (!canInstallPackages()) {
            Dialog dialog = new Dialog(this);
            LinearLayout card = cardLayout();
            card.addView(eyebrow(getString(R.string.permission_eyebrow)));
            card.addView(text(getString(R.string.install_permission_title), 20, TEXT, true));
            TextView body = text(getString(R.string.install_permission_message), 14, MUTED, false);
            body.setPadding(0, dp(8), 0, 0);
            card.addView(body);

            Button open = primaryButton(getString(R.string.open_settings));
            open.setOnClickListener(view -> {
                dialog.dismiss();
                pendingInstallPermission = release;
                try {
                    startActivity(new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())));
                } catch (Exception error) {
                    pendingInstallPermission = null;
                    Toast.makeText(this, R.string.install_failed, Toast.LENGTH_LONG).show();
                }
            });
            card.addView(open);

            Button cancel = secondaryButton(getString(R.string.cancel));
            cancel.setOnClickListener(view -> {
                pendingInstallPermission = null;
                dialog.dismiss();
            });
            card.addView(cancel);
            showCard(dialog, card);
            return;
        }
        downloadAndInstall(release);
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getPackageManager().canRequestPackageInstalls();
    }

    private void downloadAndInstall(UpdateChecker.Release release) {
        File directory = new File(getCacheDir(), "updates");
        if (!directory.exists() && !directory.mkdirs()) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
            return;
        }
        File[] oldFiles = directory.listFiles();
        if (oldFiles != null) {
            for (File file : oldFiles) file.delete();
        }

        String safeVersion = release.version.replaceAll("[^0-9A-Za-z._-]", "_");
        File target = new File(directory, "opencode-roam-" + safeVersion + ".apk");
        downloadCancelled = false;

        Dialog dialog = new Dialog(this);
        dialog.setCancelable(false);
        LinearLayout card = cardLayout();
        card.addView(eyebrow(getString(R.string.download_eyebrow)));
        card.addView(text(getString(R.string.downloading_update, release.version), 18, TEXT, true));

        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(0);
        bar.setPadding(0, dp(16), 0, dp(6));
        card.addView(bar);

        TextView percent = text(getString(R.string.download_progress, 0), 12, MUTED, false);
        card.addView(percent);

        Button cancel = secondaryButton(getString(R.string.cancel));
        cancel.setOnClickListener(view -> {
            downloadCancelled = true;
            if (downloadDialog != null) {
                downloadDialog.dismiss();
                downloadDialog = null;
            }
        });
        card.addView(cancel);

        downloadDialog = dialog;
        showCard(dialog, card);

        executor.execute(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            OutputStream output = null;
            try {
                URL url = new URL(release.apkUrl);
                if (!"https".equalsIgnoreCase(url.getProtocol()) || !isTrustedDownloadHost(url.getHost())) {
                    throw new IllegalArgumentException("untrusted APK host");
                }

                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(15000);
                connection.setRequestProperty("User-Agent", "OpenCodeRoam-Android");
                if (connection.getResponseCode() != 200) {
                    throw new IllegalStateException("HTTP " + connection.getResponseCode());
                }

                long total = connection.getContentLengthLong();
                input = connection.getInputStream();
                output = new FileOutputStream(target);
                byte[] buffer = new byte[8192];
                long downloaded = 0;
                int read;
                int lastPercent = -1;
                while ((read = input.read(buffer)) != -1) {
                    if (downloadCancelled) throw new IllegalStateException("cancelled");
                    output.write(buffer, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        int value = (int) Math.min(100, downloaded * 100 / total);
                        if (value != lastPercent) {
                            lastPercent = value;
                            runOnUiThread(() -> {
                                if (downloadDialog == null || !downloadDialog.isShowing()) return;
                                bar.setProgress(value);
                                percent.setText(getString(R.string.download_progress, value));
                            });
                        }
                    }
                }
                output.flush();
                output.close();
                output = null;

                PackageInfo info = getPackageManager().getPackageArchiveInfo(target.getAbsolutePath(), 0);
                if (info == null || !getPackageName().equals(info.packageName)) {
                    throw new IllegalStateException("unexpected APK package");
                }

                runOnUiThread(() -> {
                    if (downloadDialog != null) {
                        downloadDialog.dismiss();
                        downloadDialog = null;
                    }
                    if (isFinishing() || isDestroyed()) {
                        target.delete();
                        return;
                    }
                    showInstallDialog(target);
                });
            } catch (Exception error) {
                target.delete();
                runOnUiThread(() -> {
                    if (downloadDialog != null) {
                        downloadDialog.dismiss();
                        downloadDialog = null;
                    }
                    if (downloadCancelled) return;
                    if (isFinishing() || isDestroyed()) return;
                    showErrorCard(
                            getString(R.string.download_failed_title),
                            getString(R.string.download_failed),
                            getString(R.string.open_release_page),
                            () -> handleUrl(Uri.parse(release.releaseUrl)));
                });
            } finally {
                if (output != null) {
                    try {
                        output.close();
                    } catch (Exception ignored) {
                    }
                }
                if (input != null) {
                    try {
                        input.close();
                    } catch (Exception ignored) {
                    }
                }
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static boolean isTrustedDownloadHost(String host) {
        if (host == null) return false;
        String value = host.toLowerCase();
        return "github.com".equals(value) || value.endsWith(".githubusercontent.com");
    }

    private void showInstallDialog(File apk) {
        Dialog dialog = new Dialog(this);
        dialog.setCancelable(false);
        LinearLayout card = cardLayout();
        card.addView(eyebrow(getString(R.string.ready_eyebrow)));
        card.addView(text(getString(R.string.update_ready_title), 20, TEXT, true));
        TextView body = text(getString(R.string.update_ready_message), 14, MUTED, false);
        body.setPadding(0, dp(8), 0, 0);
        card.addView(body);

        Button install = primaryButton(getString(R.string.install));
        install.setOnClickListener(view -> {
            dialog.dismiss();
            installApk(apk);
        });
        card.addView(install);

        Button cancel = secondaryButton(getString(R.string.cancel));
        cancel.setOnClickListener(view -> {
            dialog.dismiss();
            apk.delete();
        });
        card.addView(cancel);
        showCard(dialog, card);
    }

    private void installApk(File apk) {
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            int sessionId = installer.createSession(params);

            final String action = INSTALL_ACTION + "." + System.currentTimeMillis();
            unregisterInstallReceiver();
            installReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    int status = intent.getIntExtra(
                            PackageInstaller.EXTRA_STATUS,
                            PackageInstaller.STATUS_FAILURE);
                    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent confirm;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
                        } else {
                            @SuppressWarnings("deprecation")
                            Intent legacy = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                            confirm = legacy;
                        }
                        if (confirm != null) {
                            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            try {
                                startActivity(confirm);
                            } catch (Exception error) {
                                Toast.makeText(MainActivity.this, R.string.install_failed, Toast.LENGTH_LONG).show();
                            }
                        } else {
                            Toast.makeText(MainActivity.this, R.string.install_failed, Toast.LENGTH_LONG).show();
                        }
                    } else if (status != PackageInstaller.STATUS_SUCCESS) {
                        Toast.makeText(MainActivity.this, R.string.install_result_failed, Toast.LENGTH_LONG).show();
                    }
                    unregisterInstallReceiver();
                }
            };

            IntentFilter filter = new IntentFilter(action);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(installReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(installReceiver, filter);
            }

            Intent resultIntent = new Intent(action).setPackage(getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent pending = PendingIntent.getBroadcast(this, 0, resultIntent, flags);

            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (InputStream input = new FileInputStream(apk);
                     OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    session.fsync(output);
                }
                session.commit(pending.getIntentSender());
            }
            apk.delete();
        } catch (Exception error) {
            unregisterInstallReceiver();
            Toast.makeText(this, R.string.install_failed, Toast.LENGTH_LONG).show();
        }
    }

    private void unregisterInstallReceiver() {
        if (installReceiver == null) return;
        try {
            unregisterReceiver(installReceiver);
        } catch (Exception ignored) {
            // Already unregistered.
        }
        installReceiver = null;
    }

    private void testConnection(EditText urlInput, EditText tokenInput, TextView status) {
        String url;
        try {
            url = normalizeBaseUrl(urlInput.getText().toString());
        } catch (Exception error) {
            status.setTextColor(RED);
            status.setText(R.string.enter_valid_https);
            return;
        }

        String token = tokenInput.getText().toString().trim();
        if (token.isEmpty()) token = secureStore.getToken();
        if (token == null || token.isEmpty()) {
            status.setTextColor(RED);
            status.setText(R.string.enter_web_token);
            return;
        }

        final String testUrl = url;
        final String testToken = token;
        status.setTextColor(MUTED);
        status.setText(R.string.testing);

        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(testUrl + "/api/state").openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Authorization", "Bearer " + testToken);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                int code = connection.getResponseCode();
                runOnUiThread(() -> {
                    status.setTextColor(code == 200 ? TEAL : RED);
                    status.setText(code == 200
                            ? getString(R.string.connection_ok)
                            : getString(R.string.connection_http, code));
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    status.setTextColor(RED);
                    status.setText(getString(
                            R.string.connection_failed,
                            error.getClass().getSimpleName()));
                });
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void saveAndOpen(EditText urlInput, EditText tokenInput, TextView status) {
        String url;
        try {
            url = normalizeBaseUrl(urlInput.getText().toString());
        } catch (Exception error) {
            status.setTextColor(RED);
            status.setText(R.string.enter_valid_https);
            return;
        }

        String token = tokenInput.getText().toString().trim();
        if (token.isEmpty()) token = secureStore.getToken();
        if (token == null || token.isEmpty()) {
            status.setTextColor(RED);
            status.setText(R.string.enter_web_token);
            return;
        }

        try {
            secureStore.save(url, token);
        } catch (Exception error) {
            status.setTextColor(RED);
            status.setText(R.string.token_save_failed);
            return;
        }
        showChat();
    }

    private String normalizeBaseUrl(String raw) throws Exception {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("empty");
        if (!value.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*$")) value = "https://" + value;

        URL parsed = new URL(value);
        String scheme = parsed.getProtocol().toLowerCase();
        String host = parsed.getHost();
        if (host == null || host.isEmpty()) throw new IllegalArgumentException("host");
        if (!"https".equals(scheme) && !("http".equals(scheme) && isLocalHost(host))) {
            throw new IllegalArgumentException("https required");
        }

        String port = parsed.getPort() > 0 ? ":" + parsed.getPort() : "";
        return scheme + "://" + host + port;
    }

    private static boolean isLocalHost(String host) {
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "10.0.2.2".equals(host)
                || "::1".equals(host);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;
            List<Uri> uris = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                ClipData clipData = data.getClipData();
                if (clipData != null) {
                    for (int index = 0; index < clipData.getItemCount(); index += 1) {
                        uris.add(clipData.getItemAt(index).getUri());
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }
            filePathCallback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private LinearLayout cardLayout() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(20), dp(22), dp(18));
        card.setBackground(rounded(PANEL, 20));
        card.setElevation(dp(14));
        return card;
    }

    private TextView eyebrow(String value) {
        TextView view = text(value, 11, TEAL, true);
        view.setLetterSpacing(0.12f);
        view.setPadding(0, 0, 0, dp(8));
        return view;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(BG);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        button.setTypeface(button.getTypeface(), android.graphics.Typeface.BOLD);
        button.setBackground(rounded(TEAL, 12));
        button.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(14);
        button.setLayoutParams(params);
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(MUTED);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(2);
        button.setLayoutParams(params);
        return button;
    }

    private TextView linkButton(String label) {
        TextView view = text(label, 13, TEAL, false);
        view.setGravity(android.view.Gravity.CENTER);
        view.setPadding(0, dp(10), 0, 0);
        view.setClickable(true);
        view.setFocusable(true);
        return view;
    }

    private void showCard(Dialog dialog, LinearLayout card) {
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(card);
        dialog.show();

        Window window = dialog.getWindow();
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        WindowManager.LayoutParams params = window.getAttributes();
        params.dimAmount = 0.68f;
        window.setAttributes(params);
        int width = (int) (getResources().getDisplayMetrics().widthPixels * 0.9f);
        window.setLayout(Math.min(width, dp(430)), ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private String formatSize(long bytes) {
        if (bytes <= 0) return "—";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) {
            return String.format(Locale.getDefault(), "%.0f KB", bytes / 1024.0);
        }
        return String.format(Locale.getDefault(), "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private void showErrorCard(String title, String message, String positiveLabel, Runnable positive) {
        Dialog dialog = new Dialog(this);
        LinearLayout card = cardLayout();
        card.addView(eyebrow(getString(R.string.error_eyebrow)));
        card.addView(text(title, 20, TEXT, true));
        TextView body = text(message, 14, MUTED, false);
        body.setPadding(0, dp(8), 0, 0);
        card.addView(body);

        Button action = primaryButton(positiveLabel);
        action.setOnClickListener(view -> {
            dialog.dismiss();
            if (positive != null) positive.run();
        });
        card.addView(action);

        Button close = secondaryButton(getString(R.string.close));
        close.setOnClickListener(view -> dialog.dismiss());
        card.addView(close);
        showCard(dialog, card);
    }

    private void destroyWebView() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
    }

    private TextView section(String value) {
        TextView view = text(value, 13, TEAL, true);
        view.setPadding(0, dp(22), 0, dp(2));
        return view;
    }

    private TextView label(String value) {
        TextView label = text(value, 12, MUTED, true);
        label.setPadding(0, dp(14), 0, dp(6));
        return label;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private EditText field(String value, String hint, int inputType) {
        EditText field = new EditText(this);
        field.setText(value == null ? "" : value);
        field.setHint(hint);
        field.setHintTextColor(MUTED);
        field.setTextColor(TEXT);
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        field.setInputType(inputType);
        field.setSingleLine(true);
        field.setBackground(rounded(PANEL, 12));
        field.setPadding(dp(12), dp(10), dp(12), dp(10));
        return field;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        button.setBackground(rounded(PANEL_2, 12));
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(10);
        button.setLayoutParams(params);
        return button;
    }

    private Button topbarButton(String label, String description) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(10), 0, dp(10), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription(description);
        button.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return button;
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
