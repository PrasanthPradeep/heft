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

/** Only the access Heft actually uses: read + write body weight. */
export const WEIGHT_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Weight' },
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

/**
 * Reads the currently granted weight permissions. Permissions can be revoked at
 * any time, so callers must re-check before every read or write.
 */
export async function getWeightPermissionState(): Promise<WeightPermissionState> {
  if (Platform.OS !== 'android') return NO_PERMISSIONS;

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
  if (Platform.OS !== 'android') return NO_PERMISSIONS;

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
  if (Platform.OS !== 'android') return NO_ACTIVITY_PERMISSIONS;

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
  if (Platform.OS !== 'android') return NO_ACTIVITY_PERMISSIONS;

  try {
    await requestPermission(ACTIVITY_PERMISSIONS);
  } catch {
    // Fall through and report whatever was actually granted.
  }

  return getActivityPermissionState();
}

export { openHealthConnectSettings };
