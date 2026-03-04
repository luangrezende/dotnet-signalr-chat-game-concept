# dotnet-signalr-chat-game-concept

![.NET](https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet)
![SignalR](https://img.shields.io/badge/SignalR-realtime-blue)
![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker)
![License](https://img.shields.io/badge/license-MIT-green)

A real-time multi-user web application built with ASP.NET Core and SignalR. Includes a shared chat room, a turn-based Ping Pong game, and a collaborative paint canvas.

---

## Overview

This is a concept project for exploring SignalR in a multi-feature context. Three independent hubs handle real-time communication: one for chat, one for a 1v1 Ping Pong game with a player queue, and one for a shared drawing canvas. The frontend is plain JavaScript using ES modules — no framework.

The server holds all state in memory and exposes game configuration to the client through a minimal REST endpoint.

---

## Architecture

Single-process ASP.NET Core application. No database. State is maintained in singleton services per feature. Hubs communicate directly with connected clients using SignalR groups and targeted sends.

---

## Tech Stack

- **ASP.NET Core** (.NET 10) — HTTP host, static files, SignalR
- **SignalR** — persistent WebSocket connections for all real-time features
- **Vanilla JavaScript (ES Modules)** — no frontend framework or bundler
- **Docker** — multi-stage image based on `mcr.microsoft.com/dotnet/aspnet:10.0`

---

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- Docker (optional, for containerized runs)

### Running locally

```bash
git clone https://github.com/<your-username>/dotnet-signalr-chat-game-concept.git
cd dotnet-signalr-chat-game-concept/GameChat.Concept
dotnet run
```

The app starts on `http://localhost:5000` by default (see `Properties/launchSettings.json`).

### Running with Docker

```bash
docker build -t gamechat-concept .
docker run -p 8080:8080 gamechat-concept
```

Open `http://localhost:8080` in your browser.

---

## Configuration

All configurable values live in `appsettings.json`. No secrets or external services are required.

| Section | Key | Description |
|---|---|---|
| `Chat` | `HistorySize` | Number of messages replayed to a new connection |
| `PingPong` | `CanvasWidth` / `CanvasHeight` | Game canvas dimensions |
| `PingPong` | `BallInitialSpeed` / `BallMaxSpeed` | Ball speed range |
| `PingPong` | `BallAcceleration` | Speed multiplier applied after each paddle hit |
| `PingPong` | `WinScore` | Points required to win a match |
| `PingPong` | `CountdownSeconds` | Pre-game countdown duration |
| `PingPong` | `QueuePromotionDelayMs` | Delay before the next queued player is promoted |

Game configuration is also exposed at `GET /api/config` so the client can stay in sync without duplicating values.

---

## Project Structure

```
GameChat.Concept/
├── Hubs/
│   ├── ChatHub.cs          # Chat messages, online counter, typing indicator
│   ├── PingPongHub.cs      # Game matchmaking, queue, and gameplay events
│   └── PaintHub.cs         # Collaborative drawing via SignalR groups
├── Services/
│   ├── ChatHistoryService.cs     # In-memory message buffer (ring buffer via LinkedList)
│   ├── OnlineCounterService.cs   # Thread-safe connected user count
│   └── PaintHistoryService.cs    # Replay buffer for draw actions
├── Options/
│   ├── ChatOptions.cs
│   └── PingPongOptions.cs
├── wwwroot/
│   ├── index.html
│   ├── js/                 # App entry point and user session
│   └── modules/            # Feature modules: chat, pingpong, paint
└── Program.cs
```