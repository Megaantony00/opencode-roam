package io.github.opencoderemote.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

import org.json.JSONTokener;

import java.net.URLEncoder;

/**
 * WebView with native selection actions:
 * - Quote: inserts the selected text into the composer;
 * - Copy: copies the selected text;
 * - Search: opens the default browser with a web search;
 * - Select all is moved to the overflow menu.
 *
 * Android/WebView controls the order of the system menu items, so the visible
 * positions of Copy and Search are swapped by relabeling the delegate copy item
 * and providing our own copy item in the first slot.
 */
public class QuoteWebView extends WebView {
    private static final int QUOTE_MENU_ID = 0x0F0F0F;
    private static final int COPY_MENU_ID = 0x0F0F10;

    public QuoteWebView(Context context) {
        super(context);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(new QuoteCallback(callback, this));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(new QuoteCallback(callback, this), type);
    }

    private static final class QuoteCallback extends ActionMode.Callback2 {
        private final ActionMode.Callback delegate;
        private final QuoteWebView view;

        QuoteCallback(ActionMode.Callback delegate, QuoteWebView view) {
            this.delegate = delegate;
            this.view = view;
        }

        private String string(int id) {
            return view.getContext().getString(id);
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            if (!delegate.onCreateActionMode(mode, menu)) return false;

            moveSelectAllToOverflow(menu);
            renameDelegateCopyToSearch(menu);

            MenuItem quote = menu.add(Menu.NONE, QUOTE_MENU_ID, Menu.NONE, string(R.string.menu_quote));
            quote.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);

            MenuItem copy = menu.add(Menu.NONE, COPY_MENU_ID, 1, string(R.string.menu_copy));
            copy.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);
            return true;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            boolean prepared = delegate.onPrepareActionMode(mode, menu);
            moveSelectAllToOverflow(menu);
            renameDelegateCopyToSearch(menu);
            return prepared;
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (delegate instanceof ActionMode.Callback2) {
                ((ActionMode.Callback2) delegate).onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            String title = String.valueOf(item.getTitle());

            if (item.getItemId() == QUOTE_MENU_ID) {
                view.evaluateJavascript(selectionThenQuoteScript(), null);
                mode.finish();
                return true;
            }

            if (item.getItemId() == COPY_MENU_ID) {
                copySelection();
                mode.finish();
                return true;
            }

            if (string(R.string.menu_search).equalsIgnoreCase(title)
                    || "Cerca".equalsIgnoreCase(title)
                    || "Search".equalsIgnoreCase(title)) {
                searchSelection();
                mode.finish();
                return true;
            }

            return delegate.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            delegate.onDestroyActionMode(mode);
        }

        private void renameDelegateCopyToSearch(Menu menu) {
            for (int index = 0; index < menu.size(); index += 1) {
                MenuItem item = menu.getItem(index);
                if (item.getItemId() == COPY_MENU_ID || item.getItemId() == QUOTE_MENU_ID) {
                    continue;
                }
                String title = String.valueOf(item.getTitle());
                if (item.getItemId() == android.R.id.copy
                        || "Copia".equalsIgnoreCase(title)
                        || "Copy".equalsIgnoreCase(title)) {
                    item.setTitle(string(R.string.menu_search));
                }
            }
        }

        private void moveSelectAllToOverflow(Menu menu) {
            for (int index = 0; index < menu.size(); index += 1) {
                MenuItem item = menu.getItem(index);
                String title = String.valueOf(item.getTitle());
                if (item.getItemId() == android.R.id.selectAll
                        || "Seleziona tutto".equalsIgnoreCase(title)
                        || "Select all".equalsIgnoreCase(title)) {
                    item.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
                }
            }
        }

        private static String selectionScript() {
            return "(function(){"
                    + "var t=(window.getSelection?String(window.getSelection().toString()||''):'').trim();"
                    + "if(!t && window.__ocbSelection) t=String(window.__ocbSelection||'').trim();"
                    + "return t;"
                    + "})()";
        }

        private static String selectionThenQuoteScript() {
            return "(function(){"
                    + "var t=(window.getSelection?String(window.getSelection().toString()||''):'').trim();"
                    + "if(!t && window.__ocbSelection) t=String(window.__ocbSelection||'').trim();"
                    + "if(!t)return;"
                    + "if(window.ocbQuote){window.ocbQuote(t);return;}"
                    + "if(window.ocbQuoteSelection){window.ocbQuoteSelection();return;}"
                    + "var i=document.getElementById('input');"
                    + "if(!i)return;"
                    + "var q=t.split('\\n').map(function(l){return '> '+l;}).join('\\n');"
                    + "i.value=(i.value.trim()?i.value.trim()+'\\n\\n'+q+'\\n\\n':q+'\\n\\n');"
                    + "i.dispatchEvent(new Event('input',{bubbles:true}));"
                    + "i.focus();"
                    + "})()";
        }

        private static String decodeJsString(String raw) {
            if (raw == null || "null".equals(raw)) return "";
            try {
                Object value = new JSONTokener(raw).nextValue();
                return value == null ? "" : String.valueOf(value);
            } catch (Exception error) {
                return raw;
            }
        }

        private void copySelection() {
            view.evaluateJavascript(selectionScript(), value -> {
                String text = decodeJsString(value);
                if (text.trim().isEmpty()) return;
                ClipboardManager clipboard = (ClipboardManager)
                        view.getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("OpenCode Roam", text));
                }
            });
        }

        private void searchSelection() {
            view.evaluateJavascript(selectionScript(), value -> {
                String text = decodeJsString(value);
                if (!text.trim().isEmpty()) openSearch(text);
            });
        }

        private void openSearch(String text) {
            try {
                String query = URLEncoder.encode(text.trim(), "UTF-8");
                Intent intent = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://www.google.com/search?q=" + query));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                view.getContext().startActivity(intent);
            } catch (Exception ignored) {
                // The browser is unavailable or the text could not be encoded.
            }
        }
    }
}
