import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

/**
 * Hands every `milewage://` link that opens the app to `onLink`: the one that started the app, and
 * any that arrive while it runs (the phone's own camera scanning the pairing QR, or a tap on the
 * link on the web page). Android sends the link here because `app.json` registers the scheme.
 * Mount it once navigation is ready, so a link that started the app is not lost.
 */
export function PairingLinks({ onLink }: { onLink: (url: string) => void }) {
  const handler = useRef(onLink);
  handler.current = onLink;

  useEffect(() => {
    let last: string | null = null;
    const open = (url: string | null | undefined) => {
      if (!url || !/^milewage:\/\//i.test(url) || url === last) return;
      last = url; // the same link delivered twice (start-up and event) is handled once
      handler.current(url);
    };
    void Linking.getInitialURL().then(open, () => undefined);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, []);

  return null;
}
