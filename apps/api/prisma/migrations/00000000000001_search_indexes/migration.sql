-- Ускорение поиска по подстроке.
-- Обычный B-tree индекс не помогает запросам вида `LIKE '%текст%'`,
-- поэтому включаем расширение pg_trgm и строим GIN-индексы по searchText.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Task_searchText_trgm_idx"
  ON "Task" USING GIN ("searchText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_displayName_trgm_idx"
  ON "User" USING GIN (lower("displayName") gin_trgm_ops);

-- Частый запрос доски: активные задачи колонки в порядке ранга.
CREATE INDEX IF NOT EXISTS "Task_board_active_idx"
  ON "Task" ("boardId", "columnKey", "rank")
  WHERE "archivedAt" IS NULL AND "isBacklog" = false;

-- Непрочитанные уведомления пользователя.
CREATE INDEX IF NOT EXISTS "Notification_unread_idx"
  ON "Notification" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;
