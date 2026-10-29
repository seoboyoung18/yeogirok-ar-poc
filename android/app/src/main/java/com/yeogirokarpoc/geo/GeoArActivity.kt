package com.yeogirokarpoc.geo

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.*
import android.net.Uri
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Bundle
import android.os.Build
import java.time.Instant
import kotlin.math.hypot
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.*
import com.google.ar.core.*
import com.google.ar.core.examples.java.common.rendering.BackgroundRenderer
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/** Owns exactly one session: hit test, anchor pose and Earth conversion all use it. */
class GeoArActivity : Activity(), GLSurfaceView.Renderer {
    private lateinit var surface: GLSurfaceView
    private lateinit var overlay: PinOverlay
    private lateinit var status: TextView
    private lateinit var confirm: Button
    private val background = BackgroundRenderer()
    @Volatile private var session: Session? = null
    @Volatile private var sessionResumed = false
    private var resumed = false
    private var installRequested = false
    private var consent = false
    private var cloudMode = false
    private var navigationMode = false
    private var productMode = false
    private var localTip: JSONObject? = null
    private var detailDialog: android.app.Dialog? = null
    private val detailRequested = AtomicBoolean(false)
    private val tapTarget = AtomicReference<PinTapTarget?>(null)
    private var navigation: CloudNavigation? = null
    @Volatile private var allowDepth = false
    @Volatile private var diagnosticHost = false
    private var depthSupported = false
    private var placementHitType = "PLANE"
    private var referenceHitType = "PLANE"
    private val cloud = CloudAnchorExperiment()
    private var lastCloudTracking = ""
    private var lastCloudGate = ""
    private var lastCloudGateAt = 0L
    private var permissionRequestPending = false
    private var anchor: Anchor? = null // GL thread only
    private var measurementAnchor: Anchor? = null // Original physical point selected in this session.
    private var validPlacement = false
    private var restore: JSONObject? = null
    private var restoreAttempted = false
    private var restoreAttempts = 0
    private var nextRestoreAttemptAt = 0L
    private val sessionId = UUID.randomUUID().toString()
    private val touch = AtomicReference<PointF?>(null)
    private val confirmRequested = AtomicBoolean(false)
    private val resetRequested = AtomicBoolean(false)
    private val restoreRetryRequested = AtomicBoolean(false)
    private val resultDelivered = AtomicBoolean(false)
    private var width = 1
    private var height = 1
    private var glReady = false
    private var lastUiTime = 0L
    private var placementMessage = "바닥을 터치하고 핀을 끌어 위치를 조정하세요."

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cloudMode = intent.getBooleanExtra("cloudMode", false)
        localTip = try { intent.getStringExtra("localTip")?.let { LocalTipStore.validate(this, it) } }
            catch (_: Exception) { finish(); return }
        productMode = cloudMode && (localTip != null || intent.getBooleanExtra("productMode", false))
        navigationMode = cloudMode && intent.getBooleanExtra("navigationMode", false)
        restore = try { intent.getStringExtra("restoreRecord")?.let {
            if (cloudMode) CloudRecord.parse(it, forResolve = true) else GeoRecord.parse(it)
        } } catch (_: Exception) { finish(); return }
        if (navigationMode && restore?.optJSONObject("discoveryLocation") == null) { finish(); return }
        if (localTip != null && restore?.getString("anchorId") != localTip!!.getJSONObject("cloudRecord").getString("anchorId")) {
            finish(); return
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(17, 24, 39))
            fitsSystemWindows = true
        }
        status = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 14f; setPadding(24, 16, 24, 16)
            text = if (cloudMode) "Cloud Anchor 검증 준비 중" else "ARCore 지리 좌표 검증 준비 중"
        }
        // Long status text must not squeeze the camera viewport to zero height.
        layout.addView(ScrollView(this).apply { addView(status) },
            LinearLayout.LayoutParams(-1, ((if (productMode) 80 else if (navigationMode) 90 else 180) * resources.displayMetrics.density).toInt()))
        if (!navigationMode && !productMode) layout.addView(CheckBox(this).apply {
            text = "Depth Hit도 허용 (해제: 평면만 / 변경 시 배치 초기화)"
            setTextColor(Color.WHITE)
            setOnCheckedChangeListener { _, checked ->
                allowDepth = checked
                resetRequested.set(true)
            }
        })
        if (cloudMode && restore == null && !productMode) layout.addView(CheckBox(this).apply {
            text = "비교 실험: 현재 품질로 저장 허용 (복원 실패·오차 측정용)"
            setTextColor(Color.rgb(255, 200, 100))
            setOnCheckedChangeListener { _, checked -> diagnosticHost = checked }
        })
        val viewport = FrameLayout(this)
        surface = GLSurfaceView(this).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setEGLConfigChooser(8, 8, 8, 8, 16, 0)
            setRenderer(this@GeoArActivity)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        overlay = PinOverlay().apply {
            measurementMode = restore != null
            onPoint = { x, y -> touch.set(PointF(x, y)) }
        }
        viewport.addView(surface, FrameLayout.LayoutParams(-1, -1))
        viewport.addView(overlay, FrameLayout.LayoutParams(-1, -1))
        if (navigationMode) navigation = CloudNavigation(this, viewport, restore!!.getJSONObject("discoveryLocation"), compact = productMode)
        layout.addView(viewport, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(this)
        confirm = Button(this).apply {
            text = "최종 위치 확정"; isEnabled = false
            setOnClickListener { confirmRequested.set(true) }
        }
        if (localTip == null) actions.addView(confirm, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(Button(this).apply {
            text = if (productMode && restore != null) "다시 찾기" else if (restore != null) "복원 재시도" else "다시 배치"
            setOnClickListener {
                if (restore != null) { navigation?.startScan(); restoreRetryRequested.set(true) }
                else resetRequested.set(true)
            }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(Button(this).apply { text = "닫기"; setOnClickListener { finish() } },
            LinearLayout.LayoutParams(0, -2, 1f))
        if (productMode) {
            val density = resources.displayMetrics.density
            actions.setPadding((8 * density).toInt(), (8 * density).toInt(), (8 * density).toInt(), (12 * density).toInt())
            for (i in 0 until actions.childCount) {
                val button = actions.getChildAt(i) as Button
                button.textSize = 15f; button.isAllCaps = false; button.setTextColor(Color.WHITE)
                button.background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (button === confirm) Color.rgb(217, 80, 42) else Color.rgb(52, 63, 70))
                    cornerRadius = 14 * density
                }
                button.layoutParams = LinearLayout.LayoutParams(0, (52 * density).toInt(), 1f).apply {
                    setMargins((4 * density).toInt(), 0, (4 * density).toInt(), 0)
                }
            }
        }
        layout.addView(actions)
        setContentView(layout)
        val consentKey = if (cloudMode) "cloudConsent" else "geoConsent"
        consent = getSharedPreferences(GeoRecord.CONSENT_PREFS, 0).getBoolean(consentKey, false)
        if (!consent) {
            AlertDialog.Builder(this).setTitle(if (cloudMode) "Cloud Anchor 사용 안내" else "지리 좌표 기능 사용 안내")
                .setMessage(if (cloudMode)
                    "Cloud Anchor는 Google Play Services for AR를 사용합니다. 공간 복원을 위해 카메라 영상에서 얻은 주변 공간 정보가 Google에 전송됩니다. 이 실험은 앵커를 1일간 저장합니다. 미니맵 탐색에서는 위치 권한과 방향 센서를 추가로 사용하며, 위치 권한 없이도 현장에서 Cloud 복원을 시도할 수 있습니다. Google 개인정보처리방침을 확인하고 동의하면 진행하세요."
                    else "이 기능은 Google Play Services for AR를 사용합니다. 카메라·위치·센서 데이터가 Google에 전송되어 실제 공간의 위치를 추정하는 데 사용됩니다. Google 개인정보처리방침을 확인하고 동의하면 진행하세요.")
                .setPositiveButton("동의하고 시작") { _, _ ->
                    consent = true
                    getSharedPreferences(GeoRecord.CONSENT_PREFS, 0).edit().putBoolean(consentKey, true).apply()
                    ensureSession()
                }
                .setNeutralButton("개인정보처리방침") { _, _ ->
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://policies.google.com/privacy")))
                    finish()
                }
                .setNegativeButton("취소") { _, _ -> finish() }
                .setOnCancelListener { finish() }.show()
        }
    }

    override fun onResume() {
        super.onResume(); resumed = true
        ensureSession()
    }

    private fun ensureSession() {
        if (!resumed || !consent || sessionResumed || isFinishing) return
        if (GeoRecord.key(this, "com.google.android.ar.API_KEY").isBlank()) {
            status.text = "ARCORE_API_KEY가 없습니다. android/local.properties에 설정하고 다시 빌드하세요."
            return
        }
        val required = if (cloudMode) arrayOf(Manifest.permission.CAMERA) else
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION)
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED ||
            (!cloudMode && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)) {
            if (!permissionRequestPending) {
                permissionRequestPending = true
                requestPermissions(required, 501)
            }
            return
        }
        try {
            if (session == null) {
                val install = ArCoreApk.getInstance().requestInstall(this, !installRequested)
                if (install == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true; return
                }
                // Native SIGSEGV cannot be caught by Kotlin; these markers locate
                // startup failures without exposing credentials or location data.
                Log.i("YeogirokGeo", "AR_SESSION_CREATE_BEGIN pid=" + android.os.Process.myPid())
                val created = Session(this)
                Log.i("YeogirokGeo", "AR_SESSION_CREATE_OK")
                if (!cloudMode && !created.isGeospatialModeSupported(Config.GeospatialMode.ENABLED)) {
                    created.close()
                    status.text = "이 기기에서는 Geospatial 기능을 사용할 수 없습니다."
                    return
                }
                try {
                    depthSupported = created.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                    created.configure(created.config.apply {
                        geospatialMode = if (cloudMode) Config.GeospatialMode.DISABLED else Config.GeospatialMode.ENABLED
                        cloudAnchorMode = if (cloudMode) Config.CloudAnchorMode.ENABLED else Config.CloudAnchorMode.DISABLED
                        depthMode = if (depthSupported) Config.DepthMode.AUTOMATIC else Config.DepthMode.DISABLED
                        planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                        updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                        focusMode = Config.FocusMode.AUTO
                    })
                    Log.i("YeogirokGeo", "AR_CONFIG cloud=$cloudMode depthSupported=$depthSupported")
                } catch (error: Exception) { created.close(); throw error }
                session = created
            }
            session!!.resume()
            sessionResumed = true
            resetRequested.set(true)
            // Keep imported coordinates for the initial restoration attempt.
            surface.onResume()
            navigation?.resume()
        } catch (error: Exception) {
            status.text = "AR 시작 실패: ${error.javaClass.simpleName}. 권한·AR 서비스·네트워크를 확인하세요."
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 503) { navigation?.permissionResult(); return }
        if (requestCode != 501) return
        permissionRequestPending = false
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
            (cloudMode || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)) {
            ensureSession()
        } else {
            status.text = if (cloudMode) "카메라 권한이 필요합니다." else "카메라와 정확한 위치 권한이 필요합니다."
            AlertDialog.Builder(this).setMessage(if (cloudMode) "앱 설정에서 카메라를 허용해 주세요."
                else "앱 설정에서 카메라와 정확한 위치를 허용해 주세요.")
                .setPositiveButton("설정") { _, _ ->
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }.setNegativeButton("닫기") { _, _ -> finish() }.show()
        }
    }

    override fun onPause() {
        resumed = false
        detailDialog?.dismiss(); detailDialog = null
        tapTarget.set(null); detailRequested.set(false)
        navigation?.pause()
        if (!::surface.isInitialized) { super.onPause(); return }
        touch.set(null); confirmRequested.set(false)
        overlay.screenPoint = null; overlay.referencePoint = null; overlay.guidance = null; overlay.invalidate()
        surface.onPause() // Stop Session.update() before pausing the session.
        cloud.reset() // No render thread access after onPause() returns.
        tapTarget.set(null); detailRequested.set(false); overlay.cancelPinTap()
        if (sessionResumed) { session?.pause(); sessionResumed = false }
        super.onPause()
    }

    override fun onDestroy() {
        detailDialog?.dismiss(); detailDialog = null
        navigation?.destroy(); navigation = null
        session?.close(); session = null
        super.onDestroy()
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        try { background.createOnGlThread(this); glReady = true }
        catch (_: Exception) { glReady = false; runOnUiThread { status.text = "카메라 렌더러 초기화 실패" } }
    }
    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w; height = h; GLES20.glViewport(0, 0, w, h)
    }

    // Manual restoration retry replaces only the orange geospatial anchor.
    // The green reference anchor remains in the same live AR session.
    private fun resetRestoredAnchor() {
        tapTarget.set(null); detailRequested.set(false)
        cloud.reset()
        overlay.inputEnabled = true
        anchor?.detach(); anchor = null; validPlacement = false
        overlay.screenPoint = null
        overlay.guidance = null
        restoreAttempted = false
        restoreAttempts = 0; nextRestoreAttemptAt = 0L
        touch.set(null); confirmRequested.set(false)
    }

    private fun resetAnchor() {
        resetRestoredAnchor()
        measurementAnchor?.detach(); measurementAnchor = null
        overlay.referencePoint = null
        restoreRetryRequested.set(false)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val current = session ?: return
        if (!glReady || !sessionResumed) return
        try {
            if (resetRequested.getAndSet(false)) {
                resetAnchor()
                overlay.measurementMode = restore != null
                restoreAttempted = false
                placementMessage = if (restore != null) "저장 좌표 복원 준비 중. 카메라와 Earth 추적을 기다립니다."
                    else "바닥을 터치하고 핀을 끌어 위치를 조정하세요."
                if (cloudMode) placementMessage = if (restore != null) "Cloud ID로 공간 복원을 요청합니다."
                    else "터치로 배치한 뒤 핀을 끌어 조정하세요. GOOD 품질을 유지하면 저장할 수 있습니다."
            }
            if (restoreRetryRequested.getAndSet(false) && restore != null) {
                resetRestoredAnchor()
                placementMessage = if (measurementAnchor != null)
                    "초록 기준점은 유지하고 주황 핀 좌표만 다시 복원합니다."
                    else "주황 핀 좌표를 다시 복원합니다. 원래 지점을 선택하면 자동 계산됩니다."
            }
            current.setDisplayGeometry(windowManager.defaultDisplay.rotation, width, height)
            current.setCameraTextureName(background.textureId)
            val frame = current.update()
            background.draw(frame)
            if (cloudMode) {
                drawCloudFrame(current, frame)
                return
            }
            val earth = current.earth
            val cameraTracking = frame.camera.trackingState == TrackingState.TRACKING
            val earthTracking = earth?.trackingState == TrackingState.TRACKING &&
                earth.earthState == Earth.EarthState.ENABLED

            val lifecycle = geoTrackingDecision(frame.camera.trackingState, earthTracking,
                anchor?.trackingState, measurementAnchor?.trackingState, validPlacement, restore != null)
            if (lifecycle.discardAnchor && anchor != null) {
                anchor?.detach(); anchor = null; validPlacement = false
                placementMessage = if (restore != null) "핀 추적이 종료됐습니다. 좌표 재복원을 눌러 주세요."
                    else "핀 추적이 종료됐습니다. 다시 배치하세요."
                Log.i("YeogirokGeo", "ANCHOR_STOPPED")
            }
            if (lifecycle.discardReference && measurementAnchor != null) {
                measurementAnchor?.detach(); measurementAnchor = null
                placementMessage = "기준점 추적이 종료됐습니다. 원래 지점을 다시 선택하세요."
                Log.i("YeogirokGeo", "REFERENCE_STOPPED")
            }
            // PAUSED retains both anchors; pending gestures/confirmations are discarded below.
            if (cameraTracking && earthTracking && restore != null && !restoreAttempted &&
                restoreAttempts < 3 && SystemClock.elapsedRealtime() >= nextRestoreAttemptAt) {
                restoreAttempts++
                try {
                    val tip = restore!!.optJSONObject("restorationTarget") ?: restore!!.getJSONObject("tip")
                    val q = tip.getJSONArray("eusQuaternion")
                    anchor = earth!!.createAnchor(tip.getDouble("latitude"), tip.getDouble("longitude"),
                        tip.getDouble("altitude"), q.getDouble(0).toFloat(), q.getDouble(1).toFloat(),
                        q.getDouble(2).toFloat(), q.getDouble(3).toFloat())
                    restoreAttempted = true // Only successful creation completes the attempt.
                    validPlacement = true
                    placementMessage = if (measurementAnchor != null)
                        "초록 기준점을 유지해 주황 핀을 재복원했습니다. 거리 차이를 다시 계산합니다."
                        else "복원된 주황 핀은 고정됩니다. 원래 놓았던 실제 지점을 터치하면 차이를 자동 계산합니다."
                } catch (error: Exception) {
                    nextRestoreAttemptAt = SystemClock.elapsedRealtime() + 2_000L
                    placementMessage = "좌표 복원 실패: ${error.javaClass.simpleName} ($restoreAttempts/3). " +
                        if (restoreAttempts < 3) "잠시 후 다시 시도합니다." else "좌표 재복원을 눌러 주세요."
                    Log.w("YeogirokGeo", "ANCHOR_CREATE_FAILED " + error.javaClass.simpleName)
                }
            }
            touch.getAndSet(null)?.let { point ->
                if (cameraTracking) {
                    // Existing geospatial reference estimates retain their plane-only method label.
                    val hit = selectHit(frame, point, useDepth = allowDepth && restore == null)
                    if (hit != null) {
                        val next = hit.createAnchor()
                        placementHitType = hitType(hit)
                        if (restore != null) {
                            measurementAnchor?.detach(); measurementAnchor = next
                            placementMessage = "원래 지점을 선택했습니다. 초록 점을 확인하고 최종 위치 확정을 누르세요."
                        } else {
                            anchor?.detach(); anchor = next; validPlacement = true
                            placementMessage = "핀 끝의 위치를 조정했습니다. Earth 추적 후 확정할 수 있습니다."
                        }
                    } else {
                        if (restore != null) {
                            measurementAnchor?.detach(); measurementAnchor = null
                        } else { validPlacement = false }
                        placementMessage = "터치 지점의 평면이 없습니다. 바닥을 더 비춘 뒤 다시 선택하세요."
                    }
                }
            }
            val point = anchor
            val reference = measurementAnchor
            val referenceTracking = reference?.trackingState == TrackingState.TRACKING
            val tracking = geoTrackingDecision(frame.camera.trackingState, earthTracking,
                point?.trackingState, reference?.trackingState, validPlacement, restore != null)
            val ready = tracking.canConfirm
            overlay.referencePoint = if (tracking.showReference) project(frame, reference!!.pose) else null
            // Read both anchors after the same Session.update(); never compare old-session XYZ.
            val estimate = if (ready && restore != null && referenceTracking) {
                val restoredPose = point!!.pose
                val originalPose = reference!!.pose
                JSONObject()
                    .put("horizontalOffsetMeters", hypot((restoredPose.tx() - originalPose.tx()).toDouble(),
                        (restoredPose.tz() - originalPose.tz()).toDouble()))
                    .put("verticalOffsetMeters", (restoredPose.ty() - originalPose.ty()).toDouble())
                    .put("method", "arcore-plane-hit-test")
                    .put("deviceLabel", "${Build.MANUFACTURER} ${Build.MODEL}")
                    .put("estimatedAt", Instant.now().toString())
                    .put("groundTruth", false)
            } else null
            // Show the local pin even while Earth is still localizing.
            val projectedPin = if (tracking.showAnchor) projectWithGuidance(frame, point!!.pose) else null
            overlay.screenPoint = projectedPin?.let { p ->
                if (p.visible) PointF(p.x!!, p.y!!) else null
            }
            val pinStatus = when {
                !cameraTracking -> "핀 숨김: 카메라 추적 회복 대기 (${frame.camera.trackingFailureReason})"
                restore != null && !earthTracking -> "핀: Earth 추적 대기 중"
                point == null -> if (restore != null) "핀: 좌표 복원 준비 중" else "바닥을 터치해 핀을 놓으세요."
                point.trackingState == TrackingState.STOPPED -> "핀 추적 종료 — 좌표 재복원을 눌러 주세요."
                point.trackingState != TrackingState.TRACKING -> "핀: 추적 대기 중 (${point.trackingState})"
                !validPlacement -> "핀 배치가 유효하지 않습니다. 다시 배치해 주세요."
                else -> projectedPin?.guidance ?: "핀 투영 대기 중"
            }
            val pinDistance = if (tracking.showAnchor) {
                val p = point!!.pose; val c = frame.camera.pose
                "\n카메라 기준 추정: 수평 %.1fm / 높이 %+.1fm".format(
                    hypot((p.tx() - c.tx()).toDouble(), (p.tz() - c.tz()).toDouble()), p.ty() - c.ty())
            } else ""
            overlay.guidance = if (overlay.screenPoint == null && (restore != null || point != null)) pinStatus else null
            overlay.postInvalidateOnAnimation()
            if (confirmRequested.getAndSet(false)) {
                if (ready && !overlay.dragging) {
                    // All values come from this exact Session.update() frame.
                    val pose = point!!.pose
                    val geo = earth!!.getGeospatialPose(pose)
                    val record = GeoRecord.create(sessionId, pose, geo, earth.cameraGeospatialPose,
                        frame.timestamp, restore?.optString("recordId"))
                    record.put("placementHitType", if (restore == null) placementHitType else "GEOSPATIAL")
                    record.put("depthEnabled", depthSupported)
                    record.put("depthHitAllowed", allowDepth && restore == null)
                    restore?.let { original ->
                        record.put("restorationTarget", original.optJSONObject("restorationTarget") ?: original.getJSONObject("tip"))
                        original.optJSONObject("reference")?.let { record.put("reference", it) }
                    }
                    estimate?.let { record.put("restorationEstimate", it) }
                    GeoRecord.parse(record.toString())
                    if (resultDelivered.compareAndSet(false, true)) runOnUiThread {
                        setResult(RESULT_OK, Intent().putExtra("record", record.toString()))
                        finish()
                    }
                } else { placementMessage = "추적·평면·Earth 상태를 확인하고 손을 뗀 뒤 확정하세요." }
            }
            if (SystemClock.elapsedRealtime() - lastUiTime > 250) {
                lastUiTime = SystemClock.elapsedRealtime()
                val quality = if (earthTracking) {
                    val g = earth!!.cameraGeospatialPose
                    "Earth 추정 정확도(68%%): 수평 %.2fm / 수직 %.2fm / 방향 %.1f°".format(
                        g.horizontalAccuracy, g.verticalAccuracy, g.orientationYawAccuracy)
                } else "Earth 위치 추정 대기 — 실외에서 주변을 천천히 비춰 주세요."
                val coordinates = if (cameraTracking && earthTracking && validPlacement &&
                    point?.trackingState == TrackingState.TRACKING) {
                    // Same frame and session as confirmation; never substitute camera GPS for the tip.
                    val p = point.pose
                    val tip = earth!!.getGeospatialPose(p)
                    val camera = earth.cameraGeospatialPose
                    "\n팁 XYZ (세션 m): %.3f, %.3f, %.3f\n팁 위도/경도: %.7f, %.7f\n팁 고도 (WGS84): %.2fm\n팁 추정 정확도(68%%): 수평 %.2fm / 수직 %.2fm / 방향 %.1f°\n카메라 위도/경도: %.7f, %.7f\n카메라 고도 (WGS84): %.2fm\n카메라 값은 ARCore 추정치이며 별도 GPS 측정값이 아닙니다.".format(
                        p.tx(), p.ty(), p.tz(), tip.latitude, tip.longitude, tip.altitude,
                        tip.horizontalAccuracy, tip.verticalAccuracy, tip.orientationYawAccuracy,
                        camera.latitude, camera.longitude, camera.altitude)
                } else "\n팁 지리 좌표: 현재 측정 불가 (이전 값 표시 안 함)"
                val measured = if (estimate != null) {
                    "\nAR 자동 추정: 수평 %.2fm / 수직 %+.2fm\n평면·터치 오차 포함, 줄자 실측 아님".format(
                        estimate.getDouble("horizontalOffsetMeters"), estimate.getDouble("verticalOffsetMeters"))
                } else if (reference != null && !referenceTracking) "\n원래 지점 추적 대기 중" else ""
                val text = "카메라: ${frame.camera.trackingState}\nEarth: ${earth?.earthState} / ${earth?.trackingState}\n앵커: ${point?.trackingState ?: "없음"}\n$quality\n$pinStatus$pinDistance$coordinates\n$placementMessage$measured\n실험용 측정: 정확도 임계값 미설정 / 기기 간 복원 미검증"
                val direction = if (tracking.showAnchor) relativeDirection(
                    frame.camera.displayOrientedPose.inverse().transformPoint(point!!.pose.translation)) else null
                runOnUiThread {
                    if (!isFinishing) {
                        status.text = "$text\nHit: $placementHitType / Depth 지원: $depthSupported / Depth Hit 허용: $allowDepth\n${direction ?: ""}"
                        confirm.isEnabled = ready && !overlay.dragging
                    }
                }
            }
        } catch (error: Exception) {
            // A transient frame error must not permanently hide an already restored anchor.
            // Keep local placement through transient errors too; this frame cannot be confirmed.
            touch.set(null); confirmRequested.set(false)
            tapTarget.set(null); detailRequested.set(false)
            overlay.guidance = "AR 처리 대기 중 — 상단 상태를 확인하세요."
            overlay.screenPoint = null
            overlay.referencePoint = null
            overlay.postInvalidateOnAnimation()
            val text = "AR 처리 오류: ${error.javaClass.simpleName}. 다시 배치하거나 화면을 다시 여세요."
            if (SystemClock.elapsedRealtime() - lastUiTime > 1000) {
                lastUiTime = SystemClock.elapsedRealtime()
                runOnUiThread { status.text = text; confirm.isEnabled = false }
            }
        }
    }

    private fun selectHit(frame: Frame, point: PointF, useDepth: Boolean = allowDepth): HitResult? =
        frame.hitTest(point.x, point.y).firstOrNull { hit ->
            if (!ArExperimentPolicy.acceptsHit(hit.distance)) false
            else when (val trackable = hit.trackable) {
                is Plane -> trackable.trackingState == TrackingState.TRACKING && trackable.isPoseInPolygon(hit.hitPose)
                is DepthPoint -> useDepth && depthSupported && trackable.trackingState == TrackingState.TRACKING
                else -> false
            }
        }

    private fun hitType(hit: HitResult) = if (hit.trackable is DepthPoint) "DEPTH" else "PLANE"

    private fun drawCloudFrame(current: Session, frame: Frame) {
        val cameraTracking = frame.camera.trackingState == TrackingState.TRACKING
        if (anchor?.trackingState == TrackingState.STOPPED) {
            anchor?.detach(); anchor = null; validPlacement = false
            if (restore == null) cloud.reset() else cloud.placementChanged()
            placementMessage = "앵커 추적이 종료됐습니다. 다시 배치하거나 복원 재시도를 눌러 주세요."
        }
        if (measurementAnchor?.trackingState == TrackingState.STOPPED) {
            measurementAnchor?.detach(); measurementAnchor = null
        }
        if (restore != null && cameraTracking && !cloud.attempted &&
            (!navigationMode || navigation?.canStartResolve == true))
            cloud.startResolve(current, restore!!.getString("anchorId"))
        cloud.update(current, frame, if (validPlacement) anchor else null, overlay.dragging, hosting = restore == null)
        cloud.takeResolvedAnchor()?.let { anchor?.detach(); anchor = it; validPlacement = true }
        val editable = localTip == null && !navigationMode && cameraTracking && !cloud.busy && !cloud.failed && cloud.hostedId == null
        overlay.inputEnabled = editable
        touch.getAndSet(null)?.let { point ->
            if (editable) {
                val hit = selectHit(frame, point)
                if (restore != null) {
                    measurementAnchor?.detach()
                    measurementAnchor = hit?.createAnchor()
                    if (hit != null) referenceHitType = hitType(hit)
                } else {
                    cloud.placementChanged()
                    if (hit != null) {
                        val next = hit.createAnchor()
                        anchor?.detach(); anchor = next
                        placementHitType = hitType(hit); validPlacement = true
                    } else validPlacement = false
                }
                placementMessage = if (hit == null) "0.2~5m 안에서 인식된 표면을 다시 터치하세요."
                    else "${hitType(hit)} Hit로 위치를 선택했습니다."
            }
        }
        val point = anchor
        val trackingSummary = "camera=${frame.camera.trackingState} anchor=${point?.trackingState} failure=${frame.camera.trackingFailureReason}"
        if (trackingSummary != lastCloudTracking) {
            lastCloudTracking = trackingSummary
            Log.i("YeogirokCloud", "TRACKING $trackingSummary")
        }
        val visible = cameraTracking && validPlacement && !cloud.failed && point?.trackingState == TrackingState.TRACKING
        val reference = measurementAnchor
        val referenceVisible = cameraTracking && reference?.trackingState == TrackingState.TRACKING
        val projection = if (visible) projectWithGuidance(frame, point!!.pose) else null
        overlay.screenPoint = if (projection?.visible == true) PointF(projection.x!!, projection.y!!) else null
        tapTarget.set(if (localTip != null && projection?.visible == true)
            PinTapTarget(projection.x!!, projection.y!!, SystemClock.elapsedRealtime()) else null)
        if (detailRequested.getAndSet(false) && tapTarget.get() != null) runOnUiThread {
            if (resumed && !isFinishing && tapTarget.get()?.let { SystemClock.elapsedRealtime() - it.atMs in 0..500 } == true && detailDialog?.isShowing != true) {
                detailDialog = TipDetailSheet.show(this, localTip!!)
            }
        }
        overlay.referencePoint = if (referenceVisible) project(frame, reference!!.pose) else null
        val direction = if (visible) relativeDirection(frame.camera.displayOrientedPose.inverse().transformPoint(point!!.pose.translation)) else null
        if (navigationMode) {
            val local = if (visible) frame.camera.displayOrientedPose.inverse().transformPoint(point!!.pose.translation) else null
            val distance = local?.let { kotlin.math.sqrt(it.sumOf { n -> n.toDouble() * n }) }
            navigation?.updateAr(if (visible) "${direction ?: "주변을 확인하세요"} · %.2fm".format(distance) else null,
                cloud.busy, cloud.failed, point != null && !visible, local?.let { NavigationPolicy.cameraSpaceAngle(it) })
        }
        val trackingMessage = when {
            !cameraTracking -> "카메라 추적 대기: ${frame.camera.trackingFailureReason}"
            cloud.failed || cloud.busy -> cloud.message
            restore != null && cloud.attempted && point == null -> "앵커 추적이 종료됐습니다. 복원 재시도를 눌러 주세요."
            point != null && point.trackingState != TrackingState.TRACKING -> "앵커 추적 회복 대기 중"
            else -> cloud.message
        }
        val estimate = if (restore != null && visible && referenceVisible) {
            val p = point!!.pose; val r = reference!!.pose
            JSONObject().put("horizontalOffsetMeters", hypot((p.tx() - r.tx()).toDouble(), (p.tz() - r.tz()).toDouble()))
                .put("verticalOffsetMeters", (p.ty() - r.ty()).toDouble())
                .put("referenceHitType", referenceHitType).put("groundTruth", false)
        } else null
        if (confirmRequested.getAndSet(false) && visible && !overlay.dragging) {
            if (restore == null && cloud.canRequestHost(diagnosticHost)) cloud.startHost(current, point!!, diagnosticHost)
            else if (restore != null && !cloud.busy && (estimate != null || navigationMode)) {
                val record = JSONObject(restore.toString())
                    .put("operation", CloudRecord.operation("RESOLVE", sessionId, cloud.durationMs))
                    .put("crossDeviceVerified", false)
                record.remove("restorationEstimate")
                if (estimate != null) record.put("restorationEstimate", estimate)
                returnCloudRecord(record)
            }
        }
        if (restore == null && cloud.hostedId != null && visible) {
            returnCloudRecord(CloudRecord.create(cloud.hostedId!!, cloud.hostedAt!!, point!!.pose,
                placementHitType, depthSupported, allowDepth, sessionId, cloud.durationMs,
                cloud.hostQuality, cloud.hostQualityPolicy))
        }
        val enabled = visible && !overlay.dragging && !cloud.busy &&
            (if (restore == null) cloud.canRequestHost(diagnosticHost) else estimate != null || navigationMode)
        val gateCode = when {
            cloud.failed -> "OPERATION_FAILED"
            cloud.busy -> "BUSY"
            cloud.hostedId != null -> "HOSTED"
            !cameraTracking -> "CAMERA_NOT_TRACKING"
            point == null -> "NO_ANCHOR"
            !validPlacement -> "LAST_HIT_INVALID"
            point.trackingState != TrackingState.TRACKING -> "ANCHOR_NOT_TRACKING"
            overlay.dragging -> "DRAGGING"
            cloud.qualityErrorType != null -> "QUALITY_ERROR"
            !cloud.qualityFresh -> "QUALITY_PENDING"
            diagnosticHost && cloud.canRequestHost(true) -> "DIAGNOSTIC_READY"
            cloud.quality == "INSUFFICIENT" -> "QUALITY_INSUFFICIENT"
            cloud.quality == "SUFFICIENT" -> "QUALITY_SUFFICIENT"
            cloud.canHost -> "READY"
            else -> "GOOD_HOLD"
        }
        val saveHint = when (gateCode) {
            "OPERATION_FAILED", "BUSY", "HOSTED" -> cloud.message
            "CAMERA_NOT_TRACKING" -> "카메라 추적을 기다려요. 원인: ${frame.camera.trackingFailureReason}"
            "NO_ANCHOR" -> "저장할 핀이 없어요. 인식된 표면을 터치해 배치하세요."
            "LAST_HIT_INVALID" -> "마지막 터치에서 표면을 찾지 못했어요. 다시 배치를 눌러 표면을 선택하세요."
            "ANCHOR_NOT_TRACKING" -> "핀 추적을 기다려요. 원래 주변을 천천히 비춰 주세요."
            "DRAGGING" -> "위치 조정 중이에요. 화면에서 손을 떼 주세요."
            "QUALITY_ERROR" -> "특징 품질 측정 오류. ${cloud.qualityErrorType}"
            "QUALITY_PENDING" -> "특징 품질 평가를 기다려요. 핀 주변을 화면에 유지해 주세요."
            "QUALITY_INSUFFICIENT" -> "주변 특징이 부족해요. 핀 주변을 다른 각도에서 비춰 주세요."
            "QUALITY_SUFFICIENT" -> if (productMode) "주변을 조금 더 비춰 주세요. 저장할 공간을 확인하고 있어요." else "특징 품질은 SUFFICIENT예요. 이 실험은 GOOD까지 기다려요."
            "READY" -> if (productMode) "준비됐어요. 아래 ‘이 위치에 저장’을 눌러 주세요." else "저장할 준비가 됐어요. Cloud 저장을 눌러 주세요."
            "DIAGNOSTIC_READY" -> "현재 품질 ${cloud.quality}로 시험해요. 시험 저장을 눌러 주세요."
            else -> "GOOD 상태를 확인하고 있어요. %.1f / 1.0초".format(cloud.goodHoldMillis / 1000.0)
        }
        if (restore == null) {
            val gateState = "$gateCode valid=$validPlacement dragging=${overlay.dragging} quality=${cloud.quality}" +
                " fresh=${cloud.qualityFresh} enabled=$enabled diagnostic=$diagnosticHost"
            val now = SystemClock.elapsedRealtime()
            // Heartbeat distinguishes a persistent low result from a suspended evaluator.
            if (gateState != lastCloudGate || now - lastCloudGateAt >= 5_000L) {
                lastCloudGate = gateState; lastCloudGateAt = now
                Log.i("YeogirokCloud", "HOST_GATE $gateState samples=${cloud.qualitySampleCount}")
            }
        }
        overlay.guidance = if (navigationMode) null else if (restore == null && !enabled) saveHint else if (!visible) trackingMessage
            else if (projection?.visible != true) projection?.guidance else null
        overlay.postInvalidateOnAnimation()
        if (SystemClock.elapsedRealtime() - lastUiTime > 250L) {
            lastUiTime = SystemClock.elapsedRealtime()
            val measured = estimate?.let { "\n참고 차이: 수평 %.2fm / 수직 %+.2fm (측량값 아님)".format(
                it.getDouble("horizontalOffsetMeters"), it.getDouble("verticalOffsetMeters")) } ?: ""
            val coordinates = if (visible) "\n최종 XYZ(현재 세션 m): %.3f, %.3f, %.3f".format(
                point!!.pose.tx(), point.pose.ty(), point.pose.tz()) else ""
            val message = "Cloud Anchor ${if (restore == null) "작성" else "복원"} 실험\n" +
                (if (restore == null) "저장 상태: $saveHint\n" else "") +
                "카메라: ${frame.camera.trackingState} / 앵커: ${point?.trackingState ?: "없음"}\n" +
                "특징 품질: ${if (cloud.qualityFresh) cloud.quality else "현재 평가 없음"} / GOOD 1초 유지: ${cloud.canHost}\n" +
                "Depth 지원: $depthSupported / Hit 허용: $allowDepth / 배치 Hit: $placementHitType\n" +
                "$trackingMessage\n$placementMessage\n${direction ?: ""}$coordinates$measured\n" +
                "지리 좌표·위치 정확도: 이 모드에서는 측정하지 않음\n수명 1일 실험 / 기기 간 복원 성공 미검증"
            runOnUiThread { if (!isFinishing) {
                status.text = if (!productMode) message else if (localTip != null) {
                    "${localTip!!.getString("title")}\n" + if (visible && projection?.visible == true) "핀을 눌러 글과 사진을 확인하세요 · 내 팁" else if (visible) "${direction ?: "주변을 둘러보세요"} · 핀을 찾아보세요" else trackingMessage
                } else "이곳에 팁 남기기\n$saveHint"
                confirm.isEnabled = enabled
                if (productMode) confirm.alpha = if (enabled) 1f else 0.4f
                confirm.text = if (productMode) "이 위치에 저장" else if (navigationMode) "복원 결과 기록" else if (restore != null) "비교 기록" else if (diagnosticHost) "시험 저장" else "Cloud 저장"
            } }
        }
    }

    private fun returnCloudRecord(record: JSONObject) {
        CloudRecord.parse(record.toString())
        if (resultDelivered.compareAndSet(false, true)) runOnUiThread {
            Log.i("YeogirokCloud", "RECORD_RETURNED type=${record.getJSONObject("operation").getString("type")}")
            setResult(RESULT_OK, Intent().putExtra("record", record.toString()))
            finish()
        }
    }

    private fun project(frame: Frame, pose: Pose): PointF? {
        val p = projectWithGuidance(frame, pose)
        return if (p.visible) PointF(p.x!!, p.y!!) else null
    }

    private fun projectWithGuidance(frame: Frame, pose: Pose): PinProjection {
        val projection = FloatArray(16); val view = FloatArray(16); val vp = FloatArray(16)
        frame.camera.getProjectionMatrix(projection, 0, 0.1f, 1000f)
        frame.camera.getViewMatrix(view, 0)
        Matrix.multiplyMM(vp, 0, projection, 0, view, 0)
        val result = FloatArray(4)
        Matrix.multiplyMV(result, 0, vp, 0, floatArrayOf(pose.tx(), pose.ty(), pose.tz(), 1f), 0)
        return projectPin(result, width, height)
    }

    private inner class PinOverlay : View(this@GeoArActivity) {
        @Volatile var inputEnabled = true
        @Volatile var screenPoint: PointF? = null
        @Volatile var dragging = false
        @Volatile var measurementMode = false
        @Volatile var guidance: String? = null
        @Volatile var referencePoint: PointF? = null
        var onPoint: ((Float, Float) -> Unit)? = null
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val density = resources.displayMetrics.density
        private var offsetX = 0f; private var offsetY = 0f
        private val pinTap = PinTapPolicy(android.view.ViewConfiguration.get(this@GeoArActivity).scaledTouchSlop.toFloat())
        fun cancelPinTap() { pinTap.cancel() }
        override fun onDraw(canvas: Canvas) {
            guidance?.let { hint ->
                paint.color = Color.argb(210, 17, 24, 39)
                canvas.drawRoundRect(8 * density, 8 * density, width - 8 * density, 66 * density,
                    8 * density, 8 * density, paint)
                paint.color = Color.WHITE; paint.textAlign = Paint.Align.CENTER
                paint.textSize = 13 * density
                val first = hint.substringBefore(". ")
                val second = hint.substringAfter(". ", "")
                canvas.drawText(first, width / 2f, 31 * density, paint)
                canvas.drawText(second, width / 2f, 53 * density, paint)
                paint.textAlign = Paint.Align.LEFT
            }
            referencePoint?.let { r ->
                paint.color = Color.rgb(50, 220, 120)
                canvas.drawCircle(r.x, r.y, 9 * density, paint)
                paint.color = Color.WHITE
                canvas.drawCircle(r.x, r.y, 3 * density, paint)
            }
            val p = screenPoint ?: return
            canvas.save(); canvas.translate(p.x, p.y); canvas.scale(density, density)
            val path = Path().apply {
                moveTo(0f, 0f); cubicTo(-12f, -20f, -25f, -32f, -25f, -48f)
                cubicTo(-25f, -80f, 25f, -80f, 25f, -48f)
                cubicTo(25f, -32f, 12f, -20f, 0f, 0f); close()
            }
            paint.color = Color.rgb(255, 107, 53); canvas.drawPath(path, paint)
            paint.color = Color.WHITE; canvas.drawCircle(0f, -48f, 9f, paint)
            paint.color = Color.rgb(255, 107, 53); canvas.drawCircle(0f, 0f, 4f, paint)
            canvas.restore()
        }
        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (localTip != null) {
                if (event.pointerCount != 1) { pinTap.cancel(); return true }
                val now = SystemClock.elapsedRealtime()
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> pinTap.down(event.x, event.y, tapTarget.get(), density, now)
                    MotionEvent.ACTION_MOVE -> pinTap.move(event.x, event.y)
                    MotionEvent.ACTION_UP -> if (pinTap.up(event.x, event.y, tapTarget.get(), density, now)) {
                        detailRequested.set(true); performClick()
                    }
                    MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> pinTap.cancel()
                }
                return true
            }
            if (!inputEnabled) { dragging = false; return true }
            if (event.pointerCount != 1) { dragging = false; return true }
            if (measurementMode) {
                dragging = false
                if (event.actionMasked == MotionEvent.ACTION_UP) {
                    onPoint?.invoke(event.x, event.y)
                    performClick()
                }
                return true
            }
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val p = screenPoint
                    dragging = p == null || (event.x in (p.x - 35 * density)..(p.x + 35 * density) &&
                        event.y in (p.y - 85 * density)..(p.y + 15 * density))
                    offsetX = if (p != null && dragging) event.x - p.x else 0f
                    offsetY = if (p != null && dragging) event.y - p.y else 0f
                    if (dragging && p == null) onPoint?.invoke(event.x, event.y)
                }
                MotionEvent.ACTION_MOVE -> if (dragging) onPoint?.invoke(event.x - offsetX, event.y - offsetY)
                MotionEvent.ACTION_UP -> {
                    if (dragging) onPoint?.invoke(event.x - offsetX, event.y - offsetY)
                    dragging = false; performClick()
                }
                MotionEvent.ACTION_CANCEL -> dragging = false
            }
            return true
        }
        override fun performClick(): Boolean { super.performClick(); return true }
    }
}
