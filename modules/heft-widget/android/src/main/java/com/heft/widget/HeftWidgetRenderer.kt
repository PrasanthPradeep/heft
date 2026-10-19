package com.heft.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

/** Builds the 4x1, 4x2 and 4x3 RemoteViews for one hydration snapshot. */
internal object HeftWidgetRenderer {
  private const val MEDIUM_HEIGHT_DP = 90
  private const val LARGE_HEIGHT_DP = 160

  fun render(context: Context, appWidgetId: Int, state: HydrationState): RemoteViews {
    val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId)
    val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
      .takeIf { it > 0 } ?: 250
    val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
      .takeIf { it > 0 } ?: 120

    val layout = when {
      width < 220 -> R.layout.heft_widget_small
      height < MEDIUM_HEIGHT_DP -> R.layout.heft_widget_small
      height < LARGE_HEIGHT_DP -> R.layout.heft_widget_medium
      else -> R.layout.heft_widget_large
    }

    return build(context, layout, state)
  }

  private fun build(context: Context, layoutRes: Int, state: HydrationState): RemoteViews {
    val views = RemoteViews(context.packageName, layoutRes)
    val total = state.totalMl.coerceAtLeast(0.0)
    val goal = state.goalMl.coerceAtLeast(1.0)
    val ratio = (total / goal).coerceIn(0.0, 1.0)
    val percent = formatPercent(ratio)
    val openIntent = openApp(context)

    views.setTextViewText(R.id.heft_widget_total, formatMillilitres(total))
    views.setProgressBar(
      R.id.heft_widget_progress,
      1000,
      (ratio * 1000).roundToInt(),
      false,
    )

    if (openIntent != null) {
      views.setOnClickPendingIntent(R.id.heft_widget_root, openIntent)
      views.setContentDescription(
        R.id.heft_widget_root,
        context.getString(
          R.string.heft_widget_accessibility,
          formatMillilitres(total),
          formatMillilitres(goal),
        ),
      )
    }

    when (layoutRes) {
      R.layout.heft_widget_small -> bindSmall(context, views, state, goal, openIntent)
      R.layout.heft_widget_medium -> bindMedium(context, views, state, goal, percent, openIntent)
      else -> bindLarge(context, views, state, goal, percent, openIntent)
    }

    return views
  }

  private fun bindSmall(
    context: Context,
    views: RemoteViews,
    state: HydrationState,
    goal: Double,
    openIntent: PendingIntent?,
  ) {
    val subtitle = state.status
      ?: pendingText(context, state)
      ?: context.getString(R.string.heft_widget_goal_today, formatMillilitres(goal))
    views.setTextViewText(R.id.heft_widget_goal, subtitle)

    // A single tap on the plus logs the middle preset (250 ml); the rest of the
    // tile opens the app.
    bindAdd(context, views, R.id.heft_widget_plus, 250, state.canAdd, openIntent)
  }

  private fun bindMedium(
    context: Context,
    views: RemoteViews,
    state: HydrationState,
    goal: Double,
    percent: String,
    openIntent: PendingIntent?,
  ) {
    views.setTextViewText(
      R.id.heft_widget_goal,
      context.getString(R.string.heft_widget_goal_slash, formatMillilitres(goal)),
    )

    val badge = state.status
      ?: pendingText(context, state)
      ?: percent
    views.setTextViewText(R.id.heft_widget_badge, badge)

    bindAdd(context, views, R.id.heft_widget_add_150, 150, state.canAdd, openIntent)
    bindAdd(context, views, R.id.heft_widget_add_250, 250, state.canAdd, openIntent)
    bindAdd(context, views, R.id.heft_widget_add_500, 500, state.canAdd, openIntent)
  }

  private fun bindLarge(
    context: Context,
    views: RemoteViews,
    state: HydrationState,
    goal: Double,
    percent: String,
    openIntent: PendingIntent?,
  ) {
    views.setTextViewText(
      R.id.heft_widget_goal,
      context.getString(R.string.heft_widget_goal_of, formatMillilitres(goal)),
    )

    val subtitle = listOfNotNull(state.status, pendingText(context, state))
      .joinToString(" · ")
      .ifEmpty { context.getString(R.string.heft_widget_subtitle) }
    views.setTextViewText(R.id.heft_widget_subtitle, subtitle)

    views.setTextViewText(
      R.id.heft_widget_percent,
      context.getString(R.string.heft_widget_percent_completed, percent),
    )

    val remaining = (state.goalMl - state.totalMl).coerceAtLeast(0.0)
    views.setTextViewText(
      R.id.heft_widget_remaining,
      if (remaining <= 0.0) {
        context.getString(R.string.heft_widget_goal_reached)
      } else {
        context.getString(R.string.heft_widget_remaining, formatMillilitres(remaining))
      },
    )

    if (openIntent != null) {
      views.setOnClickPendingIntent(R.id.heft_widget_dots, openIntent)
    }

    bindAdd(context, views, R.id.heft_widget_add_150, 150, state.canAdd, openIntent)
    bindAdd(context, views, R.id.heft_widget_add_250, 250, state.canAdd, openIntent)
    bindAdd(context, views, R.id.heft_widget_add_500, 500, state.canAdd, openIntent)
  }

  private fun bindAdd(
    context: Context,
    views: RemoteViews,
    viewId: Int,
    volumeMl: Int,
    enabled: Boolean,
    openIntent: PendingIntent?,
  ) {
    if (enabled) {
      views.setOnClickPendingIntent(viewId, addPendingIntent(context, volumeMl))
      views.setContentDescription(
        viewId,
        context.getString(R.string.heft_widget_add_description, volumeMl),
      )
      views.setFloat(viewId, "setAlpha", 1f)
    } else {
      // Setup or Health Connect read access is missing: a tap opens Heft instead
      // of writing a record the widget could not display.
      views.setOnClickPendingIntent(viewId, openIntent)
      views.setContentDescription(
        viewId,
        context.getString(R.string.heft_widget_open_description),
      )
      views.setFloat(viewId, "setAlpha", 0.4f)
    }
  }

  private fun pendingText(context: Context, state: HydrationState): String? =
    state.pendingCount.takeIf { it > 0 }?.let {
      context.getString(R.string.heft_widget_status_waiting, it)
    }

  private fun addPendingIntent(context: Context, volumeMl: Int): PendingIntent {
    val intent = Intent(context, HeftWidgetProvider::class.java)
      .setAction(HeftWidgetProvider.ACTION_ADD)
      .putExtra(HeftWidgetProvider.EXTRA_ML, volumeMl)

    return PendingIntent.getBroadcast(
      context,
      volumeMl,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun openApp(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null

    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
      Intent.FLAG_ACTIVITY_CLEAR_TOP or
      Intent.FLAG_ACTIVITY_SINGLE_TOP

    return PendingIntent.getActivity(
      context,
      100,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun formatMillilitres(volumeMl: Double): String {
    val millilitres = volumeMl.roundToInt().coerceAtLeast(0)
    return "${NumberFormat.getIntegerInstance(Locale.US).format(millilitres)} ml"
  }

  private fun formatPercent(fraction: Double): String {
    val format = NumberFormat.getPercentInstance(Locale.US)
    format.maximumFractionDigits = 1
    return format.format(fraction.coerceIn(0.0, 1.0))
  }
}
