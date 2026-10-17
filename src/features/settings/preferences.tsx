import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_SCALE_PROFILE_ID,
  getScaleProfile,
  SCALE_PROFILES,
} from '../camera/profiles';
import type { ScaleProfile } from '../camera/parser';

const STORAGE_KEY = 'heft.scaleProfileId';

type PreferencesContextValue = {
  ready: boolean;
  profile: ScaleProfile;
  profileId: string;
  profiles: ScaleProfile[];
  setProfileId: (id: string) => Promise<void>;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profileId, setProfileIdState] = useState(DEFAULT_SCALE_PROFILE_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (active && stored) {
          setProfileIdState(stored);
        }
      })
      .catch(() => {
        // Fall back to the default profile.
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const setProfileId = useCallback(async (id: string) => {
    setProfileIdState(id);
    await AsyncStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      ready,
      profile: getScaleProfile(profileId),
      profileId,
      profiles: SCALE_PROFILES,
      setProfileId,
    }),
    [ready, profileId, setProfileId]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences must be used within a PreferencesProvider.');
  }
  return value;
}
