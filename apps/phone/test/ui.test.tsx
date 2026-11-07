import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SwipeButton } from '../src/components/ui/swipe-button';
import { ConfirmProvider, useConfirm } from '../src/ui/Dialog';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { ToastProvider, useToast } from '../src/ui/Toast';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

describe('shared UI', () => {
  it('the crash guard shows a way back and reports the crash', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const Boom = () => {
      if (broken) throw new Error('boom');
      return <Text>Fine again</Text>;
    };
    const onError = jest.fn();
    const onHome = jest.fn();
    render(
      <ErrorBoundary onError={onError} onHome={onHome}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong on this screen')).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    broken = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Fine again')).toBeTruthy();
    jest.restoreAllMocks();
  });

  it('the swipe button confirms through its screen-reader action, and not when disabled', () => {
    const onConfirm = jest.fn();
    const { rerender } = render(
      <SwipeButton
        label="Swipe to end shift"
        accessibilityLabel="End shift"
        onConfirm={onConfirm}
      />,
    );
    const button = screen.getByRole('button', { name: 'End shift' });
    fireEvent.press(button); // a tap does nothing
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    rerender(
      <SwipeButton
        label="Swipe to end shift"
        accessibilityLabel="End shift"
        onConfirm={onConfirm}
        disabled
      />,
    );
    fireEvent(screen.getByRole('button', { name: 'End shift' }), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('the dialog answers true on confirm and false on cancel; a toast shows its message', async () => {
    const answers: boolean[] = [];
    const Ask = () => {
      const confirm = useConfirm();
      const toast = useToast();
      return (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void confirm({ title: 'Delete it?', confirmLabel: 'Delete' }).then((ok) => {
                answers.push(ok);
                toast.show({ title: ok ? 'Deleted.' : 'Kept.' });
              })
            }
          >
            <Text>Ask</Text>
          </Pressable>
        </>
      );
    };
    render(
      <ToastProvider>
        <ConfirmProvider>
          <Ask />
        </ConfirmProvider>
      </ToastProvider>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Kept.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted.')).toBeTruthy();
    expect(answers).toEqual([false, true]);
  });
});
