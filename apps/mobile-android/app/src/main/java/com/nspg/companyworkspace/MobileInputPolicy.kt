package com.nspg.companyworkspace

object MobileInputPolicy {
    data class NotificationTarget(val source: String, val sourceId: Long, val serviceLabel: String, val title: String)

    fun isTrustedHttps(scheme: String?, host: String?, trustedHosts: Set<String>): Boolean =
        scheme.equals("https", ignoreCase = true) && host != null && trustedHosts.contains(host.lowercase())

    fun notification(data: Map<String, String>): NotificationTarget? {
        val source = data["source"]?.takeIf { it == "leave" || it == "schedule" } ?: return null
        val sourceId = data["sourceId"]?.toLongOrNull()?.takeIf { it > 0 } ?: return null
        val title = data["title"]?.trim()?.take(200)?.takeIf { it.isNotEmpty() } ?: "새 알림"
        return NotificationTarget(source, sourceId, if (source == "leave") "연차관리" else "팀 일정", title)
    }
}
