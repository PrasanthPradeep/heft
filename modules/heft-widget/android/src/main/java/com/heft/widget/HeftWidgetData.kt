package com.heft.widget

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Volume
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

internal enum class WidgetMode { SETUP, LOCAL, HEALTH_CONNECT }

internal data class HydrationState(
  val totalMl: Double,
  val goalMl: Double,
  val mode: WidgetMode,
  /** False when the widget cannot safely create a record (setup incomplete or no read access). */
  val canAdd: Boolean,
  val pendingCount: Int,
  /** Human-readable problem, or null when the state is normal. */
  val status: String?,
)

/**
 * Reads and writes exactly the same data the app uses:
 *
 * - local-only mode: `water_entries` in the expo-sqlite database;
 * - Health Connect mode: Health Connect (authoritative) plus the app's own
 *   `pending_water` queue for entries that have not been uploaded yet.
 *
 * It deliberately never falls back to local history in Health Connect mode.
 */
internal object HeftWidgetData {
  private const val TAG = "HeftWidget"
  private const val DB_NAME = "heft.db"
  private const val PREFERENCES_KEY = "app.preferences"
  private const val STORAGE_HEALTH_CONNECT = "health-connect"
  private const val STORAGE_LOCAL = "local"
  private const val DEFAULT_GOAL_ML = 2000
  private const val MIN_GOAL_ML = 500
  private const val MAX_GOAL_ML = 5000
  private const val MAX_VOLUME_ML = 10_000

  private val isoFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

  fun load(context: Context): HydrationState {
    val preferences = readPreferences(context)
      ?: return HydrationState(
        totalMl = 0.0,
        goalMl = DEFAULT_GOAL_ML.toDouble(),
        mode = WidgetMode.SETUP,
        canAdd = false,
        pendingCount = 0,
        status = context.getString(R.string.heft_widget_status_setup),
      )

    val (startIso, endIso) = todayRangeIso()
    return when (preferences.storageMode) {
      STORAGE_HEALTH_CONNECT -> loadHealthConnect(context, preferences, startIso, endIso)
      else -> loadLocal(context, preferences, startIso, endIso)
    }
  }

  /** Creates exactly one record, using the mode the app is configured for. */
  fun addWater(context: Context, volumeMl: Int) {
    if (volumeMl !in 1..MAX_VOLUME_ML) return
    val preferences = readPreferences(context) ?: return

    if (preferences.storageMode == STORAGE_HEALTH_CONNECT) {
      addHealthConnectWater(context, volumeMl.toDouble())
    } else {
      addLocalWater(context, volumeMl.toDouble())
    }
  }

  private fun loadLocal(
    context: Context,
    preferences: WidgetPreferences,
    startIso: String,
    endIso: String,
  ): HydrationState {
    val total = withDatabase(context) { db ->
      sumVolume(db, "water_entries", startIso, endIso)
    }

    return if (total == null) {
      HydrationState(
        totalMl = 0.0,
        goalMl = preferences.goalMl,
        mode = WidgetMode.LOCAL,
        canAdd = false,
        pendingCount = 0,
        status = context.getString(R.string.heft_widget_status_error),
      )
    } else {
      HydrationState(
        totalMl = total,
        goalMl = preferences.goalMl,
        mode = WidgetMode.LOCAL,
        canAdd = true,
        pendingCount = 0,
        status = null,
      )
    }
  }

  private fun loadHealthConnect(
    context: Context,
    preferences: WidgetPreferences,
    startIso: String,
    endIso: String,
  ): HydrationState {
    val pending = withDatabase(context) { db ->
      PendingWater(
        volumeMl = sumVolume(db, "pending_water", startIso, endIso),
        count = countRows(db, "pending_water", startIso, endIso),
      )
    } ?: PendingWater(0.0, 0)

    val client = try {
      HealthConnectClient.getOrCreate(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Health Connect client unavailable", error)
      null
    }

    if (client == null) {
      return HydrationState(
        totalMl = pending.volumeMl,
        goalMl = preferences.goalMl,
        mode = WidgetMode.HEALTH_CONNECT,
        canAdd = false,
        pendingCount = pending.count,
        status = context.getString(R.string.heft_widget_status_unavailable),
      )
    }

    return try {
      runBlocking {
        val granted = client.permissionController.getGrantedPermissions()
        val canRead = granted.contains(
          HealthPermission.getReadPermission(HydrationRecord::class)
        )
        val canWrite = granted.contains(
          HealthPermission.getWritePermission(HydrationRecord::class)
        )

        if (!canRead) {
          // Without read access the widget cannot show the record it would write,
          // so it offers to connect instead of writing invisibly.
          return@runBlocking HydrationState(
            totalMl = pending.volumeMl,
            goalMl = preferences.goalMl,
            mode = WidgetMode.HEALTH_CONNECT,
            canAdd = false,
            pendingCount = pending.count,
            status = context.getString(R.string.heft_widget_status_connect),
          )
        }

        val start = Instant.parse(startIso)
        val end = Instant.parse(endIso)
        var total = pending.volumeMl
        var pageToken: String? = null
        var pages = 0

        do {
          val response = client.readRecords(
            ReadRecordsRequest(
              recordType = HydrationRecord::class,
              timeRangeFilter = TimeRangeFilter.between(start, end),
              pageSize = 1000,
              pageToken = pageToken,
            )
          )
          total += response.records.sumOf { it.volume.inMilliliters }
          pageToken = response.pageToken
          pages += 1
        } while (!pageToken.isNullOrEmpty() && pages < 20)

        HydrationState(
          totalMl = total,
          goalMl = preferences.goalMl,
          mode = WidgetMode.HEALTH_CONNECT,
          // With read but no write access the entry is queued locally, exactly
          // like the app does, and shows up in the total immediately.
          canAdd = true,
          pendingCount = pending.count,
          status = if (canWrite) null else context.getString(R.string.heft_widget_status_read_only),
        )
      }
    } catch (error: Throwable) {
      Log.w(TAG, "Health Connect read failed", error)
      HydrationState(
        totalMl = pending.volumeMl,
        goalMl = preferences.goalMl,
        mode = WidgetMode.HEALTH_CONNECT,
        canAdd = false,
        pendingCount = pending.count,
        status = context.getString(
          if (isPermissionFailure(error)) {
            R.string.heft_widget_status_connect
          } else {
            R.string.heft_widget_status_unavailable
          },
        ),
      )
    }
  }

  /** Some devices report a granted permission and still reject the read. */
  private fun isPermissionFailure(error: Throwable): Boolean {
    var current: Throwable? = error
    var depth = 0
    while (current != null && depth < 6) {
      if (current is SecurityException) return true
      if (current.message?.contains("permission", ignoreCase = true) == true) return true
      current = current.cause
      depth += 1
    }
    return false
  }

  private fun addLocalWater(context: Context, volumeMl: Double) {
    val now = isoNow()
    val id = UUID.randomUUID().toString()
    val inserted = withDatabase(context) { db ->
      db.execSQL(
        """
        INSERT INTO water_entries (id, volume_ml, logged_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """.trimIndent(),
        arrayOf<Any>(id, volumeMl, now, now, now),
      )
      true
    }

    if (inserted != true) {
      Log.w(TAG, "Could not store water locally")
    }
  }

  private fun addHealthConnectWater(context: Context, volumeMl: Double) {
    val client = try {
      HealthConnectClient.getOrCreate(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Health Connect client unavailable", error)
      null
    }

    if (client == null) {
      queuePending(context, volumeMl)
      return
    }

    try {
      val granted = runBlocking { client.permissionController.getGrantedPermissions() }
      val canRead = granted.contains(
        HealthPermission.getReadPermission(HydrationRecord::class)
      )
      val canWrite = granted.contains(
        HealthPermission.getWritePermission(HydrationRecord::class)
      )

      if (!canRead) {
        Log.w(TAG, "Ignoring quick add without Health Connect read access")
        return
      }
      if (!canWrite) {
        queuePending(context, volumeMl)
        return
      }

      val start = Instant.now()
      val clientRecordId = UUID.randomUUID().toString()
      // Health Connect rejects zero-length intervals, so every entry is one second
      // long. This mirrors hydrationInterval() in the JavaScript adapter.
      val record = HydrationRecord(
        startTime = start,
        startZoneOffset = null,
        endTime = start.plusSeconds(1),
        endZoneOffset = null,
        volume = Volume.milliliters(volumeMl),
        metadata = Metadata.manualEntry(clientRecordId, 0L),
      )

      val response = runBlocking { client.insertRecords(listOf(record)) }
      val externalId = response.recordIdsList.firstOrNull()
      if (externalId != null) {
        // Keep the same disposable mirror the app maintains, so the dashboard
        // shows the entry immediately when it next gains focus.
        cacheWrittenRecord(context, externalId, clientRecordId, volumeMl, start)
      }
    } catch (error: Throwable) {
      Log.w(TAG, "Health Connect write failed; keeping the entry locally", error)
      queuePending(context, volumeMl)
    }
  }

  private fun cacheWrittenRecord(
    context: Context,
    externalId: String,
    clientRecordId: String,
    volumeMl: Double,
    loggedAt: Instant,
  ) {
    val now = isoNow()
    withDatabase(context) { db ->
      db.execSQL(
        """
        INSERT OR REPLACE INTO water_cache
          (external_id, client_record_id, volume_ml, logged_at, source_package, recording_method, updated_at)
        VALUES (?, ?, ?, ?, NULL, NULL, ?)
        """.trimIndent(),
        arrayOf<Any>(externalId, clientRecordId, volumeMl, formatIso(loggedAt), now),
      )
    }
  }

  private fun queuePending(context: Context, volumeMl: Double) {
    val now = isoNow()
    val id = UUID.randomUUID().toString()
    val inserted = withDatabase(context) { db ->
      db.execSQL(
        """
        INSERT INTO pending_water (id, volume_ml, logged_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """.trimIndent(),
        arrayOf<Any>(id, volumeMl, now, now, now),
      )
      true
    }

    if (inserted != true) {
      Log.w(TAG, "Could not queue water locally")
    }
  }

  private data class WidgetPreferences(val storageMode: String, val goalMl: Double)

  private data class PendingWater(val volumeMl: Double, val count: Int)

  private fun readPreferences(context: Context): WidgetPreferences? {
    val raw = withDatabase(context) { db ->
      db.rawQuery(
        "SELECT value FROM preferences WHERE key = ?",
        arrayOf(PREFERENCES_KEY),
      ).use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } ?: return null

    val json = try {
      JSONObject(raw)
    } catch (error: Throwable) {
      Log.w(TAG, "Could not parse preferences", error)
      return null
    }

    val storageMode = json.optString("storageMode", "")
    if (storageMode != STORAGE_HEALTH_CONNECT && storageMode != STORAGE_LOCAL) {
      return null
    }

    val goalMl = json
      .optInt("waterTargetMl", DEFAULT_GOAL_ML)
      .coerceIn(MIN_GOAL_ML, MAX_GOAL_ML)
      .toDouble()

    return WidgetPreferences(storageMode, goalMl)
  }

  private fun databaseFile(context: Context): File =
    File(File(context.filesDir, "SQLite"), DB_NAME)

  /**
   * Opens the app database with a short retry so a concurrent app write does not
   * leave the widget blank. The file is only opened when it already exists: the
   * widget must never create an empty database without the app's schema.
   */
  private fun <T> withDatabase(context: Context, block: (SQLiteDatabase) -> T): T? {
    val file = databaseFile(context)
    if (!file.exists()) return null

    var lastError: Throwable? = null
    repeat(3) { attempt ->
      var database: SQLiteDatabase? = null
      try {
        database = SQLiteDatabase.openDatabase(
          file.path,
          null,
          SQLiteDatabase.OPEN_READWRITE,
        )
        return block(database)
      } catch (error: Throwable) {
        lastError = error
        if (attempt < 2) {
          try {
            Thread.sleep(120L * (attempt + 1))
          } catch (_: InterruptedException) {
            return null
          }
        }
      } finally {
        try {
          database?.close()
        } catch (_: Throwable) {
          // Closing a failed connection must not mask the real result.
        }
      }
    }

    Log.w(TAG, "Database access failed", lastError)
    return null
  }

  private fun sumVolume(
    db: SQLiteDatabase,
    table: String,
    startIso: String,
    endIso: String,
  ): Double = db.rawQuery(
    "SELECT COALESCE(SUM(volume_ml), 0) FROM $table WHERE logged_at >= ? AND logged_at < ?",
    arrayOf(startIso, endIso),
  ).use { cursor ->
    if (cursor.moveToFirst()) cursor.getDouble(0) else 0.0
  }

  private fun countRows(
    db: SQLiteDatabase,
    table: String,
    startIso: String,
    endIso: String,
  ): Int = db.rawQuery(
    "SELECT COUNT(*) FROM $table WHERE logged_at >= ? AND logged_at < ?",
    arrayOf(startIso, endIso),
  ).use { cursor ->
    if (cursor.moveToFirst()) cursor.getInt(0) else 0
  }

  private fun todayRangeIso(): Pair<String, String> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val start = today.atStartOfDay(zone).toInstant()
    val end = today.plusDays(1).atStartOfDay(zone).toInstant()
    return formatIso(start) to formatIso(end)
  }

  private fun formatIso(instant: Instant): String = isoFormatter.format(instant)

  private fun isoNow(): String = formatIso(Instant.now())
}
