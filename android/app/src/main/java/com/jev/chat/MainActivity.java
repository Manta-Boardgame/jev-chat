package com.jev.chat;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String GATEWAY = "https://ai-gateway.vercel.sh/";
    private static final int FILE_PICK = 1;

    private WebView webView;
    private ValueCallback<Uri[]> filePicked;
    private PdfRenderer pdfRenderer;
    private ParcelFileDescriptor pdfFd;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFFFFFF);
        root.addView(webView);
        setContentView(root);

        // Keep content clear of the status bar, navigation bar and keyboard
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);

        webView.setWebChromeClient(new WebChromeClient() {
            // Show alert/confirm as native dialogs
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setNegativeButton("Cancel", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            // "Load file" opens the system file picker
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePicked != null) filePicked.onReceiveValue(null);
                filePicked = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_PICK);
                    return true;
                } catch (Exception e) {
                    filePicked = null;
                    return false;
                }
            }
        });

        // Serve bundled assets from https://appassets.androidplatform.net/ so ES modules (pdf.js) can load
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.addJavascriptInterface(new Bridge(), "JevBridge");
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_PICK) {
            if (filePicked != null) {
                Uri[] uris = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    uris = new Uri[]{ data.getData() };
                }
                filePicked.onReceiveValue(uris);
                filePicked = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** Native helpers called from the page's JavaScript */
    private class Bridge {
        /** Forward a request to Vercel AI Gateway with the user's own API key */
        @JavascriptInterface
        public void request(int id, String method, String url, String body, String apiKey) {
            io.execute(() -> {
                int status = 0;
                String text = "";
                if (!url.startsWith(GATEWAY)) {
                    text = "blocked";
                } else {
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setRequestMethod(method);
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(30000);
                        c.setRequestProperty("Authorization", "Bearer " + apiKey);
                        if ("POST".equals(method)) {
                            c.setRequestProperty("Content-Type", "application/json");
                            c.setRequestProperty("ai-evaluation-model-specification-version", "4");
                            c.setRequestProperty("ai-gateway-auth-method", "api-key");
                            c.setRequestProperty("ai-gateway-protocol-version", "0.0.1");
                            c.setRequestProperty("ai-model-id", "typesafe-ai/jev");
                            c.setDoOutput(true);
                            try (OutputStream os = c.getOutputStream()) {
                                os.write(body.getBytes(StandardCharsets.UTF_8));
                            }
                        }
                        status = c.getResponseCode();
                        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        text = is == null ? "" : readAll(is);
                        c.disconnect();
                    } catch (Exception e) {
                        status = 0;
                        text = String.valueOf(e.getMessage());
                    }
                }
                deliver(id, status, text);
            });
        }

        /** Open a PDF and return its page count (pages are then OCR'd one at a time) */
        @JavascriptInterface
        public void pdfPrep(int id, String base64) {
            io.execute(() -> {
                try {
                    closePdf();
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    File f = new File(getCacheDir(), "input.pdf");
                    try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
                    pdfFd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                    pdfRenderer = new PdfRenderer(pdfFd);
                    deliver(id, 200, String.valueOf(pdfRenderer.getPageCount()));
                } catch (Exception e) {
                    deliver(id, 500, "Could not open the PDF. " + e.getMessage());
                }
            });
        }

        /** Render one PDF page and read its text */
        @JavascriptInterface
        public void pdfPage(int id, int pageNumber) {
            io.execute(() -> {
                try {
                    if (pdfRenderer == null) throw new Exception("No PDF is open.");
                    String text;
                    synchronized (MainActivity.this) {
                        PdfRenderer.Page page = pdfRenderer.openPage(pageNumber - 1);
                        int width = Math.min(2200, page.getWidth() * 3);
                        int height = (int) ((long) width * page.getHeight() / page.getWidth());
                        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                        new Canvas(bitmap).drawColor(Color.WHITE);
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        page.close();
                        text = recognize(bitmap);
                        bitmap.recycle();
                    }
                    deliver(id, 200, text);
                } catch (Exception e) {
                    deliver(id, 500, "Could not read the page. " + e.getMessage());
                }
            });
        }

        /** Read text from an image (base64). Runs on-device; nothing is sent over the network */
        @JavascriptInterface
        public void ocr(int id, String base64) {
            io.execute(() -> {
                try {
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
                    if (bitmap == null) throw new Exception("Could not decode the image.");
                    deliver(id, 200, recognize(bitmap));
                } catch (Exception e) {
                    deliver(id, 500, "Could not read text from the image. " + e.getMessage());
                }
            });
        }
    }

    /** On-device text recognition (the Japanese model also reads Latin script) */
    private static String recognize(Bitmap bitmap) throws Exception {
        TextRecognizer recognizer =
                TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
        Text result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
        return result.getText();
    }

    private synchronized void closePdf() {
        try { if (pdfRenderer != null) pdfRenderer.close(); } catch (Exception ignored) {}
        try { if (pdfFd != null) pdfFd.close(); } catch (Exception ignored) {}
        pdfRenderer = null;
        pdfFd = null;
    }

    private void deliver(int id, int status, String text) {
        final String js = "window.__jevDone(" + id + "," + status + "," + JSONObject.quote(text) + ")";
        main.post(() -> webView.evaluateJavascript(js, null));
    }

    private static String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
        is.close();
        return out.toString("UTF-8");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        closePdf();
        io.shutdownNow();
        webView.destroy();
        super.onDestroy();
    }
}
