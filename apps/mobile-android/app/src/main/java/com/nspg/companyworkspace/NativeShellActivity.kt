package com.nspg.companyworkspace

import android.Manifest
import android.content.Intent
import android.content.IntentFilter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebChromeClient
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.URI
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class NativeShellActivity : AppCompatActivity() {
    private val portal = "https://company.example.com"
    private val hosts by lazy {
        resources.getString(R.string.trusted_origins).split(',').mapNotNull { runCatching { URI(it).host?.lowercase() }.getOrNull() }.toSet()
    }
    private lateinit var web: WebView
    private var token: String? = null
    private var ready = false
    private var pendingUrl: String? = null
    private var pendingExchange: ByteArray? = null
    private lateinit var nativeRoot: LinearLayout
    private val nativeLabels = mutableListOf<TextView>()
    private lateinit var notificationButton: TextView
    private lateinit var notificationDot: TextView
    private val badgeHandler = Handler(Looper.getMainLooper())
    private val badgeExecutor = Executors.newSingleThreadExecutor()
    private val badgeInFlight = AtomicBoolean(false)
    private val badgeTick = object : Runnable {
        override fun run() {
            refreshNotificationBadge()
            badgeHandler.postDelayed(this, 30_000)
        }
    }
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { launch() }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            token = intent?.getStringExtra(MainActivity.FCM_TOKEN) ?: return
            publishToken()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        createShell()
        ContextCompat.registerReceiver(this, tokenReceiver, IntentFilter(MainActivity.ACTION_TOKEN_REFRESHED), ContextCompat.RECEIVER_NOT_EXPORTED)
        loadToken()
        if (intent?.data?.scheme == "companyworkspace") receiveCallback(intent.data!!)
        else pendingUrl = trustedUrl(intent?.data)
        requestPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data?.scheme == "companyworkspace") receiveCallback(intent.data!!)
        else trustedUrl(intent.data)?.let { if (ready) web.loadUrl(it) else pendingUrl = it }
    }

    override fun onDestroy() {
        badgeHandler.removeCallbacks(badgeTick)
        badgeExecutor.shutdownNow()
        unregisterReceiver(tokenReceiver)
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        web.destroy()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (::nativeRoot.isInitialized) applyNativeTheme()
        badgeHandler.removeCallbacks(badgeTick)
        badgeHandler.post(badgeTick)
    }

    override fun onPause() {
        badgeHandler.removeCallbacks(badgeTick)
        super.onPause()
    }

    private fun createShell() {
        val dark = isDarkTheme(themePreference())
        val surface = if (dark) Color.rgb(23, 25, 28) else Color.WHITE
        val ink = if (dark) Color.rgb(241, 243, 245) else Color.rgb(23, 26, 31)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(surface) }
        nativeRoot = root
        web = WebView(this).apply {
            // Keep cookies and local storage, but do not reuse a stale web shell after an app relaunch.
            clearCache(true)
            setBackgroundColor(if (dark) Color.rgb(13, 14, 16) else Color.rgb(238, 241, 245))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setForceDarkAllowed(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) settings.setAlgorithmicDarkeningAllowed(false)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            // Content URI access is needed for a file explicitly selected by the user.
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        filePicker.launch(params.createIntent())
                        true
                    } catch (_: Exception) {
                        fileCallback = null
                        callback.onReceiveValue(null)
                        true
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme != "https" || uri.host?.lowercase() !in hosts) {
                        if (request.isForMainFrame && uri.scheme in listOf("https", "http", "mailto", "tel"))
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                        return true
                    }
                    if (request.isForMainFrame && uri.host.equals("company.example.com", true) && uri.path.equals("/Account/Login", true)) {
                        startBrowserLogin(); return true
                    }
                    return false
                }
                override fun onPageFinished(view: WebView, url: String) {
                    if (trustedUrl(Uri.parse(url)) == null) return
                    publishToken()
                    refreshNotificationBadge()
                    applyNativeTheme()
                }
            }
        }
        web.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_UP) badgeHandler.postDelayed({ applyNativeTheme() }, 250)
            false
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        val bottom = LinearLayout(this).apply { gravity = Gravity.CENTER }
        listOf("홈" to "/", "알림" to "/notifications", "서비스" to "/#services", "내 설정" to "/Settings/Profile").forEach { (label, path) ->
            val item = FrameLayout(this)
            val action = button(label, ink) { web.loadUrl(portal + path) }
            nativeLabels.add(action)
            item.addView(action, FrameLayout.LayoutParams(-1, -1))
            if (label == "알림") {
                notificationButton = action
                notificationDot = TextView(this).apply {
                    visibility = View.GONE
                    gravity = Gravity.CENTER
                    minWidth = dp(18)
                    setPadding(dp(4), 0, dp(4), 0)
                    textSize = 10f
                    setTypeface(null, 1)
                    setTextColor(Color.WHITE)
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.RECTANGLE
                        cornerRadius = dp(9).toFloat()
                        setColor(Color.rgb(225, 55, 70))
                    }
                }
                item.addView(notificationDot, FrameLayout.LayoutParams(-2, dp(18), Gravity.TOP or Gravity.RIGHT).apply {
                    topMargin = dp(5)
                    rightMargin = dp(5)
                })
            }
            bottom.addView(item, LinearLayout.LayoutParams(0, dp(56), 1f))
        }
        root.addView(bottom)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        root.post { if (!isDestroyed) applyNativeTheme() }
    }

    private fun button(label: String, color: Int, action: () -> Unit) = TextView(this).apply {
        text = label; contentDescription = label; textSize = 15f; setTextColor(color); gravity = Gravity.CENTER
        setPadding(dp(8), 0, dp(8), 0); setOnClickListener { action() }
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun themePreference(): String {
        val cookie = CookieManager.getInstance().getCookie(portal)
            ?.split(';')?.map { it.trim() }?.firstOrNull { it.startsWith("CompanyUiTheme=") }
            ?.substringAfter('=')
        if (cookie in listOf("system", "light", "dark")) return cookie!!
        val stored = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).getString("theme_preference", null)
        return if (stored in listOf("system", "light", "dark")) stored!! else "system"
    }

    private fun isDarkTheme(preference: String): Boolean = preference == "dark" ||
        (preference == "system" && resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)

    private fun applyNativeTheme(preference: String = themePreference()) {
        if (!::nativeRoot.isInitialized) return
        val dark = isDarkTheme(preference)
        nativeRoot.setBackgroundColor(if (dark) Color.rgb(23, 25, 28) else Color.WHITE)
        if (::web.isInitialized) web.setBackgroundColor(if (dark) Color.rgb(13, 14, 16) else Color.rgb(238, 241, 245))
        val ink = if (dark) Color.rgb(241, 243, 245) else Color.rgb(23, 26, 31)
        nativeLabels.forEach { it.setTextColor(ink) }
        if (nativeRoot.isAttachedToWindow) {
            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    private fun refreshNotificationBadge() {
        if (!badgeInFlight.compareAndSet(false, true) || badgeExecutor.isShutdown) return
        val cookie = CookieManager.getInstance().getCookie(portal)
        if (cookie.isNullOrBlank()) {
            setNotificationBadge(0)
            badgeInFlight.set(false)
            return
        }
        badgeExecutor.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("$portal/api/workspace/notifications?take=1").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    instanceFollowRedirects = false
                    connectTimeout = 8_000
                    readTimeout = 8_000
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Cookie", cookie)
                }
                when (connection.responseCode) {
                    200 -> setNotificationBadge(JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optInt("unreadCount", 0))
                    401, 403 -> setNotificationBadge(0)
                }
            } catch (_: Exception) {
                // Keep the last known state when a service or the network is temporarily unavailable.
            } finally {
                connection?.disconnect()
                badgeInFlight.set(false)
            }
        }
    }

    private fun setNotificationBadge(unread: Int) {
        runOnUiThread {
            if (isDestroyed || !::notificationDot.isInitialized) return@runOnUiThread
            notificationDot.visibility = if (unread > 0) View.VISIBLE else View.GONE
            notificationDot.text = if (unread > 99) "99+" else unread.coerceAtLeast(0).toString()
            notificationButton.contentDescription = if (unread > 0) "알림, 읽지 않은 알림 ${unread}개" else "알림"
        }
    }
    private fun trustedUrl(uri: Uri?): String? =
        if (MobileInputPolicy.isTrustedHttps(uri?.scheme, uri?.host, hosts)) uri.toString() else null

    private fun startBrowserLogin() {
        val verifier = randomUrlSafe()
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val state = bytes.joinToString("") { "%02x".format(it) }
        val challenge = android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)), BASE64_FLAGS)
        getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).edit()
            .putString("login_verifier", verifier).putString("login_state", state).putLong("login_started", System.currentTimeMillis()).apply()
        val callback = "/mobile/authorize?challenge=" + challenge + "&state=" + state
        val uri = Uri.parse(portal + "/Account/Login").buildUpon().appendQueryParameter("returnUrl", callback).build()
        val browser = CustomTabsClient.getPackageName(this, listOf("com.android.chrome"), true)
            ?: CustomTabsClient.getPackageName(this, null)
        CustomTabsIntent.Builder().build().apply { if (browser != null) intent.setPackage(browser) }.launchUrl(this, uri)
    }

    private fun receiveCallback(uri: Uri) {
        if (uri.host != "auth" || uri.path.orEmpty().isNotEmpty()) return
        val prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE)
        val state = prefs.getString("login_state", null) ?: return
        val verifier = prefs.getString("login_verifier", null) ?: return
        val code = uri.getQueryParameter("code") ?: return
        if (uri.getQueryParameter("state") != state || System.currentTimeMillis() - prefs.getLong("login_started", 0) !in 0..300_000) return
        if (!code.matches(Regex("^[A-Za-z0-9_-]{43}$"))) return
        prefs.edit().remove("login_state").remove("login_verifier").remove("login_started").apply()
        val body = "code=" + URLEncoder.encode(code, "UTF-8") + "&verifier=" + URLEncoder.encode(verifier, "UTF-8") + "&state=" + state
        pendingUrl = null
        if (ready) web.postUrl(portal + "/mobile/exchange", body.toByteArray(Charsets.UTF_8))
        else pendingExchange = body.toByteArray(Charsets.UTF_8)
    }

    private fun randomUrlSafe(): String = android.util.Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, BASE64_FLAGS)

    private fun requestPermission() {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            launch(); return
        }
        val prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(MainActivity.PERMISSION_EXPLAINED, false)) { launch(); return }
        AlertDialog.Builder(this).setTitle("회사 알림 받기")
            .setMessage("연차관리와 팀 일정의 새 알림을 받을 수 있습니다. 잠금 화면에는 서비스명과 제목만 표시됩니다.")
            .setNegativeButton("나중에") { _, _ -> prefs.edit().putBoolean(MainActivity.PERMISSION_EXPLAINED, true).apply(); launch() }
            .setPositiveButton("알림 허용") { _, _ -> prefs.edit().putBoolean(MainActivity.PERMISSION_EXPLAINED, true).apply(); permission.launch(Manifest.permission.POST_NOTIFICATIONS) }
            .setCancelable(false).show()
    }

    private fun launch() {
        ready = true
        val exchange = pendingExchange
        pendingExchange = null
        if (exchange != null) web.postUrl(portal + "/mobile/exchange", exchange)
        else web.loadUrl(pendingUrl ?: getString(R.string.start_url))
        pendingUrl = null
    }

    private fun loadToken() {
        if (FirebaseApp.getApps(this).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener {
            getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).edit().putString(MainActivity.FCM_TOKEN, it).apply()
            token = it; publishToken()
        }
    }

    private fun publishToken() {
        if (!::web.isInitialized || !ready || Uri.parse(web.url ?: "").host != "company.example.com") return
        val prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE)
        val value = token ?: prefs.getString(MainActivity.FCM_TOKEN, null) ?: return
        val installation = prefs.getString(MainActivity.INSTALLATION_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(MainActivity.INSTALLATION_ID, it).apply()
        }
        val payload = JSONObject().put("type", "company-workspace-fcm-token").put("version", 1)
            .put("installationId", installation).put("token", value)
            .put("appVersion", packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown")
        web.evaluateJavascript("window.postMessage(" + JSONObject.quote(payload.toString()) + ", '" + portal + "')", null)
    }

    @Deprecated("Use OnBackPressedDispatcher")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        private const val BASE64_FLAGS = android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP
    }
}
