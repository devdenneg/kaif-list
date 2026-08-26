import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import {
  COLUMN_LABELS,
  PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  WORKLOAD_FULL_LOAD,
  can,
  type PersonStatsDto,
  type TaskPriority,
} from '@kaif/shared';
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
import { BoardGate } from '@/features/board/board-gate';
import { cn } from '@/lib/utils';
import {
  AttentionList,
  AttentionTile,
  BarRow,
  DeltaStat,
  Panel,
  formatNumber,
} from './analytics-parts';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  BLOCKER: '#dc2626',
  URGENT: '#f97316',
  HIGH: '#f59e0b',
  MEDIUM: '#94a3b8',
  LOW: '#0ea5e9',
  LOWEST: '#cbd5e1',
};

/**
 * Аналитика доски.
 *
 * Порядок на экране — это и есть главное решение: сверху то, с чем надо
 * что-то делать сегодня, ниже динамика за период, затем разбор по людям,
 * и только потом распределения и графики. Руководитель заходит сюда не
 * любоваться диаграммами, а понять, где горит и кто не вывозит.
 */
export function DashboardPage(): React.ReactElement {
  const { boardKey } = useParams<{ boardKey: string }>();
  const [days, setDays] = React.useState(30);
  const user = useAuthStore((state) => state.user);
  const { data: board, isLoading, error, refetch } = useBoard(boardKey);

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

  if (isLoading || !board) {
    return <BoardGate loading={isLoading} error={error} onRetry={() => void refetch()} />;
  }

  if (!canSee) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <EmptyState
          icon={<BarChart3 />}
          title="Аналитика недоступна"
          description="Разбор работы команды видят владелец доски и её администраторы."
          action={
            <Button variant="primary" asChild>
              <Link to={`/boards/${board.key}`}>К доске</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const boardHref = `/boards/${board.key}`;

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <header className="mb-5">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to={boardHref}>
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
              <SelectItem value="14">14 дней</SelectItem>
              <SelectItem value="30">30 дней</SelectItem>
              <SelectItem value="90">90 дней</SelectItem>
              <SelectItem value="180">180 дней</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {analyticsLoading || !analytics ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── 1. Что требует решения сегодня ── */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <AttentionTile
              label="Просрочено"
              value={analytics.attentionCounts.overdue}
              tone="danger"
              to={boardHref}
            />
            <AttentionTile
              label="Заблокировано"
              value={analytics.attentionCounts.blocked}
              tone="danger"
              to={boardHref}
            />
            <AttentionTile
              label="Застряло"
              value={analytics.attentionCounts.stale}
              tone="warning"
              hint="не двигались неделю"
              to={boardHref}
            />
            <AttentionTile
              label="Без исполнителя"
              value={analytics.attentionCounts.unassigned}
              tone="warning"
              to={boardHref}
            />
            <AttentionTile
              label="Срок на неделе"
              value={analytics.attentionCounts.dueThisWeek}
              to={boardHref}
            />
            <AttentionTile
              label="В работе"
              value={analytics.attentionCounts.inProgress}
              tone="success"
              to={boardHref}
            />
          </div>

          {/* ── 2. Как идут дела ── */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <DeltaStat label="Закрыто" delta={analytics.flow.completed} />
            <DeltaStat label="Создано" delta={analytics.flow.created} goodDirection="down" />
            <DeltaStat
              label="Время цикла"
              delta={analytics.flow.cycleTimeDays}
              unit=" дн"
              goodDirection="down"
              hint={
                analytics.cycleTime.sample > 0
                  ? `медиана · 90% ≤ ${formatNumber(analytics.cycleTime.p90)} дн`
                  : 'ещё нечего считать'
              }
            />
            <DeltaStat
              label="Возвраты"
              delta={analytics.flow.returned}
              goodDirection="down"
              hint="назад по конвейеру"
            />
            <DeltaStat
              label="Переоткрыто"
              delta={analytics.flow.reopened}
              goodDirection="down"
              hint="доставали из «Готово»"
            />
          </div>

          {/* ── 3. Люди ── */}
          <Panel
            title="Люди"
            subtitle={`Загрузка сейчас и результат за ${days} дн. Сверху те, у кого больше работы`}
          >
            <PeopleTable people={analytics.people} />
          </Panel>

          {/* ── 4. Требуют внимания — конкретные задачи ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Просрочено" subtitle="Самые давние сверху">
              <AttentionList
                tasks={analytics.attention.overdue}
                empty="Просроченных задач нет"
                reason={(task) => (task.dueDate ? overdueBy(task.dueDate) : '')}
              />
            </Panel>

            <Panel title="Заблокировано" subtitle="Ждут, пока закроют другую задачу">
              <AttentionList
                tasks={analytics.attention.blocked}
                empty="Заблокированных задач нет"
                reason={(task) => `${task.blockedByCount} блок.`}
              />
            </Panel>

            <Panel title="Застряло" subtitle="Дольше всего без движения">
              <AttentionList
                tasks={analytics.attention.stale}
                empty="Всё в движении"
                reason={(task) => `${formatNumber(task.idleDays)} дн`}
              />
            </Panel>

            <Panel title="Чаще всего возвращали" subtitle="Признак нечёткой постановки">
              <AttentionList
                tasks={analytics.attention.mostReturned}
                empty="Возвратов не было"
                reason={(task) => `${task.returnCount} раз`}
              />
            </Panel>
          </div>

          {/* ── 5. Поток ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Создано и закрыто" subtitle="По дням за выбранный период">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.throughput}>
                    <defs>
                      <linearGradient id="created" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="done" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value: string) => value.slice(5)}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      width={28}
                    />
                    <ChartTooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="created"
                      name="Создано"
                      stroke="hsl(var(--primary))"
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
              </div>
            </Panel>

            <Panel
              title="Сколько задача стоит в колонке"
              subtitle="Медиана по завершённым отрезкам, дней"
            >
              <div className="space-y-2">
                {analytics.columnTime.map((row) => (
                  <BarRow
                    key={row.column}
                    label={COLUMN_LABELS[row.column]}
                    value={row.medianDays}
                    max={Math.max(...analytics.columnTime.map((item) => item.medianDays), 1)}
                    suffix=" дн"
                  />
                ))}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Считается по реальным переходам между колонками, а не по дате последнего
                  изменения.
                </p>
              </div>
            </Panel>
          </div>

          {/* ── 6. Распределения ── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="По колонкам" subtitle="Все задачи на доске, включая завершённые">
              <div className="space-y-2">
                {analytics.byColumn.map((row) => (
                  <BarRow
                    key={row.column}
                    label={COLUMN_LABELS[row.column]}
                    value={row.count}
                    max={Math.max(...analytics.byColumn.map((item) => item.count), 1)}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="По приоритету" subtitle="Активные задачи">
              <div className="space-y-2">
                {analytics.byPriority.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">Активных нет</p>
                ) : (
                  analytics.byPriority.map((row) => (
                    <BarRow
                      key={row.priority}
                      label={PRIORITY_LABELS[row.priority]}
                      value={row.count}
                      max={Math.max(...analytics.byPriority.map((item) => item.count), 1)}
                      color={PRIORITY_COLORS[row.priority]}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel title="По типу" subtitle="Активные задачи">
              <div className="space-y-2">
                {analytics.byType.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">Активных нет</p>
                ) : (
                  analytics.byType.map((row) => (
                    <BarRow
                      key={row.type}
                      label={TASK_TYPE_LABELS[row.type]}
                      value={row.count}
                      max={Math.max(...analytics.byType.map((item) => item.count), 1)}
                    />
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/** Таблица людей. Каждый столбец отвечает на отдельный вопрос руководителя. */
function PeopleTable({ people }: { people: PersonStatsDto[] }): React.ReactElement {
  if (people.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">На доске никого нет</p>;
  }

  // Шкала от фиксированного ориентира, а не от самого загруженного:
  // иначе у первого в списке полоска полная всегда.
  const maxActive = Math.max(WORKLOAD_FULL_LOAD, ...people.map((person) => person.active));

  return (
    <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 font-medium">Человек</th>
            <th className="pb-2 text-right font-medium">Загрузка</th>
            <th className="pb-2 text-right font-medium">В работе</th>
            <th className="pb-2 text-right font-medium">На тесте</th>
            <th className="pb-2 text-right font-medium">Просрочено</th>
            <th className="pb-2 text-right font-medium">Ждёт</th>
            <th className="pb-2 text-right font-medium">Закрыл</th>
            <th className="pb-2 text-right font-medium">Цикл</th>
            <th className="pb-2 text-right font-medium">Возвраты</th>
            <th className="pb-2 text-right font-medium">Поставил</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.user.id} className="border-b border-border/60 last:border-0">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar user={person.user} size="xs" />
                  <span className="min-w-0 truncate">{person.user.displayName}</span>
                </span>
              </td>
              <td className="py-2 text-right">
                <span className="flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-secondary sm:block">
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        person.active / maxActive > 0.8
                          ? 'bg-destructive'
                          : person.active / maxActive > 0.5
                            ? 'bg-warning'
                            : 'bg-success',
                      )}
                      style={{ width: `${(person.active / maxActive) * 100}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{person.active}</span>
                </span>
              </td>
              <Cell value={person.inProgress} />
              <Cell value={person.qa} />
              <Cell value={person.overdue} tone={person.overdue > 0 ? 'danger' : undefined} />
              <Cell value={person.blocked} tone={person.blocked > 0 ? 'warning' : undefined} />
              <Cell value={person.completed} tone={person.completed > 0 ? 'success' : undefined} />
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {person.medianCycleDays > 0 ? `${formatNumber(person.medianCycleDays)} дн` : '—'}
              </td>
              <Cell value={person.returned} tone={person.returned > 0 ? 'warning' : undefined} />
              <Cell value={person.reported} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  value,
  tone,
}: {
  value: number;
  tone?: 'danger' | 'warning' | 'success';
}): React.ReactElement {
  return (
    <td
      className={cn(
        'py-2 text-right tabular-nums',
        value === 0
          ? 'text-muted-foreground'
          : tone === 'danger'
            ? 'font-medium text-destructive'
            : tone === 'warning'
              ? 'font-medium text-warning'
              : tone === 'success'
                ? 'text-success'
                : 'text-foreground',
      )}
    >
      {value === 0 ? '—' : value}
    </td>
  );
}

function overdueBy(dueDate: string): string {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
  if (days < 1) return 'сегодня';
  return `на ${days} дн`;
}
