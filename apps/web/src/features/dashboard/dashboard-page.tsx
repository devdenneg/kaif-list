import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, BarChart3, Clock, TrendingUp, Users } from 'lucide-react';
import { COLUMN_LABELS, PRIORITY_LABELS, can, type TaskPriority } from '@kaif/shared';
import { useBoard, useBoardAnalytics } from '@/api/boards';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FullScreenLoader } from '@/app/loader';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  BLOCKER: '#dc2626',
  URGENT: '#f97316',
  HIGH: '#f59e0b',
  MEDIUM: '#94a3b8',
  LOW: '#0ea5e9',
  LOWEST: '#cbd5e1',
};

/**
 * Аналитика доски: сколько создаём и закрываем, за сколько дней проходит
 * задача и где она застревает. Это то, ради чего руководитель вообще
 * открывает трекер.
 */
export function DashboardPage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const [days, setDays] = React.useState(30);
  const user = useAuthStore((state) => state.user);
  const { data: board, isLoading } = useBoard(boardKey);
  const canSee =
    user && board
      ? can(
          {
            globalRole: user.globalRole,
            boardRole: board.myRole,
            boardArchived: board.isArchived,
          },
          'board.analytics.view',
        )
      : false;
  const { data: analytics, isLoading: analyticsLoading } = useBoardAnalytics(
    canSee ? board?.id : undefined,
    days,
  );

  if (isLoading) return <FullScreenLoader inline />;
  if (!board) return <EmptyState title="Доска не найдена" />;

  if (!canSee) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <EmptyState
          icon={<BarChart3 />}
          title="Аналитика недоступна"
          description="Разбор работы команды видят участники доски и её администраторы."
          action={
            <Button variant="primary" asChild>
              <Link to={`/boards/${board.key}`}>К доске</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-5">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={`/boards/${board.key}`}>
            <ArrowLeft />К доске
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <BarChart3 className="size-5 text-muted-foreground" />
              Аналитика
            </h1>
            <p className="text-sm text-muted-foreground">{board.name}</p>
          </div>

          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 дней</SelectItem>
              <SelectItem value="30">30 дней</SelectItem>
              <SelectItem value="90">90 дней</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {analyticsLoading || !analytics ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Сводка ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Clock />}
              label="Среднее время цикла"
              value={`${analytics.cycleTimeDays.median} дн`}
              hint={`90% задач ≤ ${analytics.cycleTimeDays.p90} дн`}
            />
            <StatCard
              icon={<TrendingUp />}
              label="Закрыто за период"
              value={String(analytics.throughput.reduce((sum, day) => sum + day.done, 0))}
              hint={`Создано: ${analytics.throughput.reduce((sum, day) => sum + day.created, 0)}`}
            />
            <StatCard
              icon={<BarChart3 />}
              label="Просрочено"
              value={String(analytics.overdueCount)}
              tone={analytics.overdueCount > 0 ? 'danger' : 'default'}
            />
            <StatCard
              icon={<Users />}
              label="Без исполнителя"
              value={String(analytics.unassignedCount)}
              tone={analytics.unassignedCount > 5 ? 'warning' : 'default'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Динамика ── */}
            <Panel title="Создано и закрыто">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={analytics.throughput}>
                  <defs>
                    <linearGradient id="created" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="done" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <ChartTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="Создано"
                    stroke="#6366f1"
                    fill="url(#created)"
                  />
                  <Area
                    type="monotone"
                    dataKey="done"
                    name="Закрыто"
                    stroke="#22c55e"
                    fill="url(#done)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>

            {/* ── Приоритеты ── */}
            <Panel title="Активные задачи по приоритету">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={analytics.byPriority.map((item) => ({
                      name: PRIORITY_LABELS[item.priority],
                      value: item.count,
                      priority: item.priority,
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {analytics.byPriority.map((item) => (
                      <Cell key={item.priority} fill={PRIORITY_COLORS[item.priority]} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            {/* ── Колонки ── */}
            <Panel title="Распределение по колонкам">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={analytics.byColumn.map((item) => ({
                    name: COLUMN_LABELS[item.column],
                    count: item.count,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <ChartTooltip
                    cursor={{ fill: 'hsl(var(--secondary))' }}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" name="Задач" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            {/* ── Где застревают ── */}
            <Panel
              title="Где задачи стоят дольше всего"
              hint="Среднее время без движения, дней"
            >
              <div className="space-y-2">
                {analytics.bottlenecks.map((item) => {
                  const max = Math.max(1, ...analytics.bottlenecks.map((b) => b.averageDaysStuck));
                  return (
                    <div key={item.column} className="flex items-center gap-2 text-sm">
                      <span className="w-36 shrink-0 truncate text-muted-foreground">
                        {COLUMN_LABELS[item.column]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(item.averageDaysStuck / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
                        {item.averageDaysStuck}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* ── Нагрузка людей ── */}
          <Panel title="Нагрузка по людям">
            {analytics.byAssignee.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Активных задач с исполнителями нет
              </p>
            ) : (
              <div className="space-y-2">
                {analytics.byAssignee.map((item) => {
                  const max = Math.max(...analytics.byAssignee.map((entry) => entry.count));
                  return (
                    <div key={item.user.id} className="flex items-center gap-2">
                      <UserAvatar user={item.user} size="sm" />
                      <span className="w-40 shrink-0 truncate text-sm">{item.user.displayName}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(item.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                        {item.count}
                        {item.overdue > 0 && (
                          <span className="ml-1 text-destructive">({item.overdue})</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'warning';
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <p
        className={
          tone === 'danger'
            ? 'mt-1 text-2xl font-semibold text-destructive'
            : tone === 'warning'
              ? 'mt-1 text-2xl font-semibold text-warning'
              : 'mt-1 text-2xl font-semibold'
        }
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
