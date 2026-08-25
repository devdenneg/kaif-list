import * as React from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { AppShell } from '@/app/app-shell';
import { FullScreenLoader } from '@/app/loader';
import { LoginPage } from '@/features/auth/login-page';
import { RouteError } from '@/app/route-error';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { OnboardingPage } from '@/features/auth/onboarding-page';

const BoardsPage = lazyWithRetry('boards/boards-page', () =>
  import('@/features/boards/boards-page').then((m) => ({ default: m.BoardsPage })),
);
const BoardPage = lazyWithRetry('board/board-page', () =>
  import('@/features/board/board-page').then((m) => ({ default: m.BoardPage })),
);
const BacklogPage = lazyWithRetry('backlog/backlog-page', () =>
  import('@/features/backlog/backlog-page').then((m) => ({ default: m.BacklogPage })),
);
const PeoplePage = lazyWithRetry('people/people-page', () =>
  import('@/features/people/people-page').then((m) => ({ default: m.PeoplePage })),
);
const DashboardPage = lazyWithRetry('dashboard/dashboard-page', () =>
  import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const MyTasksPage = lazyWithRetry('my-tasks/my-tasks-page', () =>
  import('@/features/my-tasks/my-tasks-page').then((m) => ({ default: m.MyTasksPage })),
);
const TaskPage = lazyWithRetry('task/task-page', () =>
  import('@/features/task/task-page').then((m) => ({ default: m.TaskPage })),
);
const NotificationsPage = lazyWithRetry('notifications/notifications-page', () =>
  import('@/features/notifications/notifications-page').then((m) => ({ default: m.NotificationsPage })),
);
const SettingsPage = lazyWithRetry('settings/settings-page', () =>
  import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })),
);
const ArchivePage = lazyWithRetry('archive/archive-page', () =>
  import('@/features/archive/archive-page').then((m) => ({ default: m.ArchivePage })),
);
const InvitePage = lazyWithRetry('board/invite-page', () =>
  import('@/features/board/invite-page').then((m) => ({ default: m.InvitePage })),
);
const AdminPage = lazyWithRetry('admin/admin-page', () =>
  import('@/features/admin/admin-page').then((m) => ({ default: m.AdminPage })),
);

/** Пускает дальше только авторизованных с завершённым профилем. */
function ProtectedRoute(): React.ReactElement {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // Без имени и аватара пользоваться доской нельзя — это требование продукта.
  // Приглашение не должно потеряться, пока человек заполняет профиль.
  if (user && !user.profileCompleted) {
    return (
      <Navigate to="/onboarding" replace state={{ from: location.pathname + location.search }} />
    );
  }

  return (
    <AppShell>
      <React.Suspense fallback={<FullScreenLoader inline />}>
        <Outlet />
      </React.Suspense>
    </AppShell>
  );
}

function AdminRoute(): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  if (user?.globalRole !== 'SUPERADMIN') return <Navigate to="/boards" replace />;
  return <Outlet />;
}

function PublicOnlyRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') {
    return <Navigate to={user?.profileCompleted ? '/boards' : '/onboarding'} replace />;
  }
  return children;
}

function OnboardingRoute(): React.ReactElement {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (user?.profileCompleted) return <Navigate to="/boards" replace />;
  return <OnboardingPage />;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
    errorElement: <RouteError />,
  },
  { path: '/onboarding', element: <OnboardingRoute />, errorElement: <RouteError /> },
  {
    element: <ProtectedRoute />,
    // Ошибка внутри любой страницы показывается в оболочке приложения:
    // навигация остаётся на месте, и человек может уйти на рабочий экран.
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Navigate to="/boards" replace /> },
      { path: '/boards', element: <BoardsPage /> },
      { path: '/boards/:boardKey', element: <BoardPage /> },
      { path: '/boards/:boardKey/backlog', element: <BacklogPage /> },
      { path: '/boards/:boardKey/people', element: <PeoplePage /> },
      { path: '/boards/:boardKey/dashboard', element: <DashboardPage /> },
      { path: '/boards/:boardKey/archive', element: <ArchivePage /> },
      { path: '/invite/:token', element: <InvitePage /> },
      { path: '/tasks/:taskKey', element: <TaskPage /> },
      { path: '/my', element: <MyTasksPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      {
        element: <AdminRoute />,
        children: [{ path: '/admin', element: <AdminPage /> }],
      },
      { path: '*', element: <Navigate to="/boards" replace /> },
    ],
  },
]);
