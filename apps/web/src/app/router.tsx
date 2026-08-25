import * as React from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { AppShell } from '@/app/app-shell';
import { FullScreenLoader } from '@/app/loader';
import { LoginPage } from '@/features/auth/login-page';
import { OnboardingPage } from '@/features/auth/onboarding-page';

const BoardsPage = React.lazy(() =>
  import('@/features/boards/boards-page').then((m) => ({ default: m.BoardsPage })),
);
const BoardPage = React.lazy(() =>
  import('@/features/board/board-page').then((m) => ({ default: m.BoardPage })),
);
const BacklogPage = React.lazy(() =>
  import('@/features/backlog/backlog-page').then((m) => ({ default: m.BacklogPage })),
);
const PeoplePage = React.lazy(() =>
  import('@/features/people/people-page').then((m) => ({ default: m.PeoplePage })),
);
const DashboardPage = React.lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const MyTasksPage = React.lazy(() =>
  import('@/features/my-tasks/my-tasks-page').then((m) => ({ default: m.MyTasksPage })),
);
const TaskPage = React.lazy(() =>
  import('@/features/task/task-page').then((m) => ({ default: m.TaskPage })),
);
const NotificationsPage = React.lazy(() =>
  import('@/features/notifications/notifications-page').then((m) => ({
    default: m.NotificationsPage,
  })),
);
const SettingsPage = React.lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })),
);
const AdminPage = React.lazy(() =>
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
  if (user && !user.profileCompleted) return <Navigate to="/onboarding" replace />;

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
  },
  { path: '/onboarding', element: <OnboardingRoute /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/', element: <Navigate to="/boards" replace /> },
      { path: '/boards', element: <BoardsPage /> },
      { path: '/boards/:boardKey', element: <BoardPage /> },
      { path: '/boards/:boardKey/backlog', element: <BacklogPage /> },
      { path: '/boards/:boardKey/people', element: <PeoplePage /> },
      { path: '/boards/:boardKey/dashboard', element: <DashboardPage /> },
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
