package za.co.xanzi.kiki;

import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(KikiTriggerPlugin.class);
        registerPlugin(BasteonBlePlugin.class);
        super.onCreate(savedInstanceState);
        var capacitorBridge = getBridge();
        var offlinePageUrl = capacitorBridge.getErrorUrl();
        var offlineBridge = new KikiOfflineBridge(getApplicationContext());
        capacitorBridge.getWebView().addJavascriptInterface(offlineBridge, "KikiOfflineBridge");
        capacitorBridge.setWebViewClient(new BridgeWebViewClient(capacitorBridge) {
            @Override
            public void onPageStarted(WebView webView, String url, Bitmap favicon) {
                offlineBridge.setOfflineFallbackActive(
                    offlinePageUrl != null && offlinePageUrl.equals(url)
                );
                super.onPageStarted(webView, url, favicon);
            }

            @Override
            public void onReceivedHttpError(
                WebView webView,
                WebResourceRequest request,
                WebResourceResponse errorResponse
            ) {
                if (!request.isForMainFrame()) {
                    super.onReceivedHttpError(webView, request, errorResponse);
                }
            }
        });
        applySystemBarTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarTheme();
    }

    private void applySystemBarTheme() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        int background = dark ? Color.BLACK : Color.WHITE;
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);

        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
