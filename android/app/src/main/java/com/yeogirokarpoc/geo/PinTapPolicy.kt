package com.yeogirokarpoc.geo

import kotlin.math.hypot

data class PinTapTarget(val x: Float, val y: Float, val atMs: Long) {
    fun contains(px: Float, py: Float, density: Float, nowMs: Long) =
        nowMs - atMs in 0..500 && px in (x - 35 * density)..(x + 35 * density) &&
            py in (y - 85 * density)..(y + 15 * density)
}

/** A release outside the pin, drag, second finger, or stale projection cannot open content. */
class PinTapPolicy(private val slop: Float) {
    private var down: Pair<Float, Float>? = null
    fun cancel() { down = null }
    fun down(x: Float, y: Float, target: PinTapTarget?, density: Float, nowMs: Long) {
        down = if (target?.contains(x, y, density, nowMs) == true) x to y else null
    }
    fun move(x: Float, y: Float) {
        val start = down ?: return
        if (hypot(x - start.first, y - start.second) > slop) cancel()
    }
    fun up(x: Float, y: Float, target: PinTapTarget?, density: Float, nowMs: Long): Boolean {
        move(x, y)
        val accepted = down != null && target?.contains(x, y, density, nowMs) == true
        cancel()
        return accepted
    }
}
