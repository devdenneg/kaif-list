import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Check, Loader2, UserCircle2 } from 'lucide-react';
import { DEFAULT_TIMEZONE, LIMITS, type AuthResult } from '@kaif/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/lib/toast';
import { ApiError } from '@/lib/api';

const TIMEZONES = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/Kyiv',
  'Asia/Almaty',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Dubai',
  'Europe/Belgrade',
  'UTC',
];

/**
 * Обязательный онбординг после привязки Telegram.
 *
 * Требование продукта: у человека на доске обязаны быть человеческое имя
 * и аватар. Пока их нет, остальные экраны закрыты — и это правильно:
 * доска с безымянными карточками бесполезна.
 */
export function OnboardingPage(): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/boards';

  const [displayName, setDisplayName] = React.useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(user?.avatarUrl ?? null);
  const [timezone, setTimezone] = React.useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE,
  );
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }
    if (file.size > LIMITS.avatar.maxBytes) {
      toast.error('Файл слишком большой', new Error('Максимум 5 МБ'));
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<{ avatarUrl: string }>('/api/users/me/avatar', formData);
      setAvatarUrl(result.avatarUrl);
      setErrors((current) => ({ ...current, avatarUrl: '' }));
    } catch (error) {
      toast.error('Не удалось загрузить аватар', error);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setErrors({});

    const trimmed = displayName.trim();
    if (trimmed.length < LIMITS.displayName.min) {
      setErrors({ displayName: `Минимум ${LIMITS.displayName.min} символа` });
      return;
    }
    if (!avatarUrl) {
      setErrors({ avatarUrl: 'Загрузите аватар — коллеги должны узнавать вас на доске' });
      return;
    }

    setSaving(true);
    try {
      const result = await api.post<AuthResult>('/api/auth/profile', {
        displayName: trimmed,
        avatarUrl,
        timezone,
        locale: 'ru',
      });
      setSession(result.accessToken, result.user);
      toast.success('Профиль готов', 'Добро пожаловать в Kaif Board');
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      toast.error('Не удалось сохранить профиль', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Последний шаг</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Как вас показывать коллегам на доске?
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Загрузить аватар"
            >
              {avatarUrl ? (
                <UserAvatar
                  user={{ id: user?.id ?? 'me', displayName: displayName || 'Я', avatarUrl }}
                  size="2xl"
                />
              ) : (
                <span className="flex size-24 items-center justify-center rounded-full border-2 border-dashed border-border bg-secondary text-muted-foreground">
                  <UserCircle2 className="size-10" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/50 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? (
                  <Loader2 className="size-6 animate-spin text-white" />
                ) : (
                  <Camera className="size-6 text-white" />
                )}
              </span>
            </button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            >
              {avatarUrl ? 'Заменить фото' : 'Загрузить фото'}
            </Button>

            {errors.avatarUrl && <p className="text-xs text-destructive">{errors.avatarUrl}</p>}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void handleUpload(file);
              }}
            />
          </div>

          <FormField label="Имя и фамилия" required error={errors.displayName}>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ирина Смирнова"
              maxLength={LIMITS.displayName.max}
              invalid={Boolean(errors.displayName)}
              autoFocus
            />
          </FormField>

          <FormField
            label="Часовой пояс"
            hint="По нему считаются дедлайны и приходит утренняя сводка"
          >
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([timezone, ...TIMEZONES])].map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={saving}>
            <Check />
            Всё готово
          </Button>
        </div>
      </form>
    </div>
  );
}
