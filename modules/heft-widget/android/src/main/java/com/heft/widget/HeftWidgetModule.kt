package com.heft.widget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Minimal bridge: the app calls refresh() after logging water, syncing, or
 * changing the goal/storage mode. Failed calls are ignored on the JS side, so a
 * JavaScript bundle running on an APK without the widget stays safe.
 */
class HeftWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HeftWidget")

    Function("refresh") {
      appContext.reactContext?.let { context ->
        HeftWidgetProvider.refresh(context)
      }
    }
  }
}
