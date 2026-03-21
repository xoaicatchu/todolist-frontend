# 🏗️ Sơ Đồ Kiến Trúc — TodoSync Frontend

## Tổng Quan Hệ Thống

```mermaid
graph TB
    subgraph "☁️ Cloud / Backend"
        AZURE["Azure Web App"]
        NGINX["NGINX Reverse Proxy<br/>:8080"]
        BACKEND[".NET Backend API<br/>:3000"]
        RABBIT["RabbitMQ<br/>Async Write Queue"]
        DB[(PostgreSQL / SQL Server)]

        NGINX --> BACKEND
        BACKEND --> RABBIT
        RABBIT --> DB
        BACKEND --> DB
    end

    subgraph "🖥️ Browser Client"
        subgraph "Angular 21 PWA"
            UI["App Component<br/>Calendar + Todo List<br/>CDK Drag & Drop"]
            STORE["NgRx Store<br/>todoReducer"]
            EFFECTS["NgRx Effects<br/>TodoEffects"]
            SELECTORS["Selectors<br/>selectTodos"]
        end

        subgraph "Core Services"
            ES["📦 EventSourcingService<br/>Ghi event + chiếu thành state<br/>⎯ append · apply · watchTodos"]
            SYNC["🎯 SyncService — Orchestrator<br/>Điều phối toàn bộ quy trình sync<br/>⎯ push unsynced → pull changes → reconcile"]
            API["🌐 SyncApiService — HTTP Transport<br/>Gọi REST API đến backend<br/>⎯ POST /push · GET /pull"]
            RT["📡 RealtimeSyncService — Cross-Device<br/>Nhận thông báo realtime từ server<br/>⎯ SignalR WebSocket /hubs/sync"]
            NET["🔌 NetworkService<br/>Theo dõi online/offline"]
            TAB["📋 TabRealtimeService — Multi-Tab<br/>Đồng bộ giữa các tab cùng browser<br/>⎯ BroadcastChannel + localStorage"]
        end

        subgraph "Infrastructure"
            DEXIE["AppDbService<br/>Dexie IndexedDB"]
            SW["Service Worker<br/>ngsw / PWA Cache"]
        end
    end

    subgraph "🔄 Sibling Tabs"
        TAB2["Other Browser Tabs"]
    end

    UI -->|"dispatch actions"| STORE
    STORE -->|"select"| SELECTORS --> UI
    STORE -->|"actions$"| EFFECTS
    EFFECTS -->|"append events"| ES
    EFFECTS -->|"sync()"| SYNC
    EFFECTS -->|"notifyChanged()"| TAB
    ES -->|"read/write"| DEXIE
    SYNC -->|"pushEvents / pullIncremental"| API
    SYNC -->|"applyServerTodos"| ES
    SYNC -->|"check online"| NET
    API -->|"HTTP POST/GET"| BACKEND
    RT -->|"SignalR WebSocket"| BACKEND
    RT -->|"todosChanged → sync()"| SYNC
    RT -->|"dispatch load()"| STORE
    TAB -->|"BroadcastChannel +<br/>localStorage ping"| TAB2
    TAB2 -->|"dispatch load()"| STORE
    SW -->|"cache assets"| UI
```

## Luồng Dữ Liệu Chi Tiết

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant UI as App Component
    participant S as NgRx Store
    participant E as Effects
    participant ES as EventSourcing
    participant DB as IndexedDB (Dexie)
    participant Sync as SyncService
    participant API as SyncApiService
    participant BE as Backend :3000
    participant RT as SignalR Hub
    participant T as TabRealtime

    Note over U,T: 📝 Tạo Todo Mới (Optimistic + Event Sourcing)
    U->>UI: Nhập title, chọn priority
    UI->>S: dispatch Add action
    S->>E: action$ stream
    E->>ES: append(TODO_CREATED)
    ES->>DB: events.add(event)
    ES->>DB: todos.put(newItem)
    E->>T: notifyChanged()
    T-->>T: BroadcastChannel.postMessage()
    E->>Sync: sync()
    Sync->>API: pushEvents(unsyncedEvents)
    API->>BE: POST /api/v2/sync/push
    BE-->>API: { acceptedEventIds }
    Sync->>API: pullIncremental()
    API->>BE: GET /api/v2/sync/pull
    BE-->>API: { todos, serverWatermark }
    Sync->>ES: applyServerTodos()
    ES->>DB: todos.put(serverItems)
    Sync->>S: dispatch load()
    E->>ES: getAllTodos()
    ES->>DB: todos.toArray()
    DB-->>ES: items[]
    E->>S: loadSuccess(items)
    S-->>UI: Updated state

    Note over RT,BE: 📡 Real-time từ Server (thiết bị khác thay đổi)
    BE->>RT: SignalR "todosChanged"
    RT->>S: dispatch load()
    RT->>Sync: sync()
    Sync->>API: pullIncremental()
    API->>BE: GET /api/v2/sync/pull
    BE-->>API: { todos, serverWatermark }
    Sync->>ES: applyServerTodos()
    ES->>DB: todos.put()
    Sync->>S: dispatch load()
```

## Cấu Trúc Thư Mục

```
todolist/
├── src/app/
│   ├── app.ts                    # Root component (Calendar + TodoList UI)
│   ├── app.html / app.scss       # Template & styles
│   ├── app.config.ts             # Angular providers (NgRx, HttpClient, SW)
│   ├── app.routes.ts             # Router config
│   ├── core/
│   │   ├── models/
│   │   │   └── todo.model.ts     # TodoItem, TodoEvent, TodoPriority
│   │   └── services/
│   │       ├── event-sourcing.service.ts  # Event store + projection
│   │       ├── sync.service.ts            # Push/Pull orchestrator  
│   │       ├── sync-api.service.ts        # HTTP client for /api/v2/sync
│   │       ├── realtime-sync.service.ts   # SignalR connection
│   │       ├── network.service.ts         # Online/Offline detection
│   │       └── tab-realtime.service.ts    # Multi-tab sync
│   ├── infrastructure/
│   │   └── db/
│   │       └── app-db.service.ts  # Dexie IndexedDB (3 tables)
│   └── state/
│       ├── todo.actions.ts        # NgRx actions (Load, Add, Toggle, ...)
│       ├── todo.effects.ts        # Side-effects orchestration
│       ├── todo.reducer.ts        # State reducer
│       └── todo.selectors.ts      # Memoized selectors
├── .github/workflows/
│   ├── azure-webapps-node.yml     # CI/CD → Azure Web App
│   └── webpack.yml                # Build check
├── load-tests/
│   └── stress-test.js             # k6 stress test (20K CCU)
└── proxy.conf.json                # Dev proxy → localhost:3000
```

## Các Design Pattern Chính

| Pattern | Vị trí | Mô tả |
|---------|--------|-------|
| **Event Sourcing** | `EventSourcingService` | Mọi thay đổi được ghi dưới dạng event → project ra state |
| **CQRS** | `SyncService` | Push (write) và Pull (read) tách biệt qua API v2 |
| **Offline-First** | `Dexie + IndexedDB` | Dữ liệu lưu local, sync khi có mạng |
| **Optimistic UI** | `TodoEffects` | UI cập nhật ngay, sync background |
| **Redux/NgRx** | `state/` | Single source of truth cho UI rendering |
| **Real-time Sync** | `SignalR Hub` | Server push notifications khi data thay đổi |
| **Multi-tab Sync** | `BroadcastChannel` | Đồng bộ giữa các tab cùng browser |
| **PWA** | `Service Worker` | Cache assets, hoạt động offline |

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Angular | 21.2 |
| State Management | NgRx (Store + Effects) | 21.0 |
| Offline DB | Dexie (IndexedDB) | 4.3 |
| Real-time | SignalR | 10.0 |
| Drag & Drop | Angular CDK | 21.2 |
| PWA | Angular Service Worker | 21.2 |
| Testing | Vitest | 4.0 |
| Load Testing | k6 | - |
| CI/CD | GitHub Actions → Azure | - |
| Backend | .NET + RabbitMQ + NGINX | - |
