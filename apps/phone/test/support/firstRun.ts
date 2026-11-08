import { fireEvent, screen, waitFor } from '@testing-library/react-native';

/** After connecting from the first run: Connected, every permission step "Not now", Ready, Home. */
export async function finishSetup() {
  fireEvent.press(await screen.findByRole('button', { name: 'Next' }));
  for (;;) {
    await waitFor(() => screen.getByText(/^(Not now|Go to home)$/));
    const home = screen.queryByText('Go to home');
    if (home) return fireEvent.press(home);
    fireEvent.press(screen.getByText('Not now'));
  }
}
