package net.meowops.purrlor;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Which Purrlor server?": shown on first launch, and from the app icon's Change server
 * shortcut. Checks the address is a Purrlor site (it serves the web client's /config.json, which
 * apps/web/deploy/40-purrlor-config.sh writes) before opening it.
 */
public class ServerActivity extends Activity {
    private static final int TIMEOUT_MS = 8000;

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private EditText address;
    private Button connect;
    private TextView error;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server);
        address = findViewById(R.id.address);
        connect = findViewById(R.id.connect);
        error = findViewById(R.id.error);

        String current = Server.get(this);
        address.setText(current != null ? current : Server.suggested(this));
        address.setSelection(address.getText().length());
        connect.setOnClickListener(v -> check());
        address.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (actionId == EditorInfo.IME_ACTION_GO || enter) {
                check();
                return true;
            }
            return false;
        });
    }

    private void check() {
        String host = Server.normalize(address.getText().toString());
        if (host == null) {
            showError(getString(R.string.serverInvalid));
            return;
        }
        busy(true);
        network.execute(() -> {
            boolean ok = isPurrlor(host);
            main.post(() -> {
                if (isFinishing()) return;
                busy(false);
                if (ok) open(host);
                else showError(getString(R.string.serverUnreachable, host));
            });
        });
    }

    /** Whether https://host/config.json answers as a Purrlor web client's would. */
    private static boolean isPurrlor(String host) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("https://" + host + "/config.json").openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            if (connection.getResponseCode() != 200) return false;
            byte[] buffer = new byte[4096];
            int length = 0;
            try (InputStream in = connection.getInputStream()) {
                int read;
                while (length < buffer.length && (read = in.read(buffer, length, buffer.length - length)) > 0) length += read;
            }
            String body = new String(buffer, 0, length, "UTF-8");
            return body.trim().startsWith("{") && body.contains("\"homeserver\"");
        } catch (IOException | ClassCastException e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void open(String host) {
        Server.set(this, host);
        // A task of its own, cleared: the server open before, if any, closes.
        Intent launch = new Intent(this, PurrlorActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
                .putExtra(PurrlorActivity.EXTRA_SERVER_CHOSEN, true);
        startActivity(launch);
        finish();
    }

    private void busy(boolean busy) {
        connect.setEnabled(!busy);
        address.setEnabled(!busy);
        connect.setText(busy ? R.string.serverChecking : R.string.serverConnect);
        if (busy) error.setVisibility(View.GONE);
    }

    private void showError(String message) {
        error.setText(message);
        error.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onDestroy() {
        network.shutdownNow();
        super.onDestroy();
    }
}
