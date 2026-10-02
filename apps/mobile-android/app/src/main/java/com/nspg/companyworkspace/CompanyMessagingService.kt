package com.nspg.companyworkspace

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class CompanyMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).edit().putString(MainActivity.FCM_TOKEN, token).apply()
        sendBroadcast(Intent(MainActivity.ACTION_TOKEN_REFRESHED).setPackage(packageName).putExtra(MainActivity.FCM_TOKEN, token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = MobileInputPolicy.notification(message.data) ?: return
        val target = Uri.parse("https://company.example.com/notifications?open=${notification.source}:${notification.sourceId}")
        val intent = Intent(this, NativeShellActivity::class.java).setAction(Intent.ACTION_VIEW).setData(target)
        val pending = PendingIntent.getActivity(this, ("${notification.source}:${notification.sourceId}").hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.createNotificationChannel(NotificationChannel(CHANNEL, "회사 업무 알림", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "연차관리와 팀 일정의 통합 알림"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        })
        manager.notify(("${notification.source}:${notification.sourceId}").hashCode(), NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(getColor(R.color.workspace_accent))
            .setContentTitle(notification.serviceLabel)
            .setContentText(notification.title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.title))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .build())
    }

    companion object { private const val CHANNEL = "workspace_notifications" }
}
