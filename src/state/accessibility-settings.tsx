import { File, Paths } from 'expo-file-system';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type AccessibilitySettings = {
  tutorialSeen: boolean;
  markTutorialSeen: () => void;
  largeText: boolean;
  highContrast: boolean;
  setLargeText: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
};

const SettingsContext = createContext<AccessibilitySettings | null>(null);

export function AccessibilitySettingsProvider({ children }: { children: ReactNode }) {
  const [tutorialSeen, setTutorialSeen] = useState(() => {
    try { return new File(Paths.document, 'signbridge-tutorial-v1.txt').exists; }
    catch { return false; }
  });
  const markTutorialSeen = useCallback(() => {
    setTutorialSeen(true);
    try {
      const flag = new File(Paths.document, 'signbridge-tutorial-v1.txt');
      flag.create({ overwrite: true });
      flag.writeSync('complete');
    } catch {
      // Keep the session preference if local storage is unavailable.
    }
  }, []);
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const value = useMemo(
    () => ({ largeText, highContrast, setLargeText, setHighContrast, tutorialSeen, markTutorialSeen }),
    [largeText, highContrast, tutorialSeen, markTutorialSeen],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAccessibilitySettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('Accessibility settings must be used inside their provider.');
  return value;
} 

