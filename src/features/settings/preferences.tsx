import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { loadPreferences, persistPreferences } from './preferenceStore';
import { DEFAULT_PREFERENCES, type AppPreferences } from './types';

type PreferencesContextValue = {
  /** False until persisted preferences have been read. */
  ready: boolean;
  preferences: AppPreferences;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<void>;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  // A ref mirrors the latest values so updates never read a stale closure.
  const preferencesRef = useRef<AppPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    let active = true;

    loadPreferences()
      .then((loaded) => {
        if (!active) return;
        preferencesRef.current = loaded;
        setPreferences(loaded);
      })
      .catch(() => {
        // Keep defaults; the app is still usable.
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const updatePreferences = useCallback(
    async (patch: Partial<AppPreferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
      await persistPreferences(next);
    },
    []
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ ready, preferences, updatePreferences }),
    [ready, preferences, updatePreferences]
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
