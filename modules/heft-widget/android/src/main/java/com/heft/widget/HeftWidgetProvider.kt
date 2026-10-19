package com.heft.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlin.concurrent.thread

/**
 * Home-screen widget entry point.
 *
 * All data is loaded off the main thread. Widget broadcasts are finished with
 * goAsync() so a quick-add still completes if the user leaves the home screen.
 */
class HeftWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_ADD -> {
        val pendingResult = goAsync()
        val volumeMl = intent.getIntExtra(EXTRA_ML, 0)
        thread(name = "heft-widget-add") {
          try {
            HeftWidgetData.addWater(context, volumeMl)
          } catch (error: Throwable) {
            Log.w(TAG, "Quick add failed", error)
          } finally {
            try {
              updateAll(context)
            } finally {
              pendingResult.finish()
            }
          }
        }
      }

      ACTION_REFRESH,
      AppWidgetManager.ACTION_APPWIDGET_UPDATE,
      AppWidgetManager.ACTION_APPWIDGET_OPTIONS_CHANGED,
      AppWidgetManager.ACTION_APPWIDGET_ENABLED -> {
        val pendingResult = goAsync()
        thread(name = "heft-widget-update") {
          try {
            updateAll(context)
          } catch (error: Throwable) {
            Log.w(TAG, "Widget update failed", error)
          } finally {
            pendingResult.finish()
          }
        }
      }

      else -> super.onReceive(context, intent)
    }
  }

  /** Used only if the platform delivers an update without going through onReceive. */
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    thread(name = "heft-widget-update") {
      updateAll(context)
    }
  }

  companion object {
    const val ACTION_ADD = "com.heft.widget.action.ADD"
    const val ACTION_REFRESH = "com.heft.widget.action.REFRESH"
    const val EXTRA_ML = "com.heft.widget.extra.ML"
    private const val TAG = "HeftWidget"

    /**
     * Repaints every placed widget. Called by the JavaScript bridge after the app
     * logs water or changes the goal/storage mode, so the home screen stays in
     * step without waiting for the periodic update.
     */
    fun refresh(context: Context) {
      context.sendBroadcast(
        Intent(context, HeftWidgetProvider::class.java).setAction(ACTION_REFRESH)
      )
    }

    private fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, HeftWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      if (ids.isEmpty()) return

      val state = HeftWidgetData.load(context)
      ids.forEach { id ->
        try {
          manager.updateAppWidget(id, HeftWidgetRenderer.render(context, id, state))
        } catch (error: Throwable) {
          Log.w(TAG, "Could not render widget $id", error)
        }
      }
    }
  }
}
