import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Car, CheckCircle2 } from 'lucide-react-native';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { useServices } from '../services';
import type { Vehicle } from '../shift/controller';
import { useColors } from '../theme/theme';
import { Rows } from '../ui/Parts';
import { Screen } from '../ui/Screen';

/** The country's name in English, or its code where the phone has no names (Hermes). */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

interface Seen {
  base: string;
  name: string | null;
  country: string | null;
  region: string | null;
  /** null: the list could not be loaded. */
  vehicles: Vehicle[] | null;
}

/**
 * What the server sent when the phone connected (24 section 4.2, screen 5). A shift needs a
 * vehicle, so without one the driver is sent to the web to add it, with Check again.
 */
export function ConnectedScreen({ navigation }: ScreenProps<'Connected'>) {
  const C = useColors();
  const { pairing, shift } = useServices();
  const [seen, setSeen] = useState<Seen | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    const st = await pairing.load();
    // The settings may carry more than the phone's cache type names; read only what is shown.
    const s = (st?.settings ?? {}) as { display_name?: string | null; region?: string | null };
    const vehicles = await shift.vehicles().catch(() => null);
    setSeen({
      base: st?.credential.baseUrl ?? '',
      name: s.display_name ?? null,
      country: st?.settings?.country ?? null,
      region: s.region ?? null,
      vehicles: vehicles ? [...vehicles] : null,
    });
    setChecking(false);
  }, [pairing, shift]);
  useEffect(() => void load(), [load]);

  const rows: [string, string][] = seen
    ? [
        ['Country', seen.country ? countryName(seen.country) : 'Not set'],
        ['Region', seen.region ?? 'Not set'],
        [
          'Vehicles',
          seen.vehicles === null
            ? 'Could not be loaded'
            : seen.vehicles.map((v) => v.name).join(', ') || 'None yet',
        ],
      ]
    : [];
  const noVehicle = seen?.vehicles?.length === 0;

  return (
    <Screen
      title="Connected"
      description={
        seen
          ? `Connected to ${seen.base}${seen.name ? ` as ${seen.name}` : ''}.`
          : 'Reading what your server sent.'
      }
      footer={
        <Button size="lg" disabled={!seen} onPress={() => navigation.navigate('SetupStep')}>
          <Text>Next</Text>
        </Button>
      }
    >
      {seen && (
        <Card className="py-0">
          <Rows>
            {rows.map(([label, value]) => (
              <View key={label} className="flex-row items-center justify-between gap-3 px-4 py-3">
                <Text variant="muted">{label}</Text>
                <Text variant="label" className="flex-1 text-right">
                  {value}
                </Text>
              </View>
            ))}
          </Rows>
        </Card>
      )}
      {noVehicle && (
        <Alert icon={Car}>
          <AlertTitle accessibilityRole="alert">
            Finish setup on the web: add your vehicle.
          </AlertTitle>
          <AlertDescription>
            A shift needs a vehicle. Add it in MileWage on your computer, then check again.
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={checking}
            onPress={() => void load()}
          >
            <Text>{checking ? 'Checking…' : 'Check again'}</Text>
          </Button>
        </Alert>
      )}
      {seen && !noVehicle && seen.vehicles !== null && (
        <View className="flex-row items-center gap-2 px-1">
          <CheckCircle2 size={16} color={C.primary} />
          <Text variant="muted">Your server is ready for this phone.</Text>
        </View>
      )}
    </Screen>
  );
}
