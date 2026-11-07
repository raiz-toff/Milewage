import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';

interface State {
  failed: boolean;
}

/**
 * Catches a crash while drawing a screen, so the driver sees a way back instead of a blank or
 * frozen screen. A shift keeps recording: the tracker runs natively, outside React. `onError`
 * hands the crash to diagnostics (a caught render error never reaches the global handler).
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onError?: (e: unknown) => void; onHome?: () => void },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View className="flex-1 justify-center gap-6 bg-background px-6">
        <View className="gap-2">
          <Text variant="h3" accessibilityRole="header">
            Something went wrong on this screen
          </Text>
          <Text variant="muted">
            If a shift is running, it is still being recorded. Your shifts on this phone are safe.
          </Text>
        </View>
        <View className="gap-2">
          <Button size="lg" onPress={() => this.setState({ failed: false })}>
            <Text>Try again</Text>
          </Button>
          {this.props.onHome && (
            <Button
              variant="outline"
              onPress={() => {
                this.props.onHome!();
                this.setState({ failed: false });
              }}
            >
              <Text>Go to home</Text>
            </Button>
          )}
        </View>
      </View>
    );
  }
}
