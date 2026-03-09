import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { TodoItem, TodoPriority } from '../core/models/todo.model';

export const TodoActions = createActionGroup({
  source: 'Todo',
  events: {
    'Load': emptyProps(),
    'Load Success': props<{ items: TodoItem[] }>(),
    'Add': props<{ title: string; priority: TodoPriority; dayKey: string }>(),
    'Toggle': props<{ id: string }>(),
    'Rename': props<{ id: string; title?: string; priority?: TodoPriority }>(),
    'Delete': props<{ id: string }>(),
    'Reorder': props<{ dayKey: string; orderedIds: string[] }>(),
    'Operation Success': emptyProps(),
  }
});


