import { Redirect } from 'expo-router';
import { sessionRedirect } from '../src/passkeys';
import { useAppState } from '../src/state/AppState';

export default function Index() {
  const { unlockedUntil } = useAppState();
  const unlocked = !!unlockedUntil && unlockedUntil > Date.now();
  return <Redirect href={sessionRedirect(unlocked, undefined) ?? '/unlock'} />;
}
