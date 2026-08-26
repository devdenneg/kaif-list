import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ColumnKey, TaskPriority, TaskType } from '@kaif/shared';

export type Theme = 'light' | 'dark' | 'system';
export type Swimlane = 'none' | 'assignee' | 'priority' | 'type';

export interface BoardFilters {
  search: string;
  assigneeIds: string[];
  /** Рабочие группы: показываем задачи их участников. */
  groupIds: string[];
  labelIds: string[];
  priorities: TaskPriority[];
  types: TaskType[];
  due: 'any' | 'overdue' | 'today' | 'week' | 'none' | 'has';
  unassigned: boolean;
  /** Показывать задачи из архива вместе с активными. */
  includeArchived: boolean;
}

/**
 * Стабильная ссылка на пустой список свёрнутых колонок.
 *
 * Селектор Zustand обязан возвращать одно и то же значение при одинаковом
 * состоянии: под капотом `useSyncExternalStore`, и свежий литерал `[]`
 * на каждом вызове читается как «состояние изменилось» — приложение
 * уходит в бесконечную перерисовку.
 */
export const NO_COLLAPSED_COLUMNS: ColumnKey[] = [];

export const EMPTY_FILTERS: BoardFilters = {
  search: '',
  assigneeIds: [],
  groupIds: [],
  labelIds: [],
  priorities: [],
  types: [],
  due: 'any',
  unassigned: false,
  includeArchived: false,
};

interface UiState {
  theme: Theme;
  setTheme: (theme: Theme) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Фильтры хранятся по доскам: переключение между досками не сбрасывает их. */
  filters: Record<string, BoardFilters>;
  setFilters: (boardId: string, filters: Partial<BoardFilters>) => void;
  resetFilters: (boardId: string) => void;

  /** Группировка хранится отдельно для каждой доски. */
  swimlanes: Record<string, Swimlane>;
  setSwimlane: (boardId: string, swimlane: Swimlane) => void;

  collapsedColumns: Record<string, ColumnKey[]>;
  toggleColumn: (boardId: string, column: ColumnKey) => void;

  /** Последняя открытая доска — на неё ведём с главной. */
  lastBoardId: string | null;
  setLastBoardId: (boardId: string | null) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      sidebarCollapsed: false,
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

      filters: {},
      setFilters: (boardId, patch) =>
        set({
          filters: {
            ...get().filters,
            [boardId]: { ...EMPTY_FILTERS, ...get().filters[boardId], ...patch },
          },
        }),
      resetFilters: (boardId) =>
        set({ filters: { ...get().filters, [boardId]: { ...EMPTY_FILTERS } } }),

      swimlanes: {},
      setSwimlane: (boardId, swimlane) =>
        set({ swimlanes: { ...get().swimlanes, [boardId]: swimlane } }),

      collapsedColumns: {},
      toggleColumn: (boardId, column) => {
        const current = get().collapsedColumns[boardId] ?? [];
        const next = current.includes(column)
          ? current.filter((key) => key !== column)
          : [...current, column];
        set({ collapsedColumns: { ...get().collapsedColumns, [boardId]: next } });
      },

      lastBoardId: null,
      setLastBoardId: (boardId) => set({ lastBoardId: boardId }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'kaif-ui',
      /**
       * Фильтры лежат в localStorage с прошлых версий и могут не знать
       * о новых полях. Достраиваем их до полного набора при загрузке:
       * иначе первое же обращение к `filters.groupIds.length` роняет
       * приложение белым экраном у тех, кто уже пользовался доской.
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState> & { swimlane?: Swimlane };
        const { swimlane: legacySwimlane, ...savedWithoutLegacy } = saved;
        return {
          ...current,
          ...savedWithoutLegacy,
          filters: normalizeStoredFilters(saved.filters),
          swimlanes: normalizeStoredSwimlanes(saved.swimlanes, legacySwimlane, saved.lastBoardId),
        };
      },
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        filters: state.filters,
        swimlanes: state.swimlanes,
        collapsedColumns: state.collapsedColumns,
        lastBoardId: state.lastBoardId,
      }),
    },
  ),
);

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', dark);
  try {
    localStorage.setItem(
      'kaif-theme',
      theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme,
    );
  } catch {
    /* приватный режим */
  }
}

/**
 * Достраивает сохранённые наборы фильтров до текущего набора полей.
 * Вынесено отдельно, чтобы это можно было проверить тестом без браузера.
 */
export function normalizeStoredFilters(
  stored: Record<string, Partial<BoardFilters>> | undefined,
): Record<string, BoardFilters> {
  return Object.fromEntries(
    Object.entries(stored ?? {}).map(([boardId, filters]) => [
      boardId,
      { ...EMPTY_FILTERS, ...filters },
    ]),
  );
}

/**
 * Проверяет сохранённые группировки и переносит старое глобальное значение
 * только на последнюю открытую доску. Так обновление не меняет вид всех досок.
 */
export function normalizeStoredSwimlanes(
  stored: Record<string, Swimlane> | undefined,
  legacy: Swimlane | undefined,
  lastBoardId: string | null | undefined,
): Record<string, Swimlane> {
  const allowed = new Set<Swimlane>(['none', 'assignee', 'priority', 'type']);
  const normalized = Object.fromEntries(
    Object.entries(stored ?? {}).filter((entry): entry is [string, Swimlane] =>
      allowed.has(entry[1]),
    ),
  );

  if (lastBoardId && legacy && allowed.has(legacy) && normalized[lastBoardId] === undefined) {
    normalized[lastBoardId] = legacy;
  }

  return normalized;
}

export function useBoardFilters(boardId: string): BoardFilters {
  return useUiStore((state) => state.filters[boardId] ?? EMPTY_FILTERS);
}

export function useBoardSwimlane(boardId: string): Swimlane {
  return useUiStore((state) => state.swimlanes[boardId] ?? 'none');
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.assigneeIds.length > 0 ||
    filters.groupIds.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.priorities.length > 0 ||
    filters.types.length > 0 ||
    filters.due !== 'any' ||
    filters.unassigned ||
    filters.includeArchived
  );
}
