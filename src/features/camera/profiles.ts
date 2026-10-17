import type { ScaleProfile } from './parser';

/**
 * Display resolutions differ between scales, so each profile carries its own
 * graduation. Do not apply the Flora Sports' 0.05 kg setting to every scale.
 */
export const SCALE_PROFILES: ScaleProfile[] = [
  {
    id: 'ant-flora',
    name: 'Ant Flora Sports (0.05 kg)',
    minKg: 5,
    maxKg: 180,
    graduationKg: 0.05,
  },
  {
    id: 'standard-0-1',
    name: 'Standard scale (0.1 kg)',
    minKg: 2,
    maxKg: 200,
    graduationKg: 0.1,
  },
  {
    id: 'precision-0-01',
    name: 'Precision scale (0.01 kg)',
    minKg: 0.2,
    maxKg: 180,
    graduationKg: 0.01,
  },
  {
    id: 'basic-1',
    name: 'Basic scale (1 kg)',
    minKg: 1,
    maxKg: 200,
    graduationKg: 1,
  },
];

export const DEFAULT_SCALE_PROFILE_ID = 'ant-flora';

export function getScaleProfile(id: string | null | undefined): ScaleProfile {
  return (
    SCALE_PROFILES.find((profile) => profile.id === id) ?? SCALE_PROFILES[0]
  );
}
