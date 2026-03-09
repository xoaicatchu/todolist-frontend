import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import { TodoEvent, TodoItem } from '../../core/models/todo.model';

@Injectable({ providedIn: 'root' })
export class AppDbService extends Dexie {
  todos!: Table<TodoItem, string>;
  events!: Table<TodoEvent, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super('todolist-offline-db');

    this.version(1).stores({
      todos: 'id, updatedAt, completed, deleted',
      events: 'eventId, synced, createdAt, todoId, type',
      meta: 'key'
    });

    this.version(2).stores({
      todos: 'id, dayKey, sortOrder, updatedAt, completed, deleted',
      events: 'eventId, synced, createdAt, todoId, type',
      meta: 'key'
    });

    // Large dataset optimization: query by dayKey/updatedAt/deleted faster.
    this.version(3).stores({
      todos: 'id, dayKey, sortOrder, updatedAt, completed, deleted, [dayKey+updatedAt], [deleted+updatedAt]',
      events: 'eventId, synced, createdAt, todoId, type',
      meta: 'key'
    });
  }
}
