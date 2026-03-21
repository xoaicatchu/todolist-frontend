import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppDbService } from '../../infrastructure/db/app-db.service';
import { EventSourcingService } from './event-sourcing.service';
import { NetworkService } from './network.service';
import { SyncApiService } from './sync-api.service';
import { TodoActions } from '../../state/todo.actions';

const SYNC_VERSION = '2'; // bump to force full re-sync and clean stale data

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
      // Check sync version — force full reset if outdated
      const syncVer = (await this.db.meta.get('syncVersion'))?.value;
      if (syncVer !== SYNC_VERSION) {
        console.log(`[Sync] Version mismatch (${syncVer} → ${SYNC_VERSION}), resetting local data`);
        await this.db.todos.clear();
        await this.db.events.clear();
        await this.db.meta.put({ key: 'lastChangeId', value: '0' });
        await this.db.meta.put({ key: 'syncVersion', value: SYNC_VERSION });
      }

      // Push unsynced local events
      const unsynced = await this.es.getUnsyncedEvents();
      if (unsynced.length) {
        const pushResult = await this.api.pushEvents(unsynced);
        await this.es.markEventsSynced(pushResult.acceptedEventIds);
      }

      let lastChangeId: string = (await this.db.meta.get('lastChangeId'))?.value ?? '0';

      // Auto-migrate: old numeric timestamps → reset
      if (lastChangeId !== '0' && !/^[0-9a-f]{8}-/i.test(lastChangeId)) {
        lastChangeId = '0';
        await this.db.meta.put({ key: 'lastChangeId', value: '0' });
      }

      const isFullSync = lastChangeId === '0';

      // Track server entity IDs for reconciliation during full sync
      const serverEntityIds = isFullSync ? new Set<string>() : null;
      let cursor: string | undefined = undefined;

      for (let guard = 0; guard < 100; guard++) {
        const pull = await this.api.pullIncremental({
          sinceChangeId: lastChangeId,
          lastSyncAt: 0,
          limit: this.pullLimit,
          cursor,
        });

        if (pull.todos.length) {
          await this.es.applyServerTodos(pull.todos);
          if (serverEntityIds) {
            for (const t of pull.todos) serverEntityIds.add(t.id);
          }
        }

        const newWatermark = String(pull.serverWatermark);
        if (newWatermark !== String(lastChangeId)) {
          lastChangeId = newWatermark;
          await this.db.meta.put({ key: 'lastChangeId', value: lastChangeId });
        }

        cursor = pull.nextCursor ?? undefined;
        if (!pull.hasMore && !cursor && pull.todos.length < this.pullLimit) break;
      }

      // Full sync reconciliation: remove local items not on server
      if (isFullSync) {
        if (serverEntityIds && serverEntityIds.size > 0) {
          const allLocal = await this.db.todos.toArray();
          const staleIds = allLocal.filter(t => !serverEntityIds.has(t.id)).map(t => t.id);
          if (staleIds.length > 0) {
            await this.db.todos.bulkDelete(staleIds);
            console.log(`[Sync] Cleaned ${staleIds.length} stale local records`);
          }
        } else if (serverEntityIds && serverEntityIds.size === 0) {
          const localCount = await this.db.todos.count();
          if (localCount > 0) {
            await this.db.todos.clear();
            console.log(`[Sync] Server empty, cleared ${localCount} local records`);
          }
        }
      }

      this.store.dispatch(TodoActions.load());
    } catch (e) {
      console.error('[Sync] Error:', e);
    } finally {
      this.syncRunning = false;
      if (this.resyncRequested) {
        this.resyncRequested = false;
        queueMicrotask(() => this.sync());
      }
    }
  }
}
