import { PartyPopper } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Text } from '../components/ui/text';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { Screen } from '../ui/Screen';

/** The last setup step (24 section 4.2, screen 10). Anything skipped stays on Home's checklist. */
export function ReadyScreen() {
  const C = useColors();
  const { pairing } = useServices();
  return (
    <Screen
      title="You're ready"
      description="Start your first shift when you start work."
      footer={
        // Finishing switches the app screens on; Home comes first by itself.
        <Button size="lg" onPress={() => void pairing.finishSetup()}>
          <Text>Go to home</Text>
        </Button>
      }
    >
      <Card>
        <CardContent className="flex-row items-start gap-3">
          <PartyPopper size={20} color={C.primary} />
          <Text className="flex-1">
            Tap Start shift on the home screen. MileWage records your route until you end the shift,
            then sends it to your server.
          </Text>
        </CardContent>
      </Card>
    </Screen>
  );
}
