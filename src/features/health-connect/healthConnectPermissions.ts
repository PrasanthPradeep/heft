import { Platform } from 'react-native';
import {
  SdkAvailabilityStatus,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  requestPermission,
  type Permission,
} from 'react-native-health-connect';

/** Only the access Heft actually uses: weight, height, and full history. */
type ReadHealthDataHistoryPermission = {
  accessType: 'read';
  recordType: 'ReadHealthDataHistory';
};

type HealthConnectPermissionRequest =
  | Permission
  | ReadHealthDataHistoryPermission;

export const WEIGHT_PERMISSIONS: HealthConnectPermissionRequest[] = [
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Weight' },
  // Height feeds BMI. It is requested alongside weight so the BMI section can
  // fill itself in without a separate permission dialog.
  { accessType: 'read', recordType: 'Height' },
  // Without this, Health Connect only exposes roughly the last 30 days.
  { accessType: 'read', recordType: 'ReadHealthDataHistory' },
];

/**
 * Read-only activity access. Google Fit (and other fitness apps) sync their data
 * into Health Connect, so this is how Heft reads "Google Fit" steps and workouts
 * without using the deprecated Google Fit APIs.
 */
export const ACTIVITY_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ExerciseSession' },
];

/**
 * Hydration is optional and independent of the weight sync. Read access imports
 * water logged by other apps; write access puts Heft's own entries into Health
 * Connect. Both are requested only when the user connects water from Settings.
 */
export const HYDRATION_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'Hydration' },
  { accessType: 'write', recordType: 'Hydration' },
];

/**
 * Everything Heft may read or write, requested in one dialog. Users connect
 * once and can still allow or deny each data type in the Health Connect sheet.
 */
export const ALL_HEALTH_PERMISSIONS: HealthConnectPermissionRequest[] = [
  ...WEIGHT_PERMISSIONS,
  ...ACTIVITY_PERMISSIONS,
  ...HYDRATION_PERMISSIONS,
];

export type HealthConnectStatus =
  | 'available'
  | 'update-required'
  | 'unavailable'
  | 'unsupported-platform';

export type WeightPermissionState = {
  canRead: boolean;
  canWrite: boolean;
};

export const NO_PERMISSIONS: WeightPermissionState = {
  canRead: false,
  canWrite: false,
};

/** Reports whether Health Connect can be used at all on this device. */
export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  if (Platform.OS !== 'android') return 'unsupported-platform';

  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return 'update-required';
    }
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function isHealthConnectAvailable(): Promise<boolean> {
  return (await getHealthConnectStatus()) === 'available';
}

/** Initialises the SDK. Safe to call repeatedly; returns false on any failure. */
export async function initializeHealthConnect(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await initialize();
  } catch {
    return false;
  }
}

/** Remembers a successful initialisation so the native call happens at most once. */
let initialized = false;

/**
 * Initialises the Health Connect client if it is not ready yet.
 *
 * Every Health Connect operation — including `requestPermission` and
 * `getGrantedPermissions` — fails with `ClientNotInitialized` until this has
 * succeeded, and the client is per-process. Routing every call through this
 * guard means no caller can forget it.
 *
 * A failed attempt is not cached, so the next call retries; that keeps the
 * "Health Connect installed later" case working.
 */
export async function ensureHealthConnectReady(): Promise<boolean> {
  if (initialized) return true;
  const ready = await initializeHealthConnect();
  if (ready) initialized = true;
  return ready;
}

/**
 * Reads the currently granted weight permissions. Permissions can be revoked at
 * any time, so callers must re-check before every read or write.
 */
export async function getWeightPermissionState(): Promise<WeightPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_PERMISSIONS;

  try {
    const granted = await getGrantedPermissions();
    return {
      canRead: granted.some(
        (permission) =>
          permission.accessType === 'read' && permission.recordType === 'Weight'
      ),
      canWrite: granted.some(
        (permission) =>
          permission.accessType === 'write' && permission.recordType === 'Weight'
      ),
    };
  } catch {
    return NO_PERMISSIONS;
  }
}

/**
 * Shows the Health Connect permission dialog, then re-reads the granted state.
 * The returned state reflects what the user actually allowed.
 */
export async function requestWeightPermissions(): Promise<WeightPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_PERMISSIONS;

  try {
    await requestPermission(WEIGHT_PERMISSIONS);
  } catch {
    // A failure here still leaves us able to report the granted set below.
  }

  return getWeightPermissionState();
}

export type ActivityPermissionState = {
  canReadSteps: boolean;
  canReadExercise: boolean;
};

export const NO_ACTIVITY_PERMISSIONS: ActivityPermissionState = {
  canReadSteps: false,
  canReadExercise: false,
};

export function hasActivityAccess(state: ActivityPermissionState): boolean {
  return state.canReadSteps || state.canReadExercise;
}

/** Reads the currently granted activity permissions (steps + exercise). */
export async function getActivityPermissionState(): Promise<ActivityPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_ACTIVITY_PERMISSIONS;

  try {
    const granted = await getGrantedPermissions();
    const canRead = (recordType: Permission['recordType']) =>
      granted.some(
        (permission) =>
          permission.accessType === 'read' && permission.recordType === recordType
      );
    return {
      canReadSteps: canRead('Steps'),
      canReadExercise: canRead('ExerciseSession'),
    };
  } catch {
    return NO_ACTIVITY_PERMISSIONS;
  }
}

/**
 * Requests read access to steps and exercise. Called only when the user opts in
 * from Settings, so onboarding never asks for more than body weight.
 */
export async function requestActivityPermissions(): Promise<ActivityPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_ACTIVITY_PERMISSIONS;

  try {
    await requestPermission(ACTIVITY_PERMISSIONS);
  } catch {
    // Fall through and report whatever was actually granted.
  }

  return getActivityPermissionState();
}

export type HydrationPermissionState = {
  canRead: boolean;
  canWrite: boolean;
};

export const NO_HYDRATION_PERMISSIONS: HydrationPermissionState = {
  canRead: false,
  canWrite: false,
};

export function hasHydrationAccess(state: HydrationPermissionState): boolean {
  return state.canRead || state.canWrite;
}

/** Reads the currently granted hydration permissions. */
export async function getHydrationPermissionState(): Promise<HydrationPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_HYDRATION_PERMISSIONS;

  try {
    const granted = await getGrantedPermissions();
    const has = (accessType: 'read' | 'write') =>
      granted.some(
        (permission) =>
          permission.accessType === accessType &&
          permission.recordType === 'Hydration'
      );
    return { canRead: has('read'), canWrite: has('write') };
  } catch {
    return NO_HYDRATION_PERMISSIONS;
  }
}

/**
 * Requests hydration access. Called only when the user connects water from
 * Settings, so the rest of the app never asks for it implicitly.
 */
export async function requestHydrationPermissions(): Promise<HydrationPermissionState> {
  if (!(await ensureHealthConnectReady())) return NO_HYDRATION_PERMISSIONS;

  try {
    await requestPermission(HYDRATION_PERMISSIONS);
  } catch {
    // Fall through and report whatever was actually granted.
  }

  return getHydrationPermissionState();
}

export type HealthAccessState = {
  weight: WeightPermissionState;
  activity: ActivityPermissionState;
  hydration: HydrationPermissionState;
  canReadHeight: boolean;
};

export const NO_HEALTH_ACCESS: HealthAccessState = {
  weight: NO_PERMISSIONS,
  activity: NO_ACTIVITY_PERMISSIONS,
  hydration: NO_HYDRATION_PERMISSIONS,
  canReadHeight: false,
};

/** One snapshot of every record permission Heft uses. */
export async function getAllPermissionState(): Promise<HealthAccessState> {
  if (!(await ensureHealthConnectReady())) return NO_HEALTH_ACCESS;

  try {
    const granted = await getGrantedPermissions();
    const has = (
      accessType: 'read' | 'write',
      recordType: Permission['recordType']
    ) =>
      granted.some(
        (permission) =>
          permission.accessType === accessType &&
          permission.recordType === recordType
      );

    return {
      weight: {
        canRead: has('read', 'Weight'),
        canWrite: has('write', 'Weight'),
      },
      activity: {
        canReadSteps: has('read', 'Steps'),
        canReadExercise: has('read', 'ExerciseSession'),
      },
      hydration: {
        canRead: has('read', 'Hydration'),
        canWrite: has('write', 'Hydration'),
      },
      canReadHeight: has('read', 'Height'),
    };
  } catch {
    return NO_HEALTH_ACCESS;
  }
}

/**
 * Requests everything in one Health Connect dialog. The full-history permission
 * is part of the same request; the provider's granted-permissions list does not
 * report it separately.
 */
export async function requestAllHealthPermissions(): Promise<HealthAccessState> {
  if (!(await ensureHealthConnectReady())) return NO_HEALTH_ACCESS;

  try {
    await requestPermission(ALL_HEALTH_PERMISSIONS);
  } catch {
    // Fall through and report whatever was actually granted.
  }

  return getAllPermissionState();
}

export { openHealthConnectSettings };
