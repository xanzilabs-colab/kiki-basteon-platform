package za.co.xanzi.kiki;

import android.content.res.Configuration;
import android.graphics.Color;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(KikiTriggerPlugin.class);
        registerPlugin(BasteonBlePlugin.class);
        super.onCreate(savedInstanceState);
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
