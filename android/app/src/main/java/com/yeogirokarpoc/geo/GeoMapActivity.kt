package com.yeogirokarpoc.geo

import android.Manifest
import android.content.pm.PackageManager
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.*
import android.os.Bundle
import android.util.Log
import android.widget.*
import com.kakao.vectormap.*
import com.kakao.vectormap.label.*
import com.kakao.vectormap.camera.CameraUpdateFactory
import org.json.JSONObject
import java.time.Instant
import kotlin.math.*

class GeoMapActivity : Activity() {
    private lateinit var record: JSONObject
    private lateinit var view: MapView
    private lateinit var summary: TextView
    private var map: KakaoMap? = null
    private var layer: LabelLayer? = null
    private var started = false
    private var mapFailed = false
    private var nativeAppKey = ""
    private lateinit var mapStatus: TextView
    private val loadingTimeout = Runnable {
        if (!isFinishing && !isDestroyed && map == null && !mapFailed) {
            mapStatus.text = "지도 응답 대기 중 (20초 경과)\n네트워크를 확인한 뒤 지도 재시도를 눌러 주세요."
            Log.w("YeogirokMap", "MAP_READY_TIMEOUT")
        }
    }
    private var currentLocation: JSONObject? = null
    private var locationRequest: CancellationTokenSource? = null
    private lateinit var locationStatus: TextView
    private val locationExpiry = Runnable {
        currentLocation = null
        if (!isFinishing && !isDestroyed) {
            locationStatus.text = "현재 위치 측정 후 10초가 지났습니다. 다시 갱신하세요."
            drawLabels()
        }
    }
    private var referenceMode = false
    private var cloudMode = false
    private lateinit var saveButton: Button
    private lateinit var referenceButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cloudMode = intent.getBooleanExtra("cloudMode", false)
        record = try { if (cloudMode) CloudRecord.parse(intent.getStringExtra("record") ?: "")
            else GeoRecord.parse(intent.getStringExtra("record") ?: "") }
        catch (_: Exception) { finish(); return }
        val key = GeoRecord.key(this, "com.yeogirokarpoc.KAKAO_NATIVE_APP_KEY")
        if (key.isBlank()) { finish(); return }
        nativeAppKey = key
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; fitsSystemWindows = true
            setBackgroundColor(Color.rgb(17, 24, 39))
        }
        val stateRow = LinearLayout(this)
        mapStatus = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 14f; setPadding(16, 12, 16, 12)
            text = "카카오 지도 준비 중…"
        }
        stateRow.addView(mapStatus, LinearLayout.LayoutParams(0, -2, 1f))
        stateRow.addView(Button(this).apply {
            text = "지도 재시도"
            setOnClickListener {
                intent.putExtra("record", record.toString())
                recreate()
            }
        })
        layout.addView(stateRow)
        summary = TextView(this).apply { setTextColor(Color.WHITE); textSize = 14f; setPadding(24, 16, 24, 16) }
        // Keep the coordinate details scrollable so the map retains space on small screens.
        layout.addView(ScrollView(this).apply { addView(summary) },
            LinearLayout.LayoutParams(-1, (120 * resources.displayMetrics.density).toInt()))
        locationStatus = TextView(this).apply { setTextColor(Color.LTGRAY); text = "현재 위치: 아직 측정하지 않음" }
        layout.addView(locationStatus)
        layout.addView(Button(this).apply {
            text = "내 현재 위치 갱신"
            setOnClickListener { refreshLocation() }
        })
        try { KakaoMapSdk.init(applicationContext, key) }
        catch (error: Exception) {
            showMapError("초기화", error)
            layout.addView(Button(this).apply { text = "닫기"; setOnClickListener { finish() } })
            setContentView(layout)
            return
        }
        view = MapView(this)
        layout.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        referenceButton = Button(this).apply {
            text = if (cloudMode) "탐색 위치 선택" else "지도에서 비교점 선택"; isEnabled = false
            setOnClickListener {
                referenceMode = !referenceMode
                text = if (referenceMode) "지도에서 위치를 터치하세요 (취소)"
                    else if (cloudMode) "탐색 위치 선택" else "지도에서 비교점 선택"
            }
        }
        layout.addView(referenceButton)
        saveButton = Button(this).apply {
            text = if (cloudMode) "탐색 위치를 연결하고 돌아가기" else "기록에 반영하고 돌아가기"
            isEnabled = !cloudMode || record.has("discoveryLocation")
            setOnClickListener {
                if (cloudMode) CloudRecord.parse(record.toString())
                setResult(RESULT_OK, Intent().putExtra("record", record.toString())); finish()
            }
        }
        layout.addView(saveButton)
        setContentView(layout)
        updateSummary()
        try {
            mapStatus.text = "카카오 지도 인증·로딩 중…"
            mapStatus.postDelayed(loadingTimeout, 20_000)
            Log.i("YeogirokMap", "MAP_START_BEGIN")
            view.post { Log.i("YeogirokMap", "MAP_VIEW_SIZE "+view.width+"x"+view.height) }
            view.start(object : MapLifeCycleCallback() {
                override fun onMapDestroy() {
                    Log.i("YeogirokMap", "MAP_DESTROYED")
                }
                override fun onMapError(error: Exception) {
                    showMapError("인증·로딩", error)
                }
            }, object : KakaoMapReadyCallback() {
                override fun getPosition(): LatLng = if (cloudMode)
                    record.optJSONObject("discoveryLocation")?.let { location(it) }
                        ?: LatLng.from(37.5665, 126.9780) // View center only; never saved as a target.
                    else location(record.getJSONObject("tip"))
                override fun getZoomLevel(): Int = 19
                override fun onMapReady(kakaoMap: KakaoMap) {
                    map = kakaoMap
                    runOnUiThread {
                        if (!isFinishing && !isDestroyed) {
                            mapStatus.removeCallbacks(loadingTimeout)
                            mapStatus.text = "지도 준비 완료 — 지도가 보이지 않으면 이 문구를 알려 주세요."
                            referenceButton.isEnabled = true
                            if (cloudMode) {
                                referenceMode = true
                                referenceButton.text = "지도에서 탐색 위치를 터치하세요 (취소)"
                            }
                            Log.i("YeogirokMap", "MAP_READY")
                        }
                    }
                    layer = kakaoMap.labelManager?.addLayer(
                        LabelLayerOptions.from("validation-points").setCompetitionType(CompetitionType.None))
                    drawLabels()
                    kakaoMap.setOnMapClickListener { _, position, _, _ ->
                        if (referenceMode) runOnUiThread {
                            AlertDialog.Builder(this@GeoMapActivity)
                                .setTitle(if (cloudMode) "Cloud 팁의 탐색 위치 연결" else "지도 비교점 사용")
                                .setMessage(if (cloudMode) "이 위치는 근처까지 안내할 탐색용 위치입니다. 팁의 정밀 AR 위치는 기존 Cloud Anchor로 복원하며, 지도 위치의 오차는 알 수 없습니다."
                                    else "지도에서 찍은 점은 측량 기준점이 아닙니다. 지도의 위치 오차와 터치 오차가 포함된 참고 비교로 기록합니다.")
                                .setPositiveButton("사용") { _, _ ->
                                    if (cloudMode) record.put("discoveryLocation", JSONObject()
                                        .put("latitude", position.latitude).put("longitude", position.longitude)
                                        .put("source", "MAP_SELECTED").put("uncertaintyMeters", JSONObject.NULL)
                                        .put("capturedAt", Instant.now().toString()))
                                    else record.put("reference", JSONObject()
                                        .put("latitude", position.latitude).put("longitude", position.longitude)
                                        .put("source", "map-tap").put("sourceLabel", "카카오 지도 직접 선택")
                                        .put("uncertaintyMeters", JSONObject.NULL).put("capturedAt", Instant.now().toString()))
                                    referenceMode = false
                                    referenceButton.text = if (cloudMode) "탐색 위치 다시 선택" else "지도에서 비교점 선택"
                                    saveButton.isEnabled = true
                                    if (!cloudMode) record.remove("comparison") // Recompute in RN.
                                    drawLabels(); updateSummary()
                                }.setNegativeButton("취소", null).show()
                        }
                    }
                }
            })
            started = true
        } catch (error: Exception) {
            showMapError("시작", error)
        }
    }

    private fun showMapError(stage: String, error: Exception) {
        val code = (error as? MapAuthException)?.errorCode
        // SDK error messages can contain credentials. Never show or log the app key.
        val detail = (error.message ?: "상세 메시지 없음")
            .replace(nativeAppKey, "[키 숨김]")
            .replace(Regex("(?i)[a-f0-9]{32}"), "[키 숨김]")
            .take(400)
        val hint = when (code) {
            401 -> "네이티브 앱 키와 Android 패키지·키 해시 등록을 확인하세요."
            403 -> "카카오맵 사용 설정과 앱 권한을 확인하세요."
            429 -> "카카오맵 사용량 한도를 확인하세요."
            -2, -3, -4, 499 -> "휴대폰의 인터넷 연결을 확인하세요."
            else -> "아래 오류 코드와 메시지를 확인하세요."
        }
        Log.e("YeogirokMap", "MAP_ERROR stage=$stage type=${error.javaClass.simpleName} code=$code")
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                mapFailed = true
                mapStatus.removeCallbacks(loadingTimeout)
                mapStatus.text = "지도 $stage 실패: ${error.javaClass.simpleName} (코드: ${code ?: "없음"})\n$detail\n$hint"
                if (::referenceButton.isInitialized) referenceButton.isEnabled = false
            }
        }
    }

    private fun refreshLocation() {
        locationStatus.removeCallbacks(locationExpiry)
        currentLocation = null; drawLabels()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 502)
            locationStatus.text = "정확한 위치 권한을 허용한 후 다시 갱신하세요."
            return
        }
        locationRequest?.cancel()
        val request = CancellationTokenSource()
        locationRequest = request
        locationStatus.text = "현재 위치 측정 중…"
        LocationServices.getFusedLocationProviderClient(this)
            .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, request.token)
            .addOnSuccessListener { value ->
                if (isFinishing || isDestroyed || request !== locationRequest) return@addOnSuccessListener
                if (value == null) { locationStatus.text = "현재 위치를 얻지 못했습니다. 실외에서 다시 시도하세요."; return@addOnSuccessListener }
                val delta = android.os.SystemClock.elapsedRealtimeNanos() - value.elapsedRealtimeNanos
                val ageMs = delta / 1_000_000
                if (delta < 0 || !ArExperimentPolicy.freshLocation(ageMs, value.accuracy, value.hasAccuracy())) {
                    locationStatus.text = "오래되었거나 정확도 정보가 없는 위치입니다. 다시 갱신하세요."
                    return@addOnSuccessListener
                }
                currentLocation = JSONObject().put("latitude", value.latitude).put("longitude", value.longitude)
                if (cloudMode) map?.moveCamera(CameraUpdateFactory.newCenterPosition(
                    LatLng.from(value.latitude, value.longitude), 18))
                locationStatus.text = "보라: 현재 기기 / 융합 위치 추정 정확도 %.1fm / %.1f초 전 측정\n탐색 참고용이며 상세 열람 권한을 판정하지 않습니다.".format(value.accuracy, ageMs / 1000.0)
                locationStatus.postDelayed(locationExpiry, ArExperimentPolicy.MAX_LOCATION_AGE_MS - ageMs + 1)
                drawLabels()
            }.addOnFailureListener {
                if (!isFinishing && !isDestroyed && request === locationRequest)
                    locationStatus.text = "현재 위치 측정 실패. 위치 설정을 확인하세요."
            }
    }

    private fun location(value: JSONObject) = LatLng.from(value.getDouble("latitude"), value.getDouble("longitude"))

    private fun icon(color: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(40, 48, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        val path = Path().apply { moveTo(20f, 48f); lineTo(3f, 24f); lineTo(37f, 24f); close() }
        canvas.drawPath(path, paint); canvas.drawCircle(20f, 20f, 18f, paint)
        paint.color = Color.WHITE; canvas.drawCircle(20f, 20f, 7f, paint)
        return bitmap
    }

    private fun drawLabels() {
        val activeMap = map ?: return
        val activeLayer = layer ?: return
        activeLayer.removeAll()
        fun add(id: String, title: String, coordinate: JSONObject, color: Int) {
            val style = activeMap.labelManager?.addLabelStyles(LabelStyles.from(
                LabelStyle.from(icon(color)).setAnchorPoint(0.5f, 1f).setTextStyles(14, color))) ?: return
            activeLayer.addLabel(LabelOptions.from(id, location(coordinate)).setStyles(style).setTexts(LabelTextBuilder().setTexts(title)))
        }
        currentLocation?.let { add("current", "현재 기기 위치", it, Color.rgb(140, 70, 210)) }
        if (cloudMode) {
            record.optJSONObject("discoveryLocation")?.let { add("discovery", "탐색 위치 (오차 미상)", it, Color.rgb(255, 107, 53)) }
            return
        }
        add("tip", "AR 팁", record.getJSONObject("tip"), Color.rgb(210, 45, 40))
        record.optJSONObject("cameraAtCapture")?.let { add("camera", "측정 당시 카메라", it, Color.rgb(35, 116, 225)) }
        record.optJSONObject("reference")?.let { add("reference", "비교 기준점", it, Color.rgb(20, 140, 70)) }
    }

    private fun updateSummary() {
        if (cloudMode) {
            val d = record.optJSONObject("discoveryLocation")
            summary.text = "Cloud 팁의 탐색 위치를 지도에서 선택하세요.\n" +
                "내 현재 위치 갱신으로 지도를 이동한 뒤, 실제 장소를 직접 확인해 터치하세요.\n" +
                (d?.let { "선택: %.7f, %.7f\n지도 선택 위치 · 정확도 미상 · AR 좌표는 유지".format(
                    it.getDouble("latitude"), it.getDouble("longitude")) }
                    ?: "아직 연결한 위치가 없습니다. 초기 지도 중심은 팁 위치가 아닙니다.")
            return
        }
        val tip = record.getJSONObject("tip")
        val a = record.getJSONObject("accuracy")
        val reference = record.optJSONObject("reference")
        val comparison = if (reference == null) "기준점 없음 — 지도 비교점 선택 또는 이전 화면에서 기준 좌표 입력"
            else "기준점과 수평거리(구면근사): %.2fm\n기준 출처: %s".format(distance(tip, reference), reference.optString("sourceLabel"))
        summary.text = "빨강: 팁 / 파랑: 측정 당시 카메라 / 초록: 기준점\n" +
            "팁: %.7f, %.7f\n추정 수평 정확도(68%%): %.2fm\n%s\n지도 비교만으로 기기 간 복원 성공을 판정하지 않습니다.".format(
                tip.getDouble("latitude"), tip.getDouble("longitude"), a.getDouble("horizontalMeters"), comparison)
    }

    private fun distance(a: JSONObject, b: JSONObject): Double {
        val lat1 = Math.toRadians(a.getDouble("latitude")); val lat2 = Math.toRadians(b.getDouble("latitude"))
        val dlat = lat2 - lat1; val dlon = Math.toRadians(b.getDouble("longitude") - a.getDouble("longitude"))
        val h = (sin(dlat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dlon / 2).pow(2)).coerceIn(0.0, 1.0)
        return 6371008.8 * 2 * atan2(sqrt(h), sqrt(1 - h))
    }
    override fun onResume() { super.onResume(); if (::view.isInitialized && started) view.resume() }
    override fun onPause() {
        locationRequest?.cancel(); locationRequest = null; currentLocation = null
        if (::locationStatus.isInitialized) {
            locationStatus.removeCallbacks(locationExpiry)
            locationStatus.text = "현재 위치: 다시 갱신하세요."
        }
        drawLabels()
        if (::view.isInitialized && started) view.pause()
        super.onPause()
    }
    override fun onDestroy() {
        if (::mapStatus.isInitialized) mapStatus.removeCallbacks(loadingTimeout)
        locationRequest?.cancel()
        if (::locationStatus.isInitialized) locationStatus.removeCallbacks(locationExpiry)
        if (::view.isInitialized && started) view.finish()
        super.onDestroy()
    }
}
