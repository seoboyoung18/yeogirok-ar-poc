package com.yeogirokarpoc.geo

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.widget.*
import org.json.JSONObject

/** Remains in the AR Activity: closing content does not recreate the AR session. */
object TipDetailSheet {
    fun show(activity: Activity, tip: JSONObject): Dialog {
        fun dp(n: Int) = (n * activity.resources.displayMetrics.density).toInt()
        val dialog = Dialog(activity)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(12), dp(24), dp(24))
            background = GradientDrawable().apply { setColor(Color.rgb(255, 252, 247)); cornerRadius = dp(24).toFloat() }
        }
        fun label(value: String, size: Float, color: Int) = TextView(activity).apply {
            text = value; textSize = size; setTextColor(color); setPadding(0, dp(8), 0, dp(8))
        }
        column.addView(label("내가 남긴 팁 · 기기 내 미리보기", 12f, Color.rgb(139, 83, 54)))
        column.addView(label(tip.getString("title"), 24f, Color.rgb(41, 42, 38)))
        val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        if (!tip.isNull("photoName")) {
            val file = LocalTipStore.photoFile(activity, tip.getString("photoName"))
            if (file.isFile) content.addView(ImageView(activity).apply {
                contentDescription = "작성자가 첨부한 팁 사진"
                adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER
                setImageURI(Uri.fromFile(file))
            }, LinearLayout.LayoutParams(-1, -2))
            else content.addView(label("사진 파일을 찾을 수 없어요.", 14f, Color.DKGRAY))
        }
        content.addView(label(tip.getString("body"), 17f, Color.rgb(55, 57, 51)).apply {
            setLineSpacing(dp(5).toFloat(), 1f); setTextIsSelectable(true)
        })
        column.addView(ScrollView(activity).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        column.addView(Button(activity).apply {
            text = "AR로 돌아가기"; setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(224, 85, 43))
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(-1, dp(56)))
        dialog.setContentView(column)
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setGravity(Gravity.BOTTOM)
            setLayout(-1, (activity.resources.displayMetrics.heightPixels * 0.78f).toInt())
        }
        return dialog
    }
}
