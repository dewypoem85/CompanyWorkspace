package com.nspg.companyworkspace

import android.Manifest
import android.content.ComponentName
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsService
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.URI
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private val portalOrigin = Uri.parse("https://company.example.com")
    private val allowedHosts by lazy {
        resources.getString(R.string.trusted_origins).split(',').mapNotNull { runCatching { URI(it).host?.lowercase() }.getOrNull() }.toSet()
    }
    private var session: CustomTabsSession? = null
    private var serviceConnection: CustomTabsServiceConnection? = null
    private var channelReady = false
    private var pendingToken: String? = null
    private var launched = false
    private var startupAllowed = false
    private var relationshipValidated = false

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        completeStartup()
    }
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            pendingToken = intent?.getStringExtra(FCM_TOKEN) ?: return
            publishToken()
        }
    }

    private val callback = object : CustomTabsCallback() {
        override fun onNavigationEvent(navigationEvent: Int, extras: Bundle?) {
            if (navigationEvent == NAVIGATION_STARTED) channelReady = false
            if (navigationEvent != NAVIGATION_FINISHED) return
            if (relationshipValidated) requestPortalChannel()
            else session?.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, portalOrigin, null)
        }

        override fun onRelationshipValidationResult(relation: Int, requestedOrigin: Uri, result: Boolean, extras: Bundle?) {
            if (relation != CustomTabsService.RELATION_USE_AS_ORIGIN || requestedOrigin != portalOrigin) return
            relationshipValidated = result
            if (result) requestPortalChannel()
            else Log.w(TAG, "Portal postMessage origin validation failed")
        }

        override fun onMessageChannelReady(extras: Bundle?) {
            channelReady = true
            publishToken()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loadFirebaseToken()
        continueAfterNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        launched = false
        if (startupAllowed) bindAndLaunch()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(this, tokenReceiver, IntentFilter(ACTION_TOKEN_REFRESHED), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStop() {
        runCatching { unregisterReceiver(tokenReceiver) }
        super.onStop()
    }

    override fun onDestroy() {
        serviceConnection?.let { runCatching { unbindService(it) } }
        super.onDestroy()
    }

    private fun bindAndLaunch() {
        if (launched) return
        val browserPackage = CustomTabsClient.getPackageName(this, null)
        if (browserPackage == null) {
            startActivity(Intent(Intent.ACTION_VIEW, launchUri()))
            finish()
            return
        }
        val connection = object : CustomTabsServiceConnection() {
            override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
                client.warmup(0)
                session = client.newSession(callback)
                val currentSession = session ?: return
                launched = true
                TrustedWebActivityIntentBuilder(launchUri())
                    .setAdditionalTrustedOrigins(resources.getString(R.string.trusted_origins).split(','))
                    .build(currentSession)
                    .launchTrustedWebActivity(this@MainActivity)
            }
            override fun onServiceDisconnected(name: ComponentName) {
                session = null
                channelReady = false
                relationshipValidated = false
            }
        }
        serviceConnection = connection
        CustomTabsClient.bindCustomTabsService(this, browserPackage, connection)
    }

    private fun launchUri(): Uri {
        val requested = intent?.data
        return if (MobileInputPolicy.isTrustedHttps(requested?.scheme, requested?.host, allowedHosts)) requested!! else Uri.parse(getString(R.string.start_url))
    }

    private fun requestPortalChannel() {
        // The target origin must be explicit: login may navigate through Google or other services.
        if (session?.requestPostMessageChannel(portalOrigin, portalOrigin, Bundle()) != true)
            Log.w(TAG, "Portal postMessage channel request was not accepted")
    }

    private fun continueAfterNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            completeStartup()
            return
        }
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(PERMISSION_EXPLAINED, false)) {
            completeStartup()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("회사 알림 받기")
            .setMessage("연차관리와 팀 일정의 새 알림을 받을 수 있습니다. 잠금 화면에는 서비스명과 제목만 표시됩니다.")
            .setNegativeButton("나중에") { _, _ ->
                prefs.edit().putBoolean(PERMISSION_EXPLAINED, true).apply()
                completeStartup()
            }
            .setPositiveButton("알림 허용") { _, _ -> prefs.edit().putBoolean(PERMISSION_EXPLAINED, true).apply(); permissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS) }
            .setCancelable(false)
            .show()
    }

    private fun completeStartup() {
        startupAllowed = true
        bindAndLaunch()
    }

    private fun loadFirebaseToken() {
        if (FirebaseApp.getApps(this).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(FCM_TOKEN, token).apply()
            pendingToken = token
            publishToken()
        }
    }

    private fun publishToken() {
        if (!channelReady) return
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val token = pendingToken ?: prefs.getString(FCM_TOKEN, null) ?: return
        val installationId = prefs.getString(INSTALLATION_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(INSTALLATION_ID, it).apply()
        }
        val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
        val payload = JSONObject()
            .put("type", "company-workspace-fcm-token")
            .put("version", 1)
            .put("installationId", installationId)
            .put("token", token)
            .put("appVersion", version)
        if (session?.postMessage(payload.toString(), null) != CustomTabsService.RESULT_SUCCESS)
            Log.w(TAG, "Portal postMessage token delivery was not accepted")
    }

    companion object {
        private const val TAG = "CompanyWorkspaceTwa"
        const val PREFS = "company_workspace_mobile"
        const val INSTALLATION_ID = "installation_id"
        const val FCM_TOKEN = "fcm_token"
        const val PERMISSION_EXPLAINED = "notification_permission_explained_v2"
        const val ACTION_TOKEN_REFRESHED = "com.nspg.companyworkspace.FCM_TOKEN_REFRESHED"
    }
}
