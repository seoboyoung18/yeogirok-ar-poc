package com.yeogirokarpoc.geo

import kotlin.math.atan2
import kotlin.math.hypot

/** Experimental values for comparison, not the service's GPS access policy. */
object ArExperimentPolicy {
    const val MIN_HIT_METERS = 0.2f
    const val MAX_HIT_METERS = 5f
    const val GOOD_QUALITY_HOLD_MS = 1_000L
    const val CLOUD_TIMEOUT_MS = 60_000L
    const val MAX_LOCATION_AGE_MS = 10_000L
    fun acceptsHit(distance: Float) = distance.isFinite() &&
        distance in MIN_HIT_METERS..MAX_HIT_METERS
    fun freshLocation(ageMs: Long, accuracy: Float, hasAccuracy: Boolean) =
        ageMs in 0..MAX_LOCATION_AGE_MS && hasAccuracy && accuracy.isFinite() && accuracy >= 0
}

/** Reset on a new hit, tracking loss, low quality, or an operation being started. */
fun cloudQualityAllowsHost(quality: String, fresh: Boolean, stableGood: Boolean, diagnostic: Boolean): Boolean =
    fresh && quality in listOf("GOOD", "SUFFICIENT", "INSUFFICIENT") &&
        (if (diagnostic) true else quality == "GOOD" && stableGood)

class CloudQualityGate {
    private var goodSince: Long? = null
    private var lastSample: Long? = null
    val observedGoodMillis: Long
        get() = if (goodSince == null || lastSample == null) 0L else
            (lastSample!! - goodSince!!).coerceIn(0L, ArExperimentPolicy.GOOD_QUALITY_HOLD_MS)
    fun reset() { goodSince = null; lastSample = null }
    fun update(nowMs: Long, eligible: Boolean): Boolean {
        if (!eligible) { reset(); return false }
        val previous = lastSample
        if (previous != null && (nowMs < previous || nowMs - previous > 750L)) goodSince = null
        lastSample = nowMs
        val start = goodSince
        if (start == null || nowMs < start) { goodSince = nowMs; return false }
        return nowMs - start >= ArExperimentPolicy.GOOD_QUALITY_HOLD_MS
    }
}

/** Camera-space -Z is forward and +X is right. Never use Location.bearing here. */
fun relativeDirection(cameraSpace: FloatArray): String? {
    if (cameraSpace.size != 3 || cameraSpace.any { !it.isFinite() }) return null
    val x = cameraSpace[0].toDouble()
    val z = cameraSpace[2].toDouble()
    if (hypot(x, z) < 0.05) return "바로 위·아래를 확인하세요"
    val angle = Math.toDegrees(atan2(x, -z))
    return when {
        kotlin.math.abs(angle) <= 15 -> "↑ 정면"
        angle > 165 || angle < -165 -> "↶ 뒤쪽을 비춰 주세요"
        angle > 0 -> "→ 오른쪽으로 %.0f°".format(angle)
        else -> "← 왼쪽으로 %.0f°".format(-angle)
    }
}
