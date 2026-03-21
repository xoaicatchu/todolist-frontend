import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TodoState } from './todo.reducer';

export const selectTodoState = createFeatureSelector<TodoState>('todo');
export const selectTodos = createSelector(selectTodoState, s =>
  s.items.filter(i => !i.deleted).sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey);
    const ao = a.sortOrder ?? 1;
    const bo = b.sortOrder ?? 1;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  })
);
export const selectOnline = () => navigator.onLine;
