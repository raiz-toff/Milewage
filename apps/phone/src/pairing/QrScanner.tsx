import { parsePairingLink } from '@milewage/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  PermissionsAndroid,
  Pressable,
  View,
} from 'react-native';
import { loadQrCamera } from '../../native/qr-scanner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraOff, Flashlight, FlashlightOff, ScanLine, X } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { PALETTE } from '../theme/colors';
import { useColors } from '../theme/theme';
import { Alert, AlertTitle } from '../components/ui/alert';
import { useToast } from '../ui/Toast';

const FRAME = 248;
const CORNER = 36;

const CAMERA = PermissionsAndroid.PERMISSIONS.CAMERA;

/**
 * Scans the pairing QR code that Devices on the web app shows. The camera opens full screen only
 * after a tap, reads one QR code, closes, and hands the text to pairing (09 section 5.3: CAMERA is
 * used here and nowhere else; no microphone). Decoding is ZXing, without Google (24 section 6).
 */
export function QrScanner({
  onScanned,
  busy,
}: {
  onScanned: (text: string) => void;
  busy?: boolean;
}) {
  const C = useColors();
  const Camera = useMemo(loadQrCamera, []);
  /** Android never asks again after "Don't allow" twice: then only app settings can turn it on. */
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [torch, setTorch] = useState(false);
  const done = useRef(false);
  const [wrongCode, setWrongCode] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!wrongCode) return;
    // Let the driver aim at the right code: read again after a moment.
    const t = setTimeout(() => {
      setWrongCode(false);
      done.current = false;
    }, 2000);
    return () => clearTimeout(t);
  }, [wrongCode]);

  // The camera stops when the app leaves the screen; close the scanner with it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && setOpen(false));
    return () => sub.remove();
  }, []);

  const start = async () => {
    const answer = (await PermissionsAndroid.check(CAMERA))
      ? PermissionsAndroid.RESULTS.GRANTED
      : await PermissionsAndroid.request(CAMERA);
    setBlocked(answer === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    if (answer !== PermissionsAndroid.RESULTS.GRANTED) {
      if (answer === PermissionsAndroid.RESULTS.DENIED) {
        toast.show({
          tone: 'error',
          title: 'Camera permission is needed to scan.',
          description: 'You can also paste the pairing link below.',
          action: { label: 'Ask again', onPress: () => void start() },
        });
      }
      return;
    }
    done.current = false;
    setTorch(false);
    setOpen(true);
  };

  return (
    <View className="gap-3">
      <Button size="lg" disabled={busy} onPress={() => void start()}>
        {busy ? (
          <ActivityIndicator color={C.primaryForeground} />
        ) : (
          <ScanLine size={18} color={C.primaryForeground} strokeWidth={2.25} />
        )}
        <Text>{busy ? 'Pairing…' : 'Scan pairing code'}</Text>
      </Button>
      {blocked && (
        <Alert icon={CameraOff}>
          <AlertTitle accessibilityRole="alert">Camera access is off for MileWage.</AlertTitle>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 self-start"
            onPress={() => void Linking.openSettings()}
          >
            <Text>Open app settings</Text>
          </Button>
        </Alert>
      )}
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View className="flex-1 bg-black">
          <Camera
            style={{ flex: 1 }}
            torch={torch}
            onScanned={({ nativeEvent: { text: data } }) => {
              if (done.current) return;
              done.current = true;
              if (!parsePairingLink(data.trim())) {
                setWrongCode(true);
                return;
              }
              setOpen(false);
              onScanned(data.trim());
            }}
          />
          <Overlay
            wrongCode={wrongCode}
            torch={torch}
            onTorch={() => setTorch((t) => !t)}
            onClose={() => setOpen(false)}
          />
        </View>
      </Modal>
    </View>
  );
}

/** Close and torch on top, Comma-green viewfinder corners in the middle, a hint below. */
function Overlay({
  wrongCode,
  torch,
  onTorch,
  onClose,
}: {
  wrongCode: boolean;
  torch: boolean;
  onTorch: () => void;
  onClose: () => void;
}) {
  const D = PALETTE;
  const Torch = torch ? FlashlightOff : Flashlight;
  const round =
    'h-12 w-12 items-center justify-center rounded-full border border-border bg-background/70';
  const corner = {
    position: 'absolute' as const,
    width: CORNER,
    height: CORNER,
    borderColor: wrongCode ? D.destructive : D.primary,
  };
  return (
    <SafeAreaView className="absolute inset-0 justify-between" pointerEvents="box-none">
      <View className="flex-row items-center justify-between px-4 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
          onPress={onClose}
          className={round}
        >
          <X size={22} color={D.foreground} />
        </Pressable>
        <Text variant="large">Scan pairing code</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
          onPress={onTorch}
          className={round}
        >
          <Torch size={20} color={D.foreground} />
        </Pressable>
      </View>
      <View className="items-center" pointerEvents="none">
        <View style={{ width: FRAME, height: FRAME }}>
          <View
            style={[
              corner,
              { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
            ]}
          />
          <View
            style={[
              corner,
              {
                top: 0,
                right: 0,
                borderTopWidth: 4,
                borderRightWidth: 4,
                borderTopRightRadius: 16,
              },
            ]}
          />
          <View
            style={[
              corner,
              {
                bottom: 0,
                left: 0,
                borderBottomWidth: 4,
                borderLeftWidth: 4,
                borderBottomLeftRadius: 16,
              },
            ]}
          />
          <View
            style={[
              corner,
              {
                bottom: 0,
                right: 0,
                borderBottomWidth: 4,
                borderRightWidth: 4,
                borderBottomRightRadius: 16,
              },
            ]}
          />
        </View>
      </View>
      <View
        accessibilityLiveRegion="polite"
        className={
          wrongCode
            ? 'mx-6 mb-6 rounded-xl border border-destructive/50 bg-card/90 p-4'
            : 'mx-6 mb-6 rounded-xl border border-border bg-card/90 p-4'
        }
      >
        {wrongCode ? (
          <Text className="text-center">
            That is not a MileWage pairing code. Point at the code on Devices in your web app.
          </Text>
        ) : (
          <Text className="text-center">
            On your MileWage web app open Devices, make a pairing code, and hold this phone over it.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}
