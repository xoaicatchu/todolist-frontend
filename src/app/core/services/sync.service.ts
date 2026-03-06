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

  constructor(
    private db: AppDbService,
    private es: EventSourcingService,
    private network: NetworkService,
    private api: SyncApiService,
    private store: Store
  ) {
    setInterval(() => this.sync(), 8000);
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

      const since = Number((await this.db.meta.get('lastSyncAt'))?.value ?? '0');
      const pullResult = await this.api.pullTodos(since);
      await this.es.applyServerTodos(pullResult.todos);
      await this.db.meta.put({ key: 'lastSyncAt', value: String(pullResult.serverTime || Date.now()) });

      // Quan trọng: refresh lại UI state từ local DB sau mỗi lần sync
      this.store.dispatch(TodoActions.load());
    } catch {
      // retry timer/realtime sẽ tự chạy lại
    } finally {
      this.syncRunning = false;
      if (this.resyncRequested) {
        this.resyncRequested = false;
        queueMicrotask(() => this.sync());
      }
    }
  }
}
