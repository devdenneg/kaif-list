import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, ListTodo, PenLine, TestTube2 } from 'lucide-react';
import { useMyTasks } from '@/api/tasks';
import { useAuthStore } from '@/stores/auth';
import { EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { TaskCard } from '@/features/board/task-card';

type Scope = 'active' | 'today' | 'overdue' | 'reported' | 'testing' | 'done';

const TABS: { value: Scope; label: string; icon: React.ReactNode }[] = [
  { value: 'active', label: 'В работе', icon: <ListTodo /> },
  { value: 'today', label: 'Сегодня', icon: <CalendarDays /> },
  { value: 'overdue', label: 'Просрочено', icon: <AlertTriangle /> },
  { value: 'testing', label: 'На тесте', icon: <TestTube2 /> },
  { value: 'reported', label: 'Мои задачи', icon: <PenLine /> },
  { value: 'done', label: 'Завершённые', icon: <CheckCircle2 /> },
];

/** Сквозной список задач по всем доскам — «что у меня сегодня». */
export function MyTasksPage(): React.ReactElement {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [scope, setScope] = React.useState<Scope>('active');
  const { data: tasks, isLoading } = useMyTasks(scope);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Мои задачи</h1>
        <p className="text-sm text-muted-foreground">
          По всем доскам, к которым у вас есть доступ
        </p>
      </header>

      <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="shrink-0">
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={emptyTitle(scope)}
          description={emptyDescription(scope)}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(tasks ?? []).map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={() => navigate(`/tasks/${task.key}`)}
              {...(user?.timezone ? { timeZone: user.timezone } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function emptyTitle(scope: Scope): string {
  switch (scope) {
    case 'overdue':
      return 'Просроченных задач нет';
    case 'today':
      return 'На сегодня ничего не горит';
    case 'testing':
      return 'Нечего тестировать';
    case 'reported':
      return 'Вы пока не создавали задач';
    case 'done':
      return 'Завершённых задач нет';
    default:
      return 'Активных задач нет';
  }
}

function emptyDescription(scope: Scope): string {
  switch (scope) {
    case 'overdue':
      return 'Отличная работа — всё в срок.';
    case 'today':
      return 'Можно взять что-нибудь из бэклога.';
    default:
      return 'Как только на вас назначат задачу, она появится здесь.';
  }
}
