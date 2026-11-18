import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, post } from '../lib/api.ts';
import { useCatalog, useMutate } from '../lib/queries.ts';
import { toast } from '../lib/toast.ts';
import { Field, TextInput, TimeInput, parseClock } from './fields.tsx';
import { Button, Card, Label } from './ui.tsx';

interface BackupSettings {
  folder: string | null;
  keepDays: number;
  time: string;
}

const sizeText = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Settings › Backups: folder, daily time, how long to keep, back up now, restore. */
export function Backups() {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const current = (catalog.data?.settings.backup as BackupSettings | undefined) ?? { folder: null, keepDays: 30, time: '12:00' };
  const [folder, setFolder] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutate<{ backup: BackupSettings }>('PATCH', () => '/api/settings');
  const list = useQuery({
    queryKey: ['backups', current.folder] as const,
    queryFn: () => api<{ name: string; size: number; createdAt: number }[]>('/api/backups'),
    enabled: !!current.folder,
  });

  const f = folder ?? current.folder ?? '';
  const t = time ?? current.time;
  const k = keep ?? String(current.keepDays);
  const dirty = f !== (current.folder ?? '') || t !== current.time || k !== String(current.keepDays);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clock = parseClock(t);
    const days = Number(k);
    if (!clock) return setError('Daily time: use 24-hour time, e.g. 12:00.');
    if (!Number.isInteger(days) || days < 1 || days > 365) return setError('Keep backups for 1 to 365 days.');
    setError(null);
    save.mutate(
      { backup: { folder: f.trim() || null, time: clock, keepDays: days } },
      {
        onSuccess: () => {
          setFolder(null);
          setTime(null);
          setKeep(null);
          toast('Backup settings saved', 'success');
        },
      },
    );
  };

  const backupNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ file: string }>('/api/backup');
      toast(`Backed up to ${r.file.split(/[\\/]/).pop()}`, 'success');
      void qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string, when: number) => {
    const at = new Date(when).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (!window.confirm(`Restore the backup from ${at}?\n\nEverything changed since then is replaced. A copy of your current data is saved first, so you can undo this by restoring that copy.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ safetyCopy: string }>('/api/backups/restore', { name });
      await qc.invalidateQueries();
      toast(`Restored. Your previous data is saved as ${r.safetyCopy}`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <Label>Backups</Label>
      <p className="m-0 text-sm text-text-2">
        A copy of all your data is saved once a day, at the time below or as soon as the app runs after it. A folder synced by OneDrive or Google Drive also keeps a copy off this computer.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Backup folder" hint="A full folder path on this computer, for example C:\Users\you\OneDrive\MonksTracker Backups. It is created if missing.">
          <TextInput value={f} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\OneDrive\MonksTracker Backups" spellCheck={false} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <div className="w-32">
            <Field label="Daily at">
              <TimeInput value={t} onChange={(v) => setTime(v)} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Keep for (days)">
              <TextInput inputMode="numeric" value={k} onChange={(e) => setKeep(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
            Save
          </Button>
          <Button onClick={() => void backupNow()} disabled={busy || !current.folder || dirty}>
            Back up now
          </Button>
        </div>
      </form>
      {(error || save.error) && <p className="m-0 text-sm text-danger">{error ?? save.error?.message}</p>}
      {!current.folder ? (
        <p className="m-0 rounded-field bg-amber px-4 py-3 text-sm text-on-fill">No backup folder yet, so no daily backups are being made.</p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-divider pt-4">
          <span className="text-[13px] font-semibold text-text-2">Backups in this folder</span>
          {(list.data ?? []).length === 0 ? (
            <span className="text-sm text-text-3">None yet. Press Back up now to make the first one.</span>
          ) : (
            <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0" aria-label="Backups">
              {(list.data ?? []).map((b) => (
                <li key={b.name} className="flex items-center gap-3 border-b border-divider py-2 text-sm last:border-b-0">
                  <span className="num w-44 shrink-0">{new Date(b.createdAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-3">
                    {b.name.includes('before-restore') ? 'saved before a restore · ' : ''}
                    {sizeText(b.size)}
                  </span>
                  <Button size="sm" aria-label={`Restore ${b.name}`} onClick={() => void restore(b.name, b.createdAt)} disabled={busy}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** Settings › Security: PIN lock and auto-lock. */
export function Security() {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const health = useQuery({ queryKey: ['health'] as const, queryFn: () => api<{ ok: boolean; pinSet: boolean }>('/api/health') });
  const pinSet = !!health.data?.pinSet;
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockAfter, setLockAfter] = useState<string | null>(null);
  const saveSettings = useMutate<{ autoLockMinutes: number }>('PATCH', () => '/api/settings');
  const autoLock = lockAfter ?? String((catalog.data?.settings.autoLockMinutes as number | undefined) ?? 30);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

  const done = (msg: string) => {
    setCurrent('');
    setPin('');
    setAgain('');
    setError(null);
    void qc.invalidateQueries({ queryKey: ['health'] });
    toast(msg, 'success');
  };
  const setNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return setError('Use 4 to 8 digits.');
    if (pin !== again) return setError('The two PINs do not match.');
    try {
      await post('/api/auth/pin', { pin, ...(pinSet ? { currentPin: current } : {}) });
      // Setting a PIN starts locking at once; unlock this browser with it so you stay in.
      await post('/api/auth/unlock', { pin });
      done(pinSet ? 'PIN changed' : 'PIN set. The app now asks for it after a restart or when idle.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the PIN.');
    }
  };
  const remove = async () => {
    try {
      await api('/api/auth/pin', { method: 'DELETE', body: { currentPin: current } });
      done('PIN removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the PIN.');
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <Label>Security</Label>
      <p className="m-0 text-sm text-text-2">
        {pinSet
          ? 'A PIN is set. MonksTracker asks for it after the server restarts and after the idle time below. Timers keep running while locked.'
          : 'No PIN. Anyone using this computer can open MonksTracker. Only this computer can reach it either way.'}
      </p>
      <form onSubmit={setNew} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          {pinSet && (
            <div className="w-40">
              <Field label="Current PIN">
                <TextInput type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(digits(e.target.value))} />
              </Field>
            </div>
          )}
          <div className="w-40">
            <Field label={pinSet ? 'New PIN' : 'PIN (4–8 digits)'}>
              <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Repeat PIN">
              <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(digits(e.target.value))} />
            </Field>
          </div>
        </div>
        {error && <p className="m-0 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!pin || !again || (pinSet && !current)}>
            {pinSet ? 'Change PIN' : 'Set PIN'}
          </Button>
          {pinSet && (
            <>
              <Button variant="danger" onClick={() => void remove()} disabled={!current}>
                Remove PIN
              </Button>
              <Button onClick={() => void post('/api/auth/lock').then(() => window.dispatchEvent(new Event('mt:locked')))}>Lock now</Button>
            </>
          )}
        </div>
      </form>
      <form
        className="flex items-end gap-2 border-t border-divider pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const m = Number(autoLock);
          if (!Number.isInteger(m) || m < 1 || m > 1440) return setError('Lock after 1 to 1440 minutes.');
          saveSettings.mutate({ autoLockMinutes: m }, { onSuccess: () => (setLockAfter(null), toast('Saved', 'success')) });
        }}
      >
        <div className="w-48">
          <Field label="Lock after idle (minutes)">
            <TextInput inputMode="numeric" value={autoLock} onChange={(e) => setLockAfter(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Button type="submit" disabled={lockAfter === null}>
          Save
        </Button>
      </form>
    </Card>
  );
}
