package za.co.xanzi.kiki;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(KikiTriggerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
