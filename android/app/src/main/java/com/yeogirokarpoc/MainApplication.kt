package com.yeogirokarpoc

import android.app.Application
import android.app.ActivityManager
import android.os.Build
import android.os.Process
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.viromedia.bridge.ReactViroPackage
import com.yeogirokarpoc.geo.GeoValidationPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(ReactViroPackage(ReactViroPackage.ViroPlatform.AR))
          add(GeoValidationPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Application is created in each process. The standalone AR activity must
    // not initialize React Native, Hermes or Viro in its private process.
    val processName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Application.getProcessName()
    } else {
      val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
      manager.runningAppProcesses?.firstOrNull { it.pid == Process.myPid() }?.processName
    }
    if (processName == "$packageName:geospatial") return
    loadReactNative(this)
  }
}
