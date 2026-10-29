package com.yeogirokarpoc.geo

import com.google.ar.core.TrackingState.*

/** Standalone JVM regression check: no Android device or new test dependency needed. */
fun main() {
    var checks = 0
    fun expect(condition: Boolean, label: String) {
        check(condition) { label }
        checks++
    }
    fun decide(camera: com.google.ar.core.TrackingState = TRACKING, earth: Boolean = true,
               anchor: com.google.ar.core.TrackingState? = TRACKING,
               reference: com.google.ar.core.TrackingState? = TRACKING,
               valid: Boolean = true, restoring: Boolean = true) =
        geoTrackingDecision(camera, earth, anchor, reference, valid, restoring)

    val paused = decide(camera = PAUSED)
    expect(!paused.discardAnchor && !paused.discardReference, "Camera PAUSED must preserve both anchors")
    expect(!paused.showAnchor && !paused.showReference && !paused.canConfirm, "No PAUSED pose may be used")
    val anchorPaused = decide(anchor = PAUSED)
    expect(!anchorPaused.discardAnchor && !anchorPaused.canConfirm && !anchorPaused.showAnchor,
        "Anchor PAUSED must wait for recovery")
    val resumed = decide()
    expect(resumed.showAnchor && resumed.showReference && resumed.canConfirm, "Recovery restores eligibility")
    val earthLost = decide(earth = false)
    expect(!earthLost.showAnchor && !earthLost.canConfirm && !earthLost.discardAnchor,
        "Restoration hides during Earth loss without recreating anchor")
    val localOnly = decide(earth = false, restoring = false, reference = null)
    expect(localOnly.showAnchor && !localOnly.canConfirm, "Local preview remains possible before localization")
    expect(decide(camera = STOPPED).let { it.discardAnchor && it.discardReference && !it.canConfirm },
        "STOPPED camera invalidates both anchors")
    expect(decide(anchor = STOPPED).let { it.discardAnchor && !it.discardReference && !it.canConfirm },
        "STOPPED restored anchor preserves independent reference")
    expect(decide(reference = STOPPED).let { !it.discardAnchor && it.discardReference && !it.canConfirm },
        "STOPPED reference is discarded independently")
    expect(!decide(reference = PAUSED).canConfirm, "Cannot measure using paused reference")
    expect(!decide(anchor = null).canConfirm, "Cannot confirm without anchor")
    expect(!decide(valid = false).canConfirm, "Invalid hit cannot be confirmed")
    expect(decide(reference = null).canConfirm, "Reference measurement is optional")
    println("GeoTrackingPolicy: $checks checks passed")
}
