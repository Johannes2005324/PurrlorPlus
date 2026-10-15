package net.meowops.purrlor;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.ImageView;

import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import androidx.browser.trusted.sharing.ShareData;
import androidx.browser.trusted.sharing.ShareTarget;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.google.androidbrowserhelper.trusted.QualityEnforcer;
import com.google.androidbrowserhelper.trusted.SharingUtils;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import com.google.androidbrowserhelper.trusted.splashscreens.PwaWrapperSplashScreenStrategy;

import java.util.Arrays;
import java.util.Collections;

/**
 * Opens the chosen Purrlor server (Server.java) as a Trusted Web Activity: the site, full screen in
 * the phone's Chrome. Asks for a server first if none is chosen yet.
 *
 * This is androidbrowserhelper's LauncherActivity cut down, rather than that class itself, because
 * LauncherActivity reads its address and share target from the manifest, fixed at build time; here
 * both follow the server chosen in the app. The task handling (one Purrlor in Recents, closing
 * when the site is closed) follows LauncherActivity's (Apache License 2.0).
 */
public class PurrlorActivity extends Activity {
    private static final String BROWSER_LAUNCHED = "browserLaunched";
    /** Set by ServerActivity: a server was just chosen, so open it even if one is still closing. */
    static final String EXTRA_SERVER_CHOSEN = "net.meowops.purrlor.SERVER_CHOSEN";
    private static final String SHORTCUT_CHANGE_SERVER = "change-server";
    private static final int SPLASH_FADE_OUT_MS = 300;

    /** How many of these are alive: more than one means the site is already open. */
    private static int sAlive = 0;

    @Nullable private TwaLauncher launcher;
    @Nullable private PwaWrapperSplashScreenStrategy splash;
    private boolean browserLaunched;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sAlive++;

        boolean fromLink = getIntent().getData() != null;
        boolean shared = SharingUtils.isShareIntent(getIntent());
        boolean chosen = getIntent().getBooleanExtra(EXTRA_SERVER_CHOSEN, false);
        // Tapping the icon while the site is open just brings it back; a link, a share or a
        // newly chosen server opens in it.
        if (sAlive > 1 && !fromLink && !shared && !chosen) {
            finish();
            return;
        }
        if (restartInNewTask()) {
            finish();
            return;
        }
        // Died in the background after opening the site, and the site was then closed.
        if (savedInstanceState != null && savedInstanceState.getBoolean(BROWSER_LAUNCHED)) {
            finish();
            return;
        }

        addChangeServerShortcut();

        String host = Server.get(this);
        if (host == null) {
            startActivity(new Intent(this, ServerActivity.class));
            finish();
            return;
        }
        launch(host);
    }

    private void launch(String host) {
        int background = getColor(R.color.background);
        CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(background)
                .setNavigationBarColor(background)
                .setNavigationBarDividerColor(Color.TRANSPARENT)
                .build();
        TrustedWebActivityIntentBuilder builder = new TrustedWebActivityIntentBuilder(launchUrl(host))
                .setDefaultColorSchemeParams(colors)
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, colors);

        ShareData share = SharingUtils.retrieveShareDataFromIntent(getIntent());
        if (share != null) builder.setShareParams(shareTarget(host), share);

        if (isTaskRoot()) {
            splash = new PwaWrapperSplashScreenStrategy(this, R.drawable.splash, background,
                    ImageView.ScaleType.CENTER, null, SPLASH_FADE_OUT_MS,
                    getString(R.string.providerAuthority), false);
        }
        launcher = new TwaLauncher(this);
        launcher.launch(builder, new QualityEnforcer(), splash, () -> {
            browserLaunched = true;
            finish();
        }, TwaLauncher.CCT_FALLBACK_STRATEGY);
    }

    /** A link to the chosen server opens there; anything else opens its home page. */
    private Uri launchUrl(String host) {
        Uri link = getIntent().getData();
        if (link != null && "https".equals(link.getScheme()) && host.equals(link.getAuthority())) return link;
        return Server.home(host);
    }

    /** The site's own share target (apps/web/public/manifest.webmanifest, public/sw.js). */
    private static ShareTarget shareTarget(String host) {
        ShareTarget.FileFormField media = new ShareTarget.FileFormField("share_media", Arrays.asList("image/*", "video/*"));
        ShareTarget.Params params = new ShareTarget.Params("share_title", "share_text", Collections.singletonList(media));
        return new ShareTarget("https://" + host + "/share-target", ShareTarget.METHOD_POST, ShareTarget.ENCODING_TYPE_MULTIPART, params);
    }

    /** Long-pressing the app icon offers Change server. */
    private void addChangeServerShortcut() {
        Intent intent = new Intent(this, ServerActivity.class).setAction(Intent.ACTION_VIEW);
        ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(this, SHORTCUT_CHANGE_SERVER)
                .setShortLabel(getString(R.string.changeServer))
                .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(intent)
                .build();
        try {
            ShortcutManagerCompat.pushDynamicShortcut(this, shortcut);
        } catch (RuntimeException ignored) {
            // A launcher without shortcuts, or too many: the server picker is still reached by
            // clearing the app's storage.
        }
    }

    /** One Purrlor in Recents: always in a task of its own (as LauncherActivity does). */
    private boolean restartInNewTask() {
        int flags = getIntent().getFlags();
        boolean newTask = (flags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0;
        boolean newDocument = (flags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0;
        if (newTask && !newDocument) return false;
        Intent again = new Intent(getIntent());
        again.setFlags((flags | Intent.FLAG_ACTIVITY_NEW_TASK) & ~Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
        startActivity(again);
        return true;
    }

    @Override
    public void onEnterAnimationComplete() {
        super.onEnterAnimationComplete();
        if (splash != null) splash.onActivityEnterAnimationComplete();
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        // Back here after the site was closed: nothing to show.
        if (browserLaunched) finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(BROWSER_LAUNCHED, browserLaunched);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        sAlive--;
        if (launcher != null) launcher.destroy();
        if (splash != null) splash.destroy();
    }
}
