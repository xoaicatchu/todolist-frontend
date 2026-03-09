import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppDbService } from '../../infrastructure/db/app-db.service';
import { EventSourcingService } from './event-sourcing.service';
import { NetworkService } from './network.service';
import { SyncApiService } from './sync-api.service';
import { TodoActions } from '../../state/todo.actions';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private syncRunning = false;
  private resyncRequested = false;
  private readonly pullLimit = 300;

  constructor(
    private db: AppDbService,
    private es: EventSourcingService,
    private network: NetworkService,
    private api: SyncApiService,
    private store: Store
  ) {
    // No polling. Sync only on realtime events / online events / user actions.
    window.addEventListener('online', () => this.sync());
  }

  async sync(): Promise<void> {
    if (!this.network.online()) return;

    if (this.syncRunning) {
      this.resyncRequested = true;
      return;
    }

    this.syncRunning = true;
    this.resyncRequested = false;

    try {
      const unsynced = await this.es.getUnsyncedEvents();
      if (unsynced.length) {
        const pushResult = await this.api.pushEvents(unsynced);
        await this.es.markEventsSynced(pushResult.acceptedEventIds);
      }

      let lastSyncAt = Number((await this.db.meta.get('lastSyncAt'))?.value ?? '0');
      let lastChangeId = Number((await this.db.meta.get('lastChangeId'))?.value ?? '0');
      let cursor: string | undefined = undefined;

      for (let guard = 0; guard < 100; guard++) {
        const pull = await this.api.pullIncremental({
          sinceChangeId: lastChangeId,
          lastSyncAt,
          limit: this.pullLimit,
          cursor,
        });

        if (pull.todos.length) {
          await this.es.applyServerTodos(pull.todos);
        }

        if (pull.mode === 'v1') {
          lastSyncAt = pull.serverTime || Date.now();
          await this.db.meta.put({ key: 'lastSyncAt', value: String(lastSyncAt) });
          break;
        }

        if (pull.serverWatermark > lastChangeId) {
          lastChangeId = pull.serverWatermark;
          await this.db.meta.put({ key: 'lastChangeId', value: String(lastChangeId) });
        }

        cursor = pull.nextCursor ?? undefined;
        const likelyMore = pull.todos.length >= this.pullLimit;
        if (!pull.hasMore && !cursor && !likelyMore) break;
      }

      this.store.dispatch(TodoActions.load());
    } catch {
      // retry via next realtime or connectivity event
    } finally {
      this.syncRunning = false;
      if (this.resyncRequested) {
        this.resyncRequested = false;
        queueMicrotask(() => this.sync());
      }
    }
  }
}
