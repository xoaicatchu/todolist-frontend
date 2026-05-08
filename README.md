# Todolist Frontend

Ứng dụng Todo theo hướng **offline-first**, đồng bộ realtime giữa nhiều trình duyệt/thiết bị.

## I. Tech stack

### Frontend
- **Angular 21** (standalone components)
- **TypeScript 5.9**
- **NgRx** (`@ngrx/store`, `@ngrx/effects`) cho luồng action/effect
- **RxJS** cho stream dữ liệu UI/sync
- **Dexie (IndexedDB)** cho local database (offline-first)
- **Angular CDK DragDrop** cho kéo-thả sắp xếp task
- **SignalR client** (`@microsoft/signalr`) cho realtime sync event
- **Angular Service Worker (PWA)** cho offline cache

### Backend (repo riêng)
- **ASP.NET Core** (Minimal API)
- **SignalR Hub**
- Event store in-memory + persist file (`App_Data/state.json`)

## II. Kỹ Thuật & Design Patterns

### 1. Event Sourcing
> **File:** [event-sourcing.service.ts](file:///d:/GitHub/todolist/src/app/core/services/event-sourcing.service.ts)

- Mọi thay đổi ghi thành **event** (`TODO_CREATED`, `TODO_TOGGLED`, `TODO_RENAMED`, `TODO_REORDERED`, `TODO_DELETED`)
- Event lưu vào bảng `events` (IndexedDB) → apply projection vào bảng `todos`
- Events chưa sync được đánh dấu `synced: 0`, push lên server khi có mạng

**Ưu điểm:** Audit trail, offline queue, conflict detection
**Nhược điểm:** Storage tăng dần (cần purge events cũ), phức tạp hơn CRUD đơn giản

### 2. CQRS (Command Query Responsibility Segregation)
> **File:** [sync-api.service.ts](file:///d:/GitHub/todolist/src/app/core/services/sync-api.service.ts)

- **Write path:** `POST /api/v2/sync/push` — đẩy events lên server
- **Read path:** `GET /api/v2/sync/pull` — kéo thay đổi về (phân trang + watermark)
- Tách biệt hoàn toàn giữa ghi và đọc

### 3. Optimistic UI
> **File:** [todo.effects.ts](file:///d:/GitHub/todolist/src/app/state/todo.effects.ts)

- UI cập nhật **ngay lập tức** khi user thao tác (ghi vào IndexedDB local)
- Sync với server chạy **background** — không block UI
- Nếu server reject → cần rollback (hiện chưa implement)

### 4. Offline-First
> **Files:** [app-db.service.ts](file:///d:/GitHub/todolist/src/app/infrastructure/db/app-db.service.ts), [sync.service.ts](file:///d:/GitHub/todolist/src/app/core/services/sync.service.ts)

- Dữ liệu lưu trong IndexedDB — app hoạt động không cần mạng
- Events queue lại khi offline, tự push khi online trở lại
- Service Worker cache assets cho PWA
- `window.addEventListener('online')` trigger sync ngay khi có mạng

### 5. Incremental Sync với Watermark
> **File:** [sync.service.ts](file:///d:/GitHub/todolist/src/app/core/services/sync.service.ts)

- Dùng `lastChangeId` (UUID watermark) để biết đã sync đến đâu
- Pull phân trang (`limit: 300`, có `cursor`) — không tải toàn bộ DB
- Full sync reconciliation: so sánh local vs server, xóa bản ghi stale
- Sync version check (`SYNC_VERSION = '2'`) — force reset khi schema đổi

### 6. Dual Store (NgRx + Dexie)
> **Files:** `state/*.ts` + `infrastructure/db/app-db.service.ts`

- **Dexie** = source of truth (disk, persist)
- **NgRx Store** = read cache (RAM, mất khi refresh)
- Data flow: Dexie → `getAllTodos()` → `dispatch(loadSuccess)` → NgRx → UI

### 7. Multi-tab Sync
> **File:** [tab-realtime.service.ts](file:///d:/GitHub/todolist/src/app/core/services/tab-realtime.service.ts)

- `BroadcastChannel('todo-sync-channel')` — API chuẩn browser, nhanh
- Fallback: `localStorage` event cho browser không hỗ trợ
- Khi 1 tab thay đổi → broadcast → các tab khác dispatch `load()`

### 8. Real-time Cross-Device
> **File:** [realtime-sync.service.ts](file:///d:/GitHub/todolist/src/app/core/services/realtime-sync.service.ts)

- SignalR Hub tại `/hubs/sync`
- Auto-reconnect: `[0, 1000, 3000, 5000]ms`
- Khi nhận `'todosChanged'` → trigger full sync
- Fallback retry mỗi 5 giây khi connection đứt

## III. Tổng Quan Hệ Thống

### 1. CQRS Là Gì

**Command Query Responsibility Segregation** — tách riêng đường đọc (Query) và đường ghi (Command) thành 2 model/path hoàn toàn độc lập.

```
Truyền thống (CRUD):
  Client → API → cùng 1 DB, cùng 1 model ← đọc & ghi chung

CQRS:
  Client → Command API → Write Model → Write DB
  Client → Query API  → Read Model  → Read DB (có thể là replica/cache)
```

---

### 2. Tại Sao CQRS Quan Trọng

2.1. Read và Write có bản chất khác nhau

| | Read | Write |
|---|---|---|
| **Tần suất** | Thường 5-10x nhiều hơn write | Ít hơn |
| **Yêu cầu** | Nhanh, denormalized, dễ query | Nhất quán, validate, business rules |
| **Scale** | Horizontal (replicas, cache) | Vertical (lock, transaction) |
| **Model** | Flat, optimized cho hiển thị | Normalized, optimized cho integrity |

Dùng chung 1 model cho cả hai = **không tối ưu được cho bên nào**.

2.2. Write blocking Read là lãng phí

Khi 1 user INSERT/UPDATE → DB lock row/table → các user khác đang READ phải **chờ**. Tách ra thì read không bao giờ bị block bởi write.

2.3. Trong TodoSync project

```
WRITE:  POST /push → events vào RabbitMQ → worker ghi DB      (async, 5-10ms response)
READ:   GET  /pull → query DB trực tiếp                        (không bị lock bởi write)
```

Write trả response **ngay lập tức** (chỉ enqueue) — user không cần đợi DB xử lý xong.

---

### Khi NÊN dùng CQRS

| Điều kiện | Giải thích |
|-----------|------------|
| **Read/Write ratio chênh lệch lớn** | Ví dụ: 90% read, 10% write → tối ưu read path riêng |
| **Read và Write cần model khác nhau** | Write cần normalize, read cần denormalize/aggregate |
| **Cần scale read và write độc lập** | Read scale bằng replicas, write scale bằng queue |
| **Write cần async/eventual consistency chấp nhận được** | User chấp nhận delay vài giây để thấy data mới |
| **Có event-driven architecture** | CQRS kết hợp tốt với Event Sourcing, message queue |
| **High throughput** | >1K CCU write-heavy, hoặc >5K CCU read-heavy |

### Khi KHÔNG NÊN dùng CQRS

| Điều kiện | Giải thích |
|-----------|------------|
| **App CRUD đơn giản** | Blog, form admin, CRUD table — overhead không đáng |
| **Cần strong consistency** | Giao dịch tài chính, banking — write xong phải thấy ngay |
| **Team nhỏ, MVP** | Complexity cao, cần team hiểu pattern rõ |
| **Read/Write dùng chung model** | Không có lý do tách |
| **< 500 CCU** | Scale chưa phải vấn đề |

### Checklist trước khi áp dụng

- [ ] Read và Write có yêu cầu khác nhau rõ ràng?
- [ ] Hệ thống chấp nhận eventual consistency?
- [ ] Có message queue/event bus sẵn (RabbitMQ, Kafka...)?
- [ ] Team hiểu CQRS và Event Sourcing?
- [ ] Có monitoring để track read/write latency riêng?

---

## IV. Lợi Ích

### Performance

| Metric | Không CQRS | Có CQRS | Cải thiện |
|--------|-----------|---------|-----------|
| Write latency | 50-200ms (đợi DB) | 5-10ms (enqueue) | **10-20x** |
| Read latency | Bị block bởi write lock | Không bị block | **2-5x** |
| Throughput | ~1-2K CCU | ~10-20K CCU | **5-10x** |
| DB connection usage | 1 pool chung | Tách pool read/write | **2x hiệu quả** |

### Scalability

| Khía cạnh | Lợi ích |
|-----------|---------|
| **Read scale** | Thêm DB read replicas, Redis cache — không ảnh hưởng write |
| **Write scale** | Thêm queue workers — không ảnh hưởng read |
| **Độc lập deploy** | Read service và Write service deploy/scale riêng |
| **Failure isolation** | Write service chết → read vẫn hoạt động (và ngược lại) |

### Architecture

| Khía cạnh | Lợi ích |
|-----------|---------|
| **Separation of concerns** | Read logic và write logic không lẫn vào nhau |
| **Dễ optimize từng phía** | Read dùng cache/denormalize, write dùng transaction/validation |
| **Phù hợp Event Sourcing** | Events (write) → Projections (read) — tự nhiên |

---

## V. Đánh Đổi (Trade-offs)

> [!WARNING]
> Mọi lợi ích đều có giá. CQRS đánh đổi **simplicity** lấy **scalability**.

### 1. Eventual Consistency

| Vấn đề | Chi tiết |
|--------|---------|
| **Data delay** | Write xong, read có thể chưa thấy ngay (vài ms → vài giây) |
| **Stale data** | User A tạo todo → User A pull ngay → có thể chưa thấy |
| **UX phức tạp hơn** | Cần optimistic UI, loading states, retry logic |

**Trong TodoSync:** User thêm todo → response 202 ngay → nhưng pull có thể chưa thấy todo mới vì worker chưa ghi xong. Giải quyết bằng optimistic UI (ghi local trước).

### 2. Complexity

| Vấn đề | So sánh |
|--------|---------|
| **Số component** | CRUD: 1 API + 1 DB → CQRS: 2 API + message queue + worker + có thể 2 DB |
| **Code** | Gấp ~1.5-2x so với CRUD đơn giản |
| **Debug** | Trace request qua nhiều service hơn |
| **Testing** | Cần test cả write path, read path, và eventual consistency |

```
CRUD:    Client → API → DB                              (3 components)
CQRS:    Client → Write API → Queue → Worker → Write DB (5 components)
         Client → Read API → Read DB/Cache               (3 components thêm)
```

### 3. Infrastructure

| Thêm gì | Chi phí |
|---------|---------|
| **Message Queue** (RabbitMQ/Kafka) | Server riêng, monitoring, HA |
| **Read replicas** | Thêm DB instances |
| **Cache layer** (Redis) | Server riêng, invalidation logic |
| **Queue workers** | Thêm processes, auto-scaling |

### 4. Data Consistency Challenges

| Vấn đề | Chi tiết |
|--------|---------|
| **Duplicate processing** | Queue deliver 2 lần → cần idempotent handlers |
| **Order guarantee** | Events có thể đến sai thứ tự → cần sequence/timestamp |
| **Failed writes** | Event trong queue nhưng worker crash → cần retry + dead letter queue |
| **Schema migration** | 2 model (read + write) → migrate cả 2 |

---

## VI. So Sánh Tổng Hợp

| Tiêu chí | CRUD đơn giản | CQRS |
|----------|--------------|------|
| **Simplicity** | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Performance** | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Scalability** | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Consistency** | ⭐⭐⭐⭐⭐ (strong) | ⭐⭐⭐ (eventual) |
| **Development cost** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Infrastructure cost** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Debugging** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Phù hợp cho** | <1K CCU, CRUD apps | >1K CCU, event-driven, high throughput |

---

## VI. Áp Dụng Trong TodoSync

### Hiện trạng ✅

| Thành phần | Vai trò CQRS |
|-----------|-------------|
| `POST /api/v2/sync/push` | **Command** — nhận events, enqueue vào RabbitMQ |
| `GET /api/v2/sync/pull` | **Query** — đọc DB, trả changes theo watermark |
| RabbitMQ | **Message bus** — async write, decouple command processing |
| Response 202 (Accepted) | **Async acknowledgment** — không đợi DB write xong |

