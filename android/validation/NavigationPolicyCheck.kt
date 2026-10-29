package com.yeogirokarpoc.geo

import kotlin.math.abs

fun main() {
    var checks = 0
    fun expect(value: Boolean, label: String) { check(value) { label }; checks++ }
    expect(NavigationPolicy.coordinates(37.5, 127.0), "Normal map coordinates")
    expect(!NavigationPolicy.coordinates(91.0, 0.0), "Invalid latitude")
    expect(!NavigationPolicy.coordinates(0.0, 181.0), "Invalid longitude")
    expect(!NavigationPolicy.coordinates(Double.NaN, 0.0), "Non-finite coordinate")
    expect(NavigationPolicy.usableLocation(10_000, 25f, true), "Experimental quality boundary")
    expect(!NavigationPolicy.usableLocation(10_001, 1f, true), "Stale location")
    expect(!NavigationPolicy.usableLocation(-1, 1f, true), "Future location")
    expect(!NavigationPolicy.usableLocation(1, 26f, true), "Poor location must not show directional arrow")
    expect(!NavigationPolicy.usableLocation(1, 0f, false), "Unknown uncertainty is not zero")
    expect(abs(NavigationPolicy.distance(0.0, 0.0, 0.0, 1.0) - 111195.08) < 1, "Equatorial one degree")
    expect(NavigationPolicy.distance(37.0, 127.0, 37.0, 127.0) == 0.0, "Coincident point")
    expect(NavigationPolicy.distance(0.0, 179.999, 0.0, -179.999) < 223, "Dateline crossing is short")
    expect(abs(NavigationPolicy.bearing(0.0, 0.0, 1.0, 0.0)) < 0.01, "North bearing")
    expect(abs(NavigationPolicy.bearing(0.0, 0.0, 0.0, 1.0) - 90) < 0.01, "East bearing")
    expect(NavigationPolicy.wrap(1.0 - 359.0) == 2.0, "North wrap must not turn 358 degrees")
    val north = floatArrayOf(1f, 0f, 0f, 0f, 0f, -1f, 0f, 1f, 0f)
    val east = floatArrayOf(0f, 0f, -1f, -1f, 0f, 0f, 0f, 1f, 0f)
    expect(NavigationPolicy.cameraHeading(north, 0f) == 0.0, "Back camera north; device top is vertical")
    expect(NavigationPolicy.cameraHeading(east, 0f) == 90.0, "Back camera east")
    expect(NavigationPolicy.cameraHeading(north, -8f) == -8.0, "Magnetic declination applied")
    expect(NavigationPolicy.cameraHeading(floatArrayOf(1f,0f,0f,0f,1f,0f,0f,0f,1f), 0f) == null, "Downward camera has no azimuth")
    expect(NavigationPolicy.cameraHeading(FloatArray(9) { Float.NaN }, 0f) == null, "Invalid sensor matrix")
    expect(NavigationPolicy.turn(90.0).startsWith("→"), "Right guidance")
    expect(NavigationPolicy.turn(-90.0).startsWith("←"), "Left guidance")
    expect(NavigationPolicy.turn(179.0).startsWith("↶"), "Behind guidance")
    expect(NavigationPolicy.cameraSpaceAngle(floatArrayOf(0f, 0f, -2f)) == 0.0, "Forward arrow")
    expect(NavigationPolicy.cameraSpaceAngle(floatArrayOf(2f, 0f, 0f)) == 90.0, "Clockwise right arrow")
    expect(NavigationPolicy.cameraSpaceAngle(floatArrayOf(-2f, 0f, 0f)) == -90.0, "Counterclockwise left arrow")
    expect(NavigationPolicy.cameraSpaceAngle(floatArrayOf(0f, 3f, 0f)) == null, "Vertical target has no turn angle")
    expect(NavigationPolicy.arrowAngle(true, false, true, -90.0, 90.0) == -90.0, "Resolved anchor overrides disagreeing GPS")
    expect(NavigationPolicy.arrowAngle(true, true, true, -90.0, 90.0) == null, "Tracking loss hides arrow")
    expect(NavigationPolicy.arrowAngle(true, false, false, -90.0, 90.0) == null, "Frozen AR frame cannot keep arrow alive")
    expect(NavigationPolicy.arrowAngle(true, false, true, null, 90.0) == null, "No GPS fallback for vertical resolved target")
    expect(NavigationPolicy.arrowAngle(false, false, false, null, 90.0) == 90.0, "Pre-resolve coarse arrow")
    expect(NavigationPolicy.arrowAngle(false, false, false, null, null) == null, "Unreliable coarse direction hidden")
    println("NavigationPolicy: $checks checks passed")
}
