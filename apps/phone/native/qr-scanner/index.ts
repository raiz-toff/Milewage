import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export interface QrCameraProps extends ViewProps {
  torch?: boolean;
  /** Each QR text read; the same code again only after a pause. */
  onScanned?: (e: { nativeEvent: { text: string } }) => void;
}

/** The ZXing camera view (Android). Loaded on first use, so tests never touch it. */
export const loadQrCamera = (): ComponentType<QrCameraProps> =>
  requireNativeView<QrCameraProps>('QrScanner');
