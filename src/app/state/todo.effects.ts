import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, switchMap, tap } from 'rxjs/operators';
import { from } from 'rxjs';
import { TodoActions } from './todo.actions';
import { EventSourcingService } from '../core/services/event-sourcing.service';
import { SyncService } from '../core/services/sync.service';
import { TabRealtimeService } from '../core/services/tab-realtime.service';

@Injectable()
export class TodoEffects {
  private actions$ = inject(Actions);
  private es = inject(EventSourcingService);
  private sync = inject(SyncService);
  private tabRealtime = inject(TabRealtimeService);

  load$ = createEffect(() => this.actions$.pipe(
    ofType(TodoActions.load, TodoActions.operationSuccess),
    switchMap(() => from(this.es.getAllTodos()).pipe(map(items => TodoActions.loadSuccess({ items }))))
  ));

  add$ = createEffect(() => this.actions$.pipe(
    ofType(TodoActions.add),
    switchMap(({ title, priority, dayKey }) => from(this.es.append({ type: 'TODO_CREATED', todoId: crypto.randomUUID(), payload: { title, priority, dayKey } }))),
    tap(() => {
      this.tabRealtime.notifyChanged();
      void this.sync.sync();
    }),
    map(() => TodoActions.operationSuccess())
  ));

  toggle$ = createEffect(() => this.actions$.pipe(
    ofType(TodoActions.toggle),
    switchMap(({ id }) => from(this.es.append({ type: 'TODO_TOGGLED', todoId: id }))),
    tap(() => {
      this.tabRealtime.notifyChanged();
      void this.sync.sync();
    }),
    map(() => TodoActions.operationSuccess())
  ));

  rename$ = createEffect(() => this.actions$.pipe(
    ofType(TodoActions.rename),
    switchMap(({ id, title, priority }) => from(this.es.append({ type: 'TODO_RENAMED', todoId: id, payload: { title, priority } }))),
    tap(() => {
      this.tabRealtime.notifyChanged();
      void this.sync.sync();
    }),
    map(() => TodoActions.operationSuccess())
  ));

  delete$ = createEffect(() => this.actions$.pipe(
    ofType(TodoActions.delete),
    switchMap(({ id }) => from(this.es.append({ type: 'TODO_DELETED', todoId: id }))),
    tap(() => {
      this.tabRealtime.notifyChanged();
      void this.sync.sync();
    }),
    map(() => TodoActions.operationSuccess())
  ));
}
