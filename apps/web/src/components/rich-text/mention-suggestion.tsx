import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import * as React from 'react';
import type { PublicUser } from '@kaif/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Выпадающий список для упоминаний `@`.
 *
 * Позиционируется вручную, без tippy: одна зависимость меньше,
 * а поведение полностью под контролем (в том числе на мобильных).
 */

export interface MentionListProps {
  items: PublicUser[];
  command: (item: { id: string; label: string }) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const MentionList = React.forwardRef<MentionListRef, MentionListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  React.useEffect(() => setSelectedIndex(0), [props.items]);

  const selectItem = (index: number): void => {
    const item = props.items[index];
    if (item) props.command({ id: item.id, label: item.displayName });
  };

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((index) => (index + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((index) => (index + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="glass-floating rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground shadow-popover">
        Никого не найдено
      </div>
    );
  }

  return (
    <div className="glass-floating scrollbar-thin max-h-64 w-64 overflow-y-auto rounded-lg border border-border p-1 shadow-popover">
      {props.items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            selectItem(index);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            index === selectedIndex ? 'bg-secondary' : 'hover:bg-secondary/60',
          )}
        >
          <UserAvatar user={item} size="sm" />
          <span className="min-w-0 flex-1 truncate">{item.displayName}</span>
          {item.tgUsername && (
            <span className="truncate text-xs text-muted-foreground">@{item.tgUsername}</span>
          )}
        </button>
      ))}
    </div>
  );
});
MentionList.displayName = 'MentionList';

export function createMentionSuggestion(
  getUsers: () => PublicUser[],
): Omit<SuggestionOptions<PublicUser>, 'editor'> {
  return {
    char: '@',
    allowSpaces: false,
    startOfLine: false,

    items: ({ query }) => {
      const needle = query.toLowerCase();
      return getUsers()
        .filter(
          (user) =>
            user.displayName.toLowerCase().includes(needle) ||
            (user.tgUsername ?? '').toLowerCase().includes(needle),
        )
        .slice(0, 8);
    },

    render: () => {
      let component: ReactRenderer<MentionListRef, MentionListProps> | null = null;
      let container: HTMLDivElement | null = null;

      const position = (clientRect: (() => DOMRect | null) | null | undefined): void => {
        if (!container || !clientRect) return;
        const rect = clientRect();
        if (!rect) return;

        container.style.position = 'absolute';
        container.style.zIndex = '60';

        // Показываем список над курсором, если снизу не помещается.
        const spaceBelow = window.innerHeight - rect.bottom;
        const preferAbove = spaceBelow < 280;
        const top = preferAbove ? rect.top + window.scrollY - 8 : rect.bottom + window.scrollY + 6;

        container.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 280)}px`;
        container.style.top = `${top}px`;
        container.style.transform = preferAbove ? 'translateY(-100%)' : 'none';
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });

          container = document.createElement('div');
          container.appendChild(component.element);
          document.body.appendChild(container);
          position(props.clientRect);
        },

        onUpdate: (props) => {
          component?.updateProps({ items: props.items, command: props.command });
          position(props.clientRect);
        },

        onKeyDown: (props) => {
          if (props.event.key === 'Escape') return true;
          return component?.ref?.onKeyDown({ event: props.event }) ?? false;
        },

        onExit: () => {
          container?.remove();
          component?.destroy();
          container = null;
          component = null;
        },
      };
    },
  };
}
