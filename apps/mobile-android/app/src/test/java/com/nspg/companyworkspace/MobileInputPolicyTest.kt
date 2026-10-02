package com.nspg.companyworkspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileInputPolicyTest {
    private val hosts = setOf("company.example.com", "schedule.example.com")

    @Test fun trustedNavigationRequiresHttpsAndAnExactHost() {
        assertTrue(MobileInputPolicy.isTrustedHttps("https", "company.example.com", hosts))
        assertTrue(MobileInputPolicy.isTrustedHttps("HTTPS", "SCHEDULE.EXAMPLE.COM", hosts))
        assertFalse(MobileInputPolicy.isTrustedHttps("http", "company.example.com", hosts))
        assertFalse(MobileInputPolicy.isTrustedHttps("https", "company.example.com.example.com", hosts))
    }

    @Test fun notificationPayloadAcceptsOnlyKnownSourcesAndPositiveIds() {
        assertNull(MobileInputPolicy.notification(mapOf("source" to "cs", "sourceId" to "1", "title" to "x")))
        assertNull(MobileInputPolicy.notification(mapOf("source" to "leave", "sourceId" to "0", "title" to "x")))
        val target = MobileInputPolicy.notification(mapOf("source" to "schedule", "sourceId" to "42", "title" to "  일정 변경  "))!!
        assertEquals("팀 일정", target.serviceLabel)
        assertEquals("일정 변경", target.title)
        assertEquals(42, target.sourceId)
    }
}
