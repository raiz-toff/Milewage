import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { useColors } from '../theme/theme';

interface Props {
  title: string;
  /** One muted line under the title, as on the web pages. */
  description?: string;
  children?: ReactNode;
  /** Replaces the default header. */
  header?: ReactNode;
  /** Shown on the right of the title row. */
  action?: ReactNode;
  /** Pinned to the bottom, above the home indicator. */
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * The page frame of every screen, laid out like the web app's pages: a back button, the page
 * title (text-2xl, semibold, tight) with an optional description, then the content in a
 * 16-padded column with 16 between cards.
 */
export function Screen({
  title,
  description,
  children,
  header,
  action,
  footer,
  onRefresh,
  refreshing = false,
}: Props) {
  const C = useColors();
  const nav = useNavigation();
  const back = nav.canGoBack();
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      {header ?? (
        <View className="gap-1 px-4 pb-2 pt-2">
          <View className="h-12 flex-row items-center justify-between">
            {back ? (
              <Button
                variant="ghost"
                size="icon"
                accessibilityLabel="Go back"
                onPress={() => nav.goBack()}
                className="-ml-3"
              >
                <ArrowLeft size={22} color={C.foreground} />
              </Button>
            ) : (
              <View />
            )}
            {action}
          </View>
          <Text variant="h2" accessibilityRole="header">
            {title}
          </Text>
          {description && <Text variant="muted">{description}</Text>}
        </View>
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="gap-4 p-4 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={C.mutedForeground}
                colors={[C.foreground]}
                progressBackgroundColor={C.card}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {footer && <View className="border-t border-border bg-background p-4">{footer}</View>}
    </SafeAreaView>
  );
}
