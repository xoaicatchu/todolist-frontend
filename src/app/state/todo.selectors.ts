import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TodoState } from './todo.reducer';

export const selectTodoState = createFeatureSelector<TodoState>('todo');
export const selectTodos = createSelector(selectTodoState, s => s.items.filter(i => !i.deleted));
export const selectOnline = () => navigator.onLine;
