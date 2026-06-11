import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { BookmarksPage } from './features/bookmarks/BookmarksPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { PostDetailPage } from './features/post/PostDetailPage';
import { FollowListPage } from './features/profile/FollowListPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { SearchPage } from './features/search/SearchPage';
import { HomePage } from './features/timeline/HomePage';
import { WorldsPage } from './features/worlds/WorldsPage';
import { I18nProvider } from './i18n/I18nContext';
import { useWorld, WorldProvider } from './world/WorldContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Shell() {
  const { ready } = useWorld();
  if (!ready) return null;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/post/:id" element={<PostDetailPage />} />
              <Route path="/u/:handle" element={<ProfilePage />} />
              <Route path="/u/:handle/followers" element={<FollowListPage direction="followers" />} />
              <Route path="/u/:handle/following" element={<FollowListPage direction="following" />} />
              <Route
                path="/notifications"
                element={
                  <RequireAuth>
                    <NotificationsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/bookmarks"
                element={
                  <RequireAuth>
                    <BookmarksPage />
                  </RequireAuth>
                }
              />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/worlds" element={<WorldsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

function Providers() {
  const { world } = useWorld();
  return (
    <I18nProvider defaultLocale={world?.meta.locale ?? 'zh-CN'}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorldProvider>
        <Providers />
      </WorldProvider>
    </QueryClientProvider>
  );
}
