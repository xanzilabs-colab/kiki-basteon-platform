package za.co.xanzi.kiki;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "KikiDownload")
public class KikiDownloadPlugin extends Plugin {
    private static final Pattern REPORT_FILE_NAME =
        Pattern.compile("kiki-community-report-[0-9a-fA-F-]+\\.png");
    private static final int MAX_IMAGE_BYTES = 15 * 1024 * 1024;

    @PluginMethod
    public void saveImage(PluginCall call) {
        String fileName = call.getString("fileName");
        String encodedImage = call.getString("data");
        if (fileName == null || !REPORT_FILE_NAME.matcher(fileName).matches()
            || encodedImage == null || encodedImage.isEmpty()) {
            call.reject("Invalid report image.");
            return;
        }

        final byte[] image;
        try {
            image = Base64.decode(encodedImage, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The report image could not be decoded.", error);
            return;
        }
        if (image.length == 0 || image.length > MAX_IMAGE_BYTES) {
            call.reject("The report image has an unsupported size.");
            return;
        }

        try {
            String location = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveToDownloads(fileName, image)
                : saveToAppDownloads(fileName, image);
            JSObject result = new JSObject();
            result.put("location", location);
            call.resolve(result);
        } catch (IOException error) {
            call.reject("Could not save the report image to this device.", error);
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private String saveToDownloads(String fileName, byte[] image) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Kiki");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Downloads could not create a file.");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) throw new IOException("Downloads could not open the report image.");
            output.write(image);
        } catch (IOException error) {
            getContext().getContentResolver().delete(uri, null, null);
            throw error;
        }

        ContentValues ready = new ContentValues();
        ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
        if (getContext().getContentResolver().update(uri, ready, null, null) < 1) {
            getContext().getContentResolver().delete(uri, null, null);
            throw new IOException("Downloads could not finish saving the report image.");
        }
        return "Downloads/Kiki/" + fileName;
    }

    private String saveToAppDownloads(String fileName, byte[] image) throws IOException {
        File downloads = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (downloads == null) throw new IOException("Device storage is unavailable.");
        File directory = new File(downloads, "Kiki");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Device storage is unavailable.");
        File destination = new File(directory, fileName);
        try (FileOutputStream output = new FileOutputStream(destination)) {
            output.write(image);
        }
        return "Kiki app files/Downloads/" + fileName;
    }
}
