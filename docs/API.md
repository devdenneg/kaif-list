# HTTP API и реалтайм

Базовый адрес — тот же домен, что и у интерфейса: `https://<домен>/api`.

**Авторизация.** Все ручки, кроме входа и файловых, требуют заголовок
`Authorization: Bearer <access-токен>`. Токен живёт 15 минут; клиент
обновляет его через `POST /api/auth/refresh` (по refresh-cookie).

**Формат ошибки** — всегда одинаковый:

```json
{
  "error": {
    "code": "REASON_REQUIRED",
    "message": "Задача возвращается назад — напишите, что не так.",
    "fields": { "title": "Минимум 3 символа" },
    "reasonRequired": { "code": "MOVE_BACKWARD", "message": "…" },
    "requestId": "0f3c…"
  }
}
```

| Код HTTP | Когда |
|---|---|
| 400 | Некорректный запрос или ошибка валидации (`fields`) |
| 401 | Нет токена, истёк или сессия отозвана |
| 403 | Недостаточно прав, доска в архиве, профиль не заполнен |
| 404 | Не найдено (в том числе «нет доступа к доске» — намеренно) |
| 409 | Конфликт: дубликат, лимит WIP, задача заблокирована |
| 413 | Файл слишком большой |
| **422** | **Требуется письменное объяснение** — см. `reasonRequired` |
| 429 | Превышен лимит частоты запросов |

---

## Авторизация · `/api/auth`

| Метод | Путь | Описание |
|---|---|---|
| POST | `/telegram/login-code` | Выдать одноразовый код и ссылку на бота |
| GET | `/telegram/login-code/:code/status` | Статус кода: `PENDING` / `APPROVED` / `CONSUMED` / `EXPIRED` |
| POST | `/telegram/exchange` | Обменять подтверждённый код на токены |
| POST | `/telegram/widget` | Вход через Telegram Login Widget |
| POST | `/telegram/mini-app` | Вход из Telegram Mini App (`initData`) |
| POST | `/refresh` | Обновить пару токенов (ротация + защита от повтора) |
| POST | `/logout` | Завершить текущую сессию |
| POST | `/logout-all` | Завершить все сессии |
| GET | `/me` | Текущий пользователь |
| POST | `/profile` | Завершить онбординг: имя и аватар |
| GET | `/sessions` | Активные сессии |
| DELETE | `/sessions/:id` | Завершить конкретную сессию |

---

## Пользователи · `/api/users`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/?boardId=` | Люди на конкретной доске (для назначения и упоминаний). `boardId` обязателен: общий список всех зарегистрированных наружу не отдаётся |
| PATCH | `/me` | Имя, аватар, часовой пояс, язык |
| POST | `/me/avatar` | Загрузить аватар (multipart) |
| GET | `/me/notifications-settings` | Настройки уведомлений |
| PATCH | `/me/notifications-settings` | Изменить настройки |
| GET | `/me/tasks?scope=` | Мои задачи по всем доскам: `active`, `today`, `overdue`, `reported`, `testing`, `done` |

---

## Доски · `/api/boards`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/` | Список доступных досок |
| POST | `/` | Создать доску (автор становится владельцем) |
| GET | `/:boardId` | Доска целиком: колонки, метки, участники, настройки |
| PATCH | `/:boardId` | Название, описание, цвет, правила |
| POST | `/:boardId/archive` | В архив и обратно |
| DELETE | `/:boardId` | Удалить (нужен `confirm` с ключом доски) |
| POST | `/:boardId/transfer-ownership` | Передать владение |
| POST | `/:boardId/favorite` | В избранное |
| GET | `/:boardId/members` | Участники |
| POST | `/:boardId/members` | Добавить участника |
| PATCH | `/:boardId/members/:userId` | Изменить роль |
| DELETE | `/:boardId/members/:userId` | Исключить (или выйти самому) |
| GET | `/:boardId/workload` | Загрузка участников |
| GET | `/:boardId/invites` | Действующие пригласительные ссылки |
| POST | `/:boardId/invites` | Создать ссылку (`role`, `expiresInDays`, `maxUses`) |
| DELETE | `/:boardId/invites/:inviteId` | Отозвать ссылку |
| GET · POST | `/:boardId/groups` | Рабочие группы: список и создание |
| PATCH · DELETE | `/:boardId/groups/:groupId` | Название, цвет, порядок / удалить |
| PUT | `/:boardId/groups/:groupId/members` | Задать состав группы целиком |
| POST | `/:boardId/labels` · PATCH `/labels/:labelId` · DELETE | Метки |
| PATCH | `/:boardId/columns/:columnKey` | Название колонки и WIP-лимит |
| GET | `/:boardId/tasks` | **Канбан**: задачи, сгруппированные по колонкам |
| GET | `/:boardId/tasks/list` | Плоский список с фильтрами и пагинацией |
| POST | `/:boardId/tasks` | Создать задачу |
| POST | `/:boardId/tasks/bulk` | Массовые операции над бэклогом |
| GET | `/:boardId/analytics?days=30` | Метрики доски |
| GET | `/:boardId/activity` | Лента активности |
| GET · POST | `/:boardId/views` | Сохранённые наборы фильтров |
| PATCH · DELETE | `/:boardId/views/:viewId` | Изменить / удалить фильтр |

`:boardId` принимает и id, и ключ доски (`OPS`).

**Фильтры задач** (query): `search`, `assigneeIds`, `unassigned`, `reporterIds`,
`testerIds`, `groupIds`, `labelIds`, `priorities`, `types`, `columns`, `due`
(`overdue|today|week|has|none`), `includeArchived`, `onlyBacklog`, `sort`, `order`,
`cursor`, `limit`. Списки принимаются и через запятую, и повторяющимся параметром.
Фильтры складываются друг с другом (`AND`), а `assigneeIds`, `groupIds`
и `unassigned` внутри себя объединяются по `ИЛИ`: группа разворачивается
в список её участников.

---

## Приглашения · `/api/invites`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/:token` | Что за доска и кто зовёт (нужна авторизация) |
| POST | `/:token/accept` | Вступить в доску по ссылке |

Ссылка — единственный способ попасть в чужую доску: справочник всех
зарегистрированных людей наружу не отдаётся. Токен живёт ограниченное время,
имеет лимит входов и отзывается владельцем.

---

## Задачи · `/api/tasks`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/:taskId` | Задача целиком (принимает id или ключ `OPS-12`) |
| PATCH | `/:taskId` | Изменить поля. **Может вернуть 422 `REASON_REQUIRED`** |
| POST | `/:taskId/move` | Перенести между колонками. **Может вернуть 422** |
| POST | `/:taskId/archive` | В архив и обратно |
| DELETE | `/:taskId` | Удалить (нужен `confirm` с ключом задачи) |
| POST | `/:taskId/watch` | Следить / не следить |
| POST | `/:taskId/duplicate` | Дублировать задачу (можно сразу несколько копий) |
| GET · POST | `/:taskId/comments` | Комментарии |
| GET | `/:taskId/comments/:commentId/replies` | Ответы в треде |
| PATCH · DELETE | `/:taskId/comments/:commentId` | Изменить / удалить свой комментарий |
| POST | `/:taskId/comments/:commentId/reactions` | Поставить или снять реакцию |
| POST | `/:taskId/checklists` · DELETE `/checklists/:id` | Чек-листы |
| POST | `/:taskId/checklists/:checklistId/items` | Добавить пункт |
| PATCH · DELETE | `/:taskId/checklist-items/:itemId` | Изменить / удалить пункт |
| POST | `/:taskId/links` · DELETE `/links/:linkId` | Связи между задачами |
| GET | `/:taskId/activity` | История задачи |
| POST | `/:taskId/attachments` | Загрузить файлы (multipart) |

### Перенос задачи

```http
POST /api/tasks/clx123/move
{
  "toColumn": "IN_PROGRESS",
  "beforeTaskId": "clx456",   // задача, ПЕРЕД которой встаём
  "afterTaskId": null,        // задача, ПОСЛЕ которой встаём
  "reason": "…"               // если сервер потребует
}
```

Сервер сам вычисляет дробный ранг между соседями, поэтому одновременное
перетаскивание разными людьми не приводит к конфликтам.

### Обязательное объяснение

Если перенос назад, пауза или изменение дедлайна требуют причины,
сервер отвечает **422**:

```json
{
  "error": {
    "code": "REASON_REQUIRED",
    "message": "Задача возвращается назад — напишите, что не так.",
    "reasonRequired": { "code": "MOVE_BACKWARD", "message": "…" }
  }
}
```

Клиент показывает окно ввода и повторяет тот же запрос с полем `reason`
(минимум 10 символов). Причина сохраняется системным комментарием
в задаче и уходит участникам в Telegram.

Коды причин: `MOVE_ON_HOLD`, `MOVE_BACKWARD`, `DUE_DATE_CHANGED`, `ASSIGNEE_CHANGED`.

---

## Комментарии, файлы, уведомления, поиск

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/attachments` | Загрузка до привязки к задаче (например, картинка в редакторе) |
| GET | `/api/attachments/:id` | Скачать (Bearer-токен **или** подпись `?t=`) |
| GET | `/api/attachments/:id/thumb` | Превью изображения |
| DELETE | `/api/attachments/:id` | Удалить файл |
| GET | `/api/files/avatars/:name` | Аватар (без авторизации, имя неугадываемое) |
| GET | `/api/notifications` | Список уведомлений |
| GET | `/api/notifications/unread-count` | Счётчик непрочитанных |
| POST | `/api/notifications/read` | Отметить прочитанными |
| GET | `/api/search?q=` | Сквозной поиск: задачи, доски, люди |

---

## Администрирование · `/api/admin`

Только для глобальной роли `SUPERADMIN`.

| Метод | Путь | Описание |
|---|---|---|
| GET | `/stats` | Сводка по системе |
| GET | `/users` | Все пользователи |
| PATCH | `/users/:userId/role` | Выдать или снять суперадмина |
| PATCH | `/users/:userId/active` | Отключить сотрудника, переназначить его задачи |
| GET | `/boards` | Все доски |
| GET | `/backlog` | Глобальный банк задач |
| GET | `/security-events` | Журнал безопасности |
| GET | `/queues` | Состояние очереди уведомлений |

---

## Служебный API для бота · `/api/internal`

Требует заголовок `X-Internal-Secret`. Наружу не публикуется.

| Метод | Путь | Описание |
|---|---|---|
| POST | `/telegram/link` | `/start`: привязка аккаунта и подтверждение кода входа |
| GET | `/telegram/me` | Профиль по `chatId` |
| GET | `/telegram/boards` | Доски человека с ролью и числом задач на нём |
| GET | `/telegram/board-stats` | Сводка по доске (владелец и админы) |
| POST | `/telegram/task` | Создать задачу из чата |
| POST | `/telegram/assign-me` | Взять задачу на себя |
| GET | `/telegram/tasks` | Задачи для `/tasks`, `/today`, `/testing` |
| GET | `/telegram/task/:taskId` | Задача целиком |
| POST | `/telegram/comment` | Комментарий из чата |
| POST | `/telegram/move` | Быстрая смена статуса (правила соблюдаются) |
| GET · POST | `/telegram/prefs` | Настройки уведомлений |
| POST | `/telegram/logout` | Выход на всех устройствах |
| POST | `/telegram/blocked` | Отметить блокировку бота |

---

## Реалтайм (Socket.IO)

Подключение: `io('/', { auth: { token: <access-токен> } })`.

**Комнаты:** `user:<id>`, `board:<id>`, `task:<id>`.
Подписка на доску проверяет членство на сервере.

Клиент → сервер:

| Событие | Данные |
|---|---|
| `board:subscribe` · `board:unsubscribe` | `{ boardId }` |
| `task:subscribe` · `task:unsubscribe` | `{ taskId, boardId }` |
| `typing:start` · `typing:stop` | `{ taskId }` |

Сервер → клиент:

| Событие | Данные |
|---|---|
| `task:created` · `task:updated` · `task:deleted` | `{ boardId, taskId, actorId, fields? }` |
| `task:moved` | `{ boardId, taskId, fromColumn, toColumn, actorId, reason }` |
| `comment:created` · `comment:updated` · `comment:deleted` | `{ boardId, taskId, commentId, comment? }` |
| `attachment:changed` | `{ boardId, taskId, actorId }` |
| `board:updated` · `board:members:changed` | `{ boardId }` |
| `activity:created` | `{ boardId, taskId }` |
| `notification:new` | Уведомление целиком |
| `notification:count` | `{ unread }` |
| `presence:sync` | `{ boardId, users: [...] }` |
| `typing` | `{ taskId, userId, displayName, typing }` |

---

## Служебное

| Метод | Путь | Описание |
|---|---|---|
| GET | `/healthz` | Живость процесса |
| GET | `/readyz` | Готовность: проверяет базу и Redis |
