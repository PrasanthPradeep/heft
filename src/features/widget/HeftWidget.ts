import { requireOptionalNativeModule } from 'expo-modules-core';

type HeftWidgetNativeModule = {
  refresh(): void;
};

let nativeModule: HeftWidgetNativeModule | null | undefined;

function getNativeModule(): HeftWidgetNativeModule | null {
  if (nativeModule !== undefined) return nativeModule;

  try {
    nativeModule = requireOptionalNativeModule<HeftWidgetNativeModule>('HeftWidget');
  } catch {
    nativeModule = null;
  }

  return nativeModule;
}

/**
 * Repaints the Android home-screen widget after water or settings change.
 *
 * The widget is native-only: a JS bundle delivered by OTA to an APK built before
 * the widget existed has no native module, and every call here must stay a
 * harmless no-op so logging water never fails.
 */
export function refreshHydrationWidget(): void {
  try {
    getNativeModule()?.refresh();
  } catch {
    // Never let a widget repaint break a save or a settings change.
    return;
  }
}
