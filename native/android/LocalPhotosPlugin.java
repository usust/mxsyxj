package com.moxi.watermarkcamera;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** Export generated JPEGs into the system gallery on Android 10+. */
@CapacitorPlugin(name = "LocalPhotos")
public class LocalPhotosPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String dataUrl = call.getString("dataUrl", "");
        String filename = call.getString("filename", "");
        if (!dataUrl.startsWith("data:image/jpeg;base64,") || !filename.matches("[a-zA-Z0-9_.-]+\\.jpg")) {
            call.reject("照片格式无效");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
            if (bytes.length < 3 || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216) {
                call.reject("照片数据无效");
                return;
            }
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MoxiCamera");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("无法创建照片文件");
            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("无法写入照片文件");
                output.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception exception) {
            if (uri != null) {
                try { resolver.delete(uri, null, null); } catch (Exception ignored) { }
            }
            call.reject("保存失败，请检查设备剩余存储空间", exception);
        }
    }
}
