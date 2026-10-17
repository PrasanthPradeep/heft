import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { isOcrSupported, recognizeWeight } from '@/features/camera/WeightOcr';
import { usePreferences } from '@/features/settings/preferences';

export default function ScanScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const { profile } = usePreferences();

  if (!permission) {
    return <ActivityIndicator style={styles.center} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.description}>
          The camera is used to read the digits on your scale. Photos are
          processed on this device.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
        <Pressable
          style={styles.linkButton}
          onPress={() =>
            router.replace({
              pathname: '/confirm-weight',
              params: { source: 'manual' },
            })
          }>
          <Text style={styles.linkText}>Enter manually instead</Text>
        </Pressable>
      </View>
    );
  }

  async function capture() {
    if (!cameraRef.current || !cameraReady || processing) return;

    setProcessing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        exif: false,
      });

      if (!photo?.uri) {
        throw new Error('No image was captured.');
      }

      const result = await recognizeWeight(photo.uri, profile, {
        width: photo.width,
        height: photo.height,
      });

      router.push({
        pathname: '/confirm-weight',
        params: {
          source: 'ocr',
          imageUri: photo.uri,
          rawText: result.rawText,
          ocrDebug: result.debug,
          candidates: JSON.stringify(result.candidates),
        },
      });
    } catch (error) {
      Alert.alert(
        "Couldn't read the scale",
        error instanceof Error
          ? error.message
          : 'Try again or enter the reading manually.'
      );
    } finally {
      setProcessing(false);
    }
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />

      <View pointerEvents="none" style={styles.overlay}>
        <Text style={styles.overlayTitle}>Scan scale display</Text>
        <Text style={styles.overlayDescription}>
          Fit the LCD inside the guide and avoid glare.
        </Text>
        <View style={styles.guide} />
      </View>

      <View style={styles.bottom}>
        {!isOcrSupported() && (
          <Text style={styles.warning}>
            On-device OCR is unavailable on this device. Photos are captured but
            the reading must be typed in.
          </Text>
        )}
        <Pressable
          style={[styles.button, (!cameraReady || processing) && styles.disabled]}
          disabled={!cameraReady || processing}
          onPress={capture}>
          <Text style={styles.buttonText}>
            {processing ? 'Reading display…' : 'Capture weight'}
          </Text>
        </Pressable>

        {processing && <ActivityIndicator color={Colors.surface} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101814' },
  center: {
    flex: 1,
    padding: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  description: {
    textAlign: 'center',
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: 70,
  },
  overlayTitle: {
    color: Colors.surface,
    fontSize: 23,
    fontWeight: '700',
  },
  overlayDescription: {
    color: Colors.surface,
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  guide: {
    width: '78%',
    height: 150,
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: Radius.lg,
    marginTop: 90,
  },
  bottom: {
    position: 'absolute',
    bottom: 40,
    left: Spacing.four,
    right: Spacing.four,
    gap: Spacing.two,
  },
  warning: {
    color: Colors.surface,
    backgroundColor: 'rgba(180, 35, 24, 0.8)',
    padding: Spacing.two,
    borderRadius: Radius.sm,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.brand,
    padding: 17,
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  buttonText: { color: Colors.surface, fontWeight: '700', fontSize: 16 },
  linkButton: { padding: Spacing.two },
  linkText: { color: Colors.brand, fontWeight: '600' },
  disabled: { opacity: 0.65 },
});
