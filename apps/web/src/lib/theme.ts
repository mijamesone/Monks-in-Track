import { useEffect, useState } from 'react';
import type { ThemeSetting } from './types.ts';

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Light between `lightFrom` and `darkFrom`, dark otherwise (handles ranges that cross midnight). */
export function themeFor(setting: ThemeSetting, now: Date): 'light' | 'dark' {
  if (setting.mode !== 'auto') return setting.mode;
  const t = now.getHours() * 60 + now.getMinutes();
  const light = minutesOf(setting.lightFrom);
  const dark = minutesOf(setting.darkFrom);
  const isLight = light < dark ? t >= light && t < dark : t >= light || t < dark;
  return isLight ? 'light' : 'dark';
}

/** Applies the theme to <html data-theme> and re-checks every minute, so evening arrives on its own. */
export function useTimeOfDayTheme(setting: ThemeSetting | undefined): 'light' | 'dark' {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const theme = setting ? themeFor(setting, now) : 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return theme;
}
