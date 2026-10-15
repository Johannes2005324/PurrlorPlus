package net.meowops.purrlor;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.annotation.Nullable;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which Purrlor server the app opens: the address someone opens Purrlor at in a browser
 * (`purr.meowops.net`, or their own deployment's `app.example.com`), as the Windows app asks for
 * (apps/desktop/Purrlor/ServerAddress.cs). Kept in the app's preferences; Chrome keeps each
 * server's sign-in apart, so switching back picks up where it left off.
 */
final class Server {
    private static final String PREFS = "purrlor";
    private static final String KEY_HOST = "host";
    private static final Pattern HOST = Pattern.compile("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$");

    private Server() {}

    /** The chosen server, or null before one has been chosen. */
    @Nullable
    static String get(Context context) {
        return prefs(context).getString(KEY_HOST, null);
    }

    static void set(Context context, String host) {
        prefs(context).edit().putString(KEY_HOST, host).apply();
    }

    /** The server this build suggests (gradle.properties, purrlor.host). */
    static String suggested(Context context) {
        return context.getString(R.string.defaultHost);
    }

    /**
     * What was typed, as a host: `https://` and any path dropped, lower-cased. Null if it isn't a
     * host name (with an optional port).
     */
    @Nullable
    static String normalize(String typed) {
        String text = typed.trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "https://" + text;
        Uri uri = Uri.parse(text);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return null;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (uri.getPort() != -1) host += ":" + uri.getPort();
        return HOST.matcher(host).matches() ? host : null;
    }

    static Uri home(String host) {
        return Uri.parse("https://" + host + "/");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
