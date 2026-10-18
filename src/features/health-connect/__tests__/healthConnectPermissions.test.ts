/**
 * The Health Connect client must be initialised before *any* other call.
 *
 * Forgetting this made "Switch to Health Connect" fail on a cold start with a
 * generic "Permission needed" alert: both `requestPermission` and
 * `getGrantedPermissions` reject with `ClientNotInitialized`, and the rejection
 * was swallowed by the catch blocks. These tests pin the ordering so the
 * regression cannot come back.
 */

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  return actual;
});

jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(),
  requestPermission: jest.fn(),
  getGrantedPermissions: jest.fn(),
  getSdkStatus: jest.fn(),
  openHealthConnectSettings: jest.fn(),
  SdkAvailabilityStatus: {
    SDK_AVAILABLE: 3,
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
  },
}));

type HealthConnectMock = {
  initialize: jest.Mock;
  requestPermission: jest.Mock;
  getGrantedPermissions: jest.Mock;
};

type PermissionsModule = typeof import('../healthConnectPermissions');

/** Loads both modules from a fresh registry so the init cache starts empty. */
function load(): { permissions: PermissionsModule; connect: HealthConnectMock } {
  jest.resetModules();
  return {
    // A fresh registry — and therefore a fresh initialisation cache — needs a
    // synchronous require; dynamic import() is not usable here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    permissions: require('../healthConnectPermissions'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    connect: require('react-native-health-connect'),
  };
}

const WEIGHT_PERMISSIONS = [
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Weight' },
];

const ACTIVITY_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ExerciseSession' },
];

function grantWeight() {
  return [
    { accessType: 'read', recordType: 'Weight' },
    { accessType: 'write', recordType: 'Weight' },
  ];
}

function grantActivity() {
  return [
    { accessType: 'read', recordType: 'Steps' },
    { accessType: 'read', recordType: 'ExerciseSession' },
  ];
}

describe('Health Connect client initialisation', () => {
  it('initialises before requesting weight permissions', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValue(true);
    connect.requestPermission.mockResolvedValue([]);
    connect.getGrantedPermissions.mockResolvedValue(grantWeight());

    const result = await permissions.requestWeightPermissions();

    expect(connect.initialize).toHaveBeenCalledTimes(1);
    expect(connect.requestPermission).toHaveBeenCalledWith(WEIGHT_PERMISSIONS);
    expect(
      connect.initialize.mock.invocationCallOrder[0]
    ).toBeLessThan(connect.requestPermission.mock.invocationCallOrder[0]);
    expect(result).toEqual({ canRead: true, canWrite: true });
  });

  it('initialises before requesting activity permissions', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValue(true);
    connect.requestPermission.mockResolvedValue([]);
    connect.getGrantedPermissions.mockResolvedValue(grantActivity());

    const result = await permissions.requestActivityPermissions();

    expect(connect.initialize).toHaveBeenCalledTimes(1);
    expect(connect.requestPermission).toHaveBeenCalledWith(ACTIVITY_PERMISSIONS);
    expect(
      connect.initialize.mock.invocationCallOrder[0]
    ).toBeLessThan(connect.requestPermission.mock.invocationCallOrder[0]);
    expect(result).toEqual({ canReadSteps: true, canReadExercise: true });
  });

  it('initialises before reading the granted activity permissions', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValue(true);
    connect.getGrantedPermissions.mockResolvedValue(grantActivity());

    await permissions.getActivityPermissionState();

    expect(connect.initialize).toHaveBeenCalledTimes(1);
    expect(
      connect.initialize.mock.invocationCallOrder[0]
    ).toBeLessThan(connect.getGrantedPermissions.mock.invocationCallOrder[0]);
  });

  it('initialises at most once across repeated calls', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValue(true);
    connect.requestPermission.mockResolvedValue([]);
    connect.getGrantedPermissions.mockResolvedValue(grantWeight());

    await permissions.requestWeightPermissions();
    await permissions.getWeightPermissionState();
    await permissions.requestActivityPermissions();

    expect(connect.initialize).toHaveBeenCalledTimes(1);
  });

  it('reports no permissions and skips the dialog when initialisation fails', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValue(false);

    const result = await permissions.requestWeightPermissions();

    expect(result).toEqual(permissions.NO_PERMISSIONS);
    expect(connect.requestPermission).not.toHaveBeenCalled();
  });

  it('does not cache a failed initialisation, so a later retry can succeed', async () => {
    const { permissions, connect } = load();
    connect.initialize.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    connect.requestPermission.mockResolvedValue([]);
    connect.getGrantedPermissions.mockResolvedValue(grantWeight());

    const first = await permissions.requestWeightPermissions();
    const second = await permissions.requestWeightPermissions();

    expect(connect.initialize).toHaveBeenCalledTimes(2);
    expect(first).toEqual(permissions.NO_PERMISSIONS);
    expect(second).toEqual({ canRead: true, canWrite: true });
  });
});
