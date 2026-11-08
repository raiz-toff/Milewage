import { Linking, Share, View } from 'react-native';
import { ExternalLink, Send } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { useColors } from '../theme/theme';
import { Rows } from '../ui/Parts';
import { Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { INSTALL_GUIDE_URL, SERVER_STEPS, shareStepsMessage } from './links';

/** "I don't have one yet" (24 section 4.2, screen 2): what to do on a computer, then come back. */
export function ServerSetupScreen({ navigation }: ScreenProps<'ServerSetup'>) {
  const C = useColors();
  const toast = useToast();

  const failed = () =>
    toast.show({
      tone: 'error',
      title: 'This phone could not open it.',
      description: INSTALL_GUIDE_URL
        ? `On your computer, open ${INSTALL_GUIDE_URL}.`
        : 'Do the steps above on your computer.',
    });
  const share = () =>
    Share.share(
      { title: 'Set up your MileWage server', message: shareStepsMessage() },
      { dialogTitle: 'Send these steps' },
    ).catch(failed);
  const guide = INSTALL_GUIDE_URL;
  const openGuide = (url: string) => Linking.openURL(url).catch(failed);

  return (
    <Screen
      title="Set up your server"
      description="Do these steps on a computer. Then come back to this phone."
      footer={
        <Button size="lg" onPress={() => navigation.navigate('Connect')}>
          <Text>My server is ready</Text>
        </Button>
      }
    >
      <Card className="py-0">
        <Rows>
          {SERVER_STEPS.map((s, i) => (
            <View key={s.title} className="flex-row items-start gap-3 px-4 py-3">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-muted">
                <Text variant="label" tabular>
                  {i + 1}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="label">{s.title}</Text>
                <Text variant="muted">{s.detail}</Text>
              </View>
            </View>
          ))}
        </Rows>
      </Card>
      <Button variant="secondary" onPress={() => void share()}>
        <Send size={18} color={C.foreground} />
        <Text>Send these steps to my computer</Text>
      </Button>
      {guide ? (
        <Button variant="outline" onPress={() => void openGuide(guide)}>
          <ExternalLink size={18} color={C.foreground} />
          <Text>Open the guide</Text>
        </Button>
      ) : null}
    </Screen>
  );
}
