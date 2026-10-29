package com.yeogirokarpoc.geo

fun main() {
    var cases = 0
    fun expect(condition: Boolean) { check(condition); cases++ }
    val pin = PinTapTarget(100f, 200f, 1000)
    val tap = PinTapPolicy(10f)
    tap.down(100f, 152f, pin, 1f, 1000)
    expect(tap.up(102f, 153f, pin, 1f, 1100))
    // Cannot tap elsewhere, then release on the pin.
    tap.down(10f, 10f, pin, 1f, 1000)
    expect(!tap.up(100f, 152f, pin, 1f, 1100))
    // Crossing the drag threshold permanently cancels even when the finger returns.
    tap.down(100f, 152f, pin, 1f, 1000); tap.move(120f, 152f); tap.move(100f, 152f)
    expect(!tap.up(100f, 152f, pin, 1f, 1100))
    tap.down(100f, 152f, pin, 1f, 1000); tap.cancel()
    expect(!tap.up(100f, 152f, pin, 1f, 1100))
    tap.down(100f, 152f, pin, 1f, 1000)
    expect(!tap.up(100f, 152f, null, 1f, 1100))
    tap.down(100f, 152f, pin, 1f, 1000)
    expect(!tap.up(100f, 152f, pin, 1f, 1501))
    tap.down(100f, 152f, pin, 1f, 999)
    expect(!tap.up(100f, 152f, pin, 1f, 1100))
    tap.down(100f, 152f, pin, 1f, 1000)
    expect(!tap.up(200f, 152f, pin, 1f, 1100))
    // The actual painted pin occupies an 85dp region above the ground point.
    val dense = PinTapTarget(300f, 600f, 1000)
    tap.down(300f, 456f, dense, 3f, 1000)
    expect(tap.up(300f, 456f, dense, 3f, 1100))
    expect(!tap.up(300f, 456f, dense, 3f, 1100))
    // Fresh projection moving out from under the finger cannot open a stale pin.
    tap.down(100f, 152f, pin, 1f, 1000)
    expect(!tap.up(100f, 152f, PinTapTarget(250f, 200f, 1100), 1f, 1100))
    println("Pin detail gesture checks passed: $cases")
}
