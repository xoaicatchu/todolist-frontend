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
  }
}
