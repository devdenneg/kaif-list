import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, KanbanSquare, RefreshCw, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AuthResult, LoginCodeDto, LoginCodeStatusDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'waiting' | 'approved' | 'expired';

/**
 * Вход через Telegram по одноразовому коду.
 *
 * Почему именно так: код живёт две минуты, одноразовый, а подтверждает его
 * сам Telegram — значит, ни пароль, ни привязка домена не нужны. Бонусом
 * пользователь сразу оказывается в чате с ботом, и уведомления работают
 * с первой минуты.
 */
export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);

  const [stage, setStage] = React.useState<Stage>('idle');
  const [loginCode, setLoginCode] = React.useState<LoginCodeDto | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/boards';

  const requestCode = React.useCallback(async () => {
    setLoading(true);
    try {
      const code = await api.post<LoginCodeDto>('/api/auth/telegram/login-code', {
        deviceLabel: buildDeviceLabel(),
      });
      setLoginCode(code);
      setStage('waiting');
      setSecondsLeft(Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000)));
      window.open(code.deepLink, '_blank', 'noopener');
    } catch (error) {
      toast.error('Не удалось начать вход', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Обратный отсчёт жизни кода.
  React.useEffect(() => {
    if (stage !== 'waiting') return;
    const timer = setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          setStage('expired');
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [stage]);

  // Опрос статуса кода: как только бот подтвердил — обмениваем на токены.
  React.useEffect(() => {
    if (stage !== 'waiting' || !loginCode) return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const { status } = await api.get<LoginCodeStatusDto>(
          `/api/auth/telegram/login-code/${encodeURIComponent(loginCode.code)}/status`,
        );
        if (cancelled) return;

        if (status === 'APPROVED') {
          setStage('approved');
          const result = await api.post<AuthResult>('/api/auth/telegram/exchange', {
            code: loginCode.code,
          });
          setSession(result.accessToken, result.user);
          navigate(result.user.profileCompleted ? redirectTo : '/onboarding', {
            replace: true,
            ...(result.user.profileCompleted ? {} : { state: { from: redirectTo } }),
          });
          return;
        }
        if (status === 'EXPIRED' || status === 'CONSUMED') setStage('expired');
      } catch {
        // Сетевые сбои при опросе не должны ломать экран входа.
      }
    };

    const interval = setInterval(() => void poll(), loginCode.pollIntervalMs);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stage, loginCode, navigate, redirectTo, setSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card">
            <KanbanSquare className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Kaif Board</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Корпоративная доска задач вашей команды
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          {stage === 'idle' && (
            <div className="space-y-5">
              <div className="space-y-2 text-center">
                <h2 className="text-lg font-semibold">Вход через Telegram</h2>
                <p className="text-sm text-muted-foreground">
                  Нажмите кнопку — откроется наш бот. Подтвердите вход одним сообщением,
                  и вкладка сама пустит вас на доску.
                </p>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => void requestCode()}
                loading={loading}
              >
                <Send />
                Войти через Telegram
              </Button>

              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                  Пароль не нужен: вход подтверждает сам Telegram
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                  Код одноразовый, живёт две минуты и требует подтверждения в боте
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                  Сразу подключаются уведомления по вашим задачам
                </li>
              </ul>
            </div>
          )}

          {stage === 'waiting' && loginCode && (
            <div className="space-y-5 text-center">
              <div className="flex flex-col items-center gap-3">
                <Spinner className="size-6" />
                <div>
                  <h2 className="text-lg font-semibold">Подтвердите вход в Telegram</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Бот <span className="font-medium">@{loginCode.botUsername}</span> покажет код.
                    Сверьте его с кодом ниже и нажмите «Это я».
                  </p>
                </div>
              </div>

              {/* Код сверяют глазами: именно это не даёт впустить чужой браузер,
                  если ссылку на вход прислал посторонний. */}
              <div className="rounded-xl border border-border bg-secondary/50 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Код подтверждения
                </p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-foreground">
                  {loginCode.verificationCode}
                </p>
              </div>

              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-xs text-warning">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                Если код в боте отличается — вход запрашиваете не вы. Нажмите там «Это не я».
              </p>

              <a
                href={loginCode.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Send className="size-4" />
                Открыть Telegram ещё раз
              </a>

              <div className="space-y-2">
                <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-1000',
                      secondsLeft > 30 ? 'bg-primary' : 'bg-warning',
                    )}
                    style={{ width: `${Math.min(100, (secondsLeft / 120) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Код действителен ещё {secondsLeft} с
                </p>
              </div>
            </div>
          )}

          {stage === 'approved' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <h2 className="text-lg font-semibold">Вход подтверждён</h2>
              <p className="text-sm text-muted-foreground">Открываем доску…</p>
            </div>
          )}

          {stage === 'expired' && (
            <div className="space-y-4 text-center">
              <div>
                <h2 className="text-lg font-semibold">Код истёк</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ничего страшного — запросите новый, это займёт секунду.
                </p>
              </div>
              <Button variant="primary" className="w-full" onClick={() => void requestCode()} loading={loading}>
                <RefreshCw />
                Получить новый код
              </Button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Продолжая, вы соглашаетесь с внутренними правилами компании по работе с данными.
        </p>
      </div>
    </div>
  );
}

/** Понятная подпись устройства в списке активных сессий. */
function buildDeviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg/.test(ua)
      ? 'Edge'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Браузер';
  const platform = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, platform].filter(Boolean).join(' · ');
}
