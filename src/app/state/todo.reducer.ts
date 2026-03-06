import { createReducer, on } from '@ngrx/store';
import { TodoItem } from '../core/models/todo.model';
import { TodoActions } from './todo.actions';

export interface TodoState {
  items: TodoItem[];
}

export const initialTodoState: TodoState = { items: [] };

export const todoReducer = createReducer(
  initialTodoState,
  on(TodoActions.loadSuccess, (state, { items }) => ({ ...state, items }))
);
