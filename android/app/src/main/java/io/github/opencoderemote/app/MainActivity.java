package io.github.opencoderemote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int BG = Color.rgb(15, 17, 21);
    private static final int PANEL = Color.rgb(30, 34, 43);
    private static final int PANEL_2 = Color.rgb(36, 50, 74);
    private static final int TEXT = Color.rgb(232, 234, 240);
    private static final int MUTED = Color.rgb(154, 163, 178);
    private static final int TEAL = Color.rgb(20, 184, 166);
    private static final int RED = Color.rgb(248, 113, 113);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SecureStore secureStore;
    private FrameLayout root;
    private QuoteWebView webView;
    private String baseUrl;
    private String bridgeHost;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingShare;
    private boolean updateChecked;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        secureStore = new SecureStore(this);
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
        if (secureStore.hasCredentials()) {
            showChat();
        } else {
            showSetup(false, null);
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
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
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

    private void showSetup(boolean editing, String message) {
        baseUrl = null;
        bridgeHost = null;
        webView = null;
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

        TextView title = text("OpenCode Roam", 28, TEXT, true);
        layout.addView(title);

        TextView subtitle = text(
                "Self-hosted remote for OpenCode. Run the bridge on your PC and connect through Tailscale.",
                14, MUTED, false);
        subtitle.setPadding(0, dp(6), 0, dp(22));
        layout.addView(subtitle);

        layout.addView(label("Bridge URL"));
        EditText urlInput = field(
                editing ? secureStore.getUrl() : "",
                "https://desktop-....ts.net",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        layout.addView(urlInput);

        layout.addView(label("Web token"));
        EditText tokenInput = field(
                "",
                editing ? "Leave blank to keep the current token" : "Paste the web token",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(tokenInput);

        TextView status = text(message == null ? "" : message, 13, message == null ? MUTED : RED, false);
        status.setPadding(0, dp(10), 0, dp(4));
        layout.addView(status);

        Button test = button("Test connection");
        test.setOnClickListener(view -> testConnection(urlInput, tokenInput, status));
        layout.addView(test);

        Button save = button("Save and open");
        save.setOnClickListener(view -> saveAndOpen(urlInput, tokenInput, status));
        layout.addView(save);

        if (editing || secureStore.hasCredentials()) {
            Button logout = button("Logout and forget token");
            logout.setTextColor(RED);
            logout.setOnClickListener(view -> {
                secureStore.clear();
                CookieManager.getInstance().removeAllCookies(null);
                CookieManager.getInstance().flush();
                showSetup(false, null);
            });
            layout.addView(logout);
        }

        TextView note = text(
                "The token is stored with Android Keystore. It is not the Telegram bot token. "
                        + "The bridge must be reachable over HTTPS; HTTP is allowed only for localhost.",
                12, MUTED, false);
        note.setPadding(0, dp(18), 0, 0);
        layout.addView(note);

        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showChat() {
        String savedUrl = secureStore.getUrl();
        String savedToken = secureStore.getToken();
        if (savedUrl == null || savedToken == null) {
            showSetup(false, "Token or URL missing. Enter them again.");
            return;
        }

        baseUrl = savedUrl;
        try {
            bridgeHost = new URL(baseUrl).getHost();
        } catch (Exception error) {
            showSetup(false, "Invalid bridge URL.");
            return;
        }

        root.removeAllViews();
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(BG);

        LinearLayout topbar = new LinearLayout(this);
        topbar.setOrientation(LinearLayout.HORIZONTAL);
        topbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        topbar.setPadding(dp(12), dp(6), dp(8), dp(6));
        topbar.setBackgroundColor(BG);

        TextView title = text("OpenCode Roam", 16, TEXT, true);
        topbar.addView(title, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button reload = topbarButton("⟳");
        reload.setOnClickListener(view -> {
            if (webView != null) webView.reload();
        });
        topbar.addView(reload);

        Button settings = topbarButton("⚙");
        settings.setOnClickListener(view -> showSetup(true, null));
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
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showNativeOffline();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() == 401) {
                    showSetup(true, "The web token was rejected. Check it and save again.");
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
                    Toast.makeText(MainActivity.this, "No file picker available.", Toast.LENGTH_LONG).show();
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
                    (version, releaseUrl) -> showUpdateDialog(version, releaseUrl));
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
                    if (webView != null) webView.loadUrl(url + "/chat");
                });
            });
        } catch (Exception error) {
            showSetup(true, "Could not set the web cookie.");
        }
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
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showNativeOffline() {
        if (webView == null) return;
        webView = null;
        root.removeAllViews();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setPadding(dp(28), dp(28), dp(28), dp(28));
        layout.setBackgroundColor(BG);

        layout.addView(text("Connection unavailable", 24, TEXT, true));
        TextView message = text(
                "Tailscale may be off, or the PC/bot may be unreachable.",
                15, MUTED, false);
        message.setPadding(0, dp(10), 0, dp(20));
        message.setGravity(android.view.Gravity.CENTER);
        layout.addView(message);

        Button tailscale = button("Open Tailscale");
        tailscale.setOnClickListener(view -> handleUrl(Uri.parse("tailscale://navigate")));
        layout.addView(tailscale);

        Button retry = button("Retry");
        retry.setOnClickListener(view -> showChat());
        layout.addView(retry);

        Button settings = button("Settings");
        settings.setOnClickListener(view -> showSetup(true, null));
        layout.addView(settings);

        root.addView(layout, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showUpdateDialog(String version, String releaseUrl) {
        new AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage("OpenCode Roam " + version + " is available.")
                .setPositiveButton("Open release page", (dialog, which) -> handleUrl(Uri.parse(releaseUrl)))
                .setNegativeButton("Later", null)
                .show();
    }

    private void testConnection(EditText urlInput, EditText tokenInput, TextView status) {
        String url;
        try {
            url = normalizeBaseUrl(urlInput.getText().toString());
        } catch (Exception error) {
            status.setTextColor(RED);
            status.setText("Enter a valid HTTPS URL.");
            return;
        }

        String token = tokenInput.getText().toString().trim();
        if (token.isEmpty()) token = secureStore.getToken();
        if (token == null || token.isEmpty()) {
            status.setTextColor(RED);
            status.setText("Enter the web token.");
            return;
        }

        final String testUrl = url;
        final String testToken = token;
        status.setTextColor(MUTED);
        status.setText("Testing…");

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
                            ? "Connection OK. Save to open the chat."
                            : "HTTP " + code + ". Check the token.");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    status.setTextColor(RED);
                    status.setText("Connection failed: " + error.getClass().getSimpleName());
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
            status.setText("Enter a valid HTTPS URL.");
            return;
        }

        String token = tokenInput.getText().toString().trim();
        if (token.isEmpty()) token = secureStore.getToken();
        if (token == null || token.isEmpty()) {
            status.setTextColor(RED);
            status.setText("Enter the web token.");
            return;
        }

        try {
            secureStore.save(url, token);
        } catch (Exception error) {
            status.setTextColor(RED);
            status.setText("Could not save the token securely.");
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

    private Button topbarButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(10), 0, dp(10), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
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
