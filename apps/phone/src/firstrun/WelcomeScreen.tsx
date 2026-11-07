import { View } from 'react-native';
import { Route, Unplug } from 'lucide-react-native';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { Screen } from '../ui/Screen';
import { connectRoute } from './TailscaleScreen';

/** The first screen of a phone that is not connected (24 section 4.2, screen 1). */
export function WelcomeScreen({ navigation, route }: ScreenProps<'Welcome'>) {
  const C = useColors();
  const { net } = useServices();
  return (
    <Screen
      title="Welcome to MileWage"
      description="MileWage records your shifts and sends them to your own MileWage server."
      footer={
        <View className="gap-3">
          <Button size="lg" onPress={async () => navigation.navigate(await connectRoute(net))}>
            <Text>I have a server</Text>
          </Button>
          <Button size="lg" variant="outline" onPress={() => navigation.navigate('ServerSetup')}>
            <Text>{"I don't have one yet"}</Text>
          </Button>
        </View>
      }
    >
      {route.params?.revoked && (
        <Alert variant="destructive" icon={Unplug}>
          <AlertTitle accessibilityRole="alert">
            This phone was disconnected from your server. Connect again.
          </AlertTitle>
          <AlertDescription>Shifts not yet sent stay on this phone.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="flex-row items-start gap-3">
          <Route size={20} color={C.primary} />
          <Text className="flex-1">
            Start a shift when you start work. The phone counts your miles, even with the screen
            off. Your shifts go to a server you run, at home or on your own computer.
          </Text>
        </CardContent>
      </Card>
    </Screen>
  );
}
