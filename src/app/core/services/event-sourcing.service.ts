import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { liveQuery } from 'dexie';
import { AppDbService } from '../../infrastructure/db/app-db.service';
import { TodoEvent, TodoItem, TodoPriority } from '../models/todo.model';

const uuid = () => crypto.randomUUID();
const todayKey = () => new Date().toISOString().slice(0, 10);

@Injectable({ providedIn: 'root' })
export class EventSourcingService {
  constructor(private db: AppDbService) {}


  watchTodos(): Observable<TodoItem[]> {
    return new Observable<TodoItem[]>(subscriber => {
      const dexieObservable = liveQuery(() => this.db.todos.orderBy('updatedAt').reverse().toArray());
      const subscription = dexieObservable.subscribe({
        next: value => subscriber.next(value as TodoItem[]),
        error: err => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }

  async getAllTodos(): Promise<TodoItem[]> {
    const items = await this.db.todos.orderBy('updatedAt').reverse().toArray();

    const invalid = items.filter(x => !x.dayKey).map(x => x.id);
    if (invalid.length) {
      await this.db.todos.bulkDelete(invalid);
    }

    const cleaned = items.filter(x => !!x.dayKey);
    const needCreatedAt = cleaned.filter(x => !(x as any).createdAt);
    if (needCreatedAt.length) {
      const fixed = needCreatedAt.map(x => ({ ...x, createdAt: x.updatedAt || Date.now() }));
      await this.db.todos.bulkPut(fixed as any);
      return cleaned.map(x => ({ ...x, createdAt: (x as any).createdAt || x.updatedAt || Date.now() }));
    }

    return cleaned;
  }

  async append(event: Omit<TodoEvent, 'eventId' | 'createdAt' | 'synced'>): Promise<void> {
    const full: TodoEvent = {
      ...event,
      eventId: uuid(),
      createdAt: Date.now(),
      synced: 0,
    };

    await this.db.transaction('rw', this.db.todos, this.db.events, async () => {
      await this.db.events.add(full);
      await this.apply(full);
    });
  }

  async apply(event: TodoEvent): Promise<void> {
    const existing = await this.db.todos.get(event.todoId);
    const now = Date.now();

    switch (event.type) {
      case 'TODO_CREATED':
        await this.db.todos.put({
          id: event.todoId,
          title: event.payload?.title ?? '',
          priority: (event.payload?.priority as TodoPriority) ?? 'MEDIUM',
          dayKey: event.payload?.dayKey ?? todayKey(),
          completed: false,
          createdAt: now,
          updatedAt: now,
          deleted: false,
        });
        break;
      case 'TODO_TOGGLED':
        if (existing) {
          await this.db.todos.put({ ...existing, createdAt: existing.createdAt || existing.updatedAt || now, completed: !existing.completed, updatedAt: now });
        }
        break;
      case 'TODO_RENAMED':
        if (existing) {
          await this.db.todos.put({
            ...existing,
            createdAt: existing.createdAt || existing.updatedAt || now,
            title: event.payload?.title ?? existing.title,
            priority: (event.payload?.priority as TodoPriority) ?? existing.priority,
            updatedAt: now
          });
        }
        break;
      case 'TODO_DELETED':
        await this.db.todos.delete(event.todoId);
        break;
      case 'TODO_UPSERTED_FROM_SERVER':
        if (event.payload) {
          const incoming = event.payload as TodoItem;
          if (incoming.deleted) {
            await this.db.todos.delete(incoming.id);
            return;
          }
          if (!existing || incoming.updatedAt >= existing.updatedAt) {
            await this.db.todos.put({ ...incoming, dayKey: incoming.dayKey ?? todayKey(), createdAt: incoming.createdAt || incoming.updatedAt || now });
          }
        }
        break;
    }
  }

  async getUnsyncedEvents(): Promise<TodoEvent[]> {
    return this.db.events.where('synced').equals(0).sortBy('createdAt');
  }

  async markEventsSynced(eventIds: string[]): Promise<void> {
    await this.db.events.bulkGet(eventIds).then(async rows => {
      const updates = rows.filter(Boolean).map(e => ({ ...e!, synced: 1 as const }));
      if (updates.length) await this.db.events.bulkPut(updates);
    });
  }

  async applyServerTodos(items: TodoItem[]): Promise<void> {
    for (const item of items) {
      const e: TodoEvent = {
        eventId: uuid(),
        type: 'TODO_UPSERTED_FROM_SERVER',
        todoId: item.id,
        payload: item,
        createdAt: Date.now(),
        synced: 1,
      };
      await this.apply(e);
    }
  }
}
