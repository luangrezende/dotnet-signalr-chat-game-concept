using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

/// <summary>
/// Handles online multiplayer Ping Pong.
/// - Slot 1 (P1): left paddle, authoritative host — runs physics, broadcasts state.
/// - Slot 2 (P2): right paddle, thin client — sends only paddle Y.
/// - Slot 3+ (Spectators): watch live, are queued to replace the next loser.
/// </summary>
public class PingPongHub : Hub
{
    private static readonly object _lock = new();
    private static string? _p1Id, _p1Name;
    private static string? _p2Id, _p2Name;
    private static bool _p1WantsRematch, _p2WantsRematch;

    /// <summary>Queue of spectators waiting to play next (FIFO).</summary>
    private static readonly List<(string Id, string Name)> _spectators = new();

    // ─── Connect ──────────────────────────────────────────────────────────────

    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();

        string? waitingName = null;
        string? gameName1   = null;
        string? gameName2   = null;
        int     specCount   = 0;

        lock (_lock)
        {
            if (_p1Id != null && _p2Id == null) waitingName = _p1Name;
            if (_p1Id != null && _p2Id != null) { gameName1 = _p1Name; gameName2 = _p2Name; }
            specCount = _spectators.Count;
        }

        await Clients.Caller.SendAsync("LobbyUpdate", waitingName);
        await Clients.Caller.SendAsync("GameStatusUpdate", gameName1, gameName2);
        await Clients.Caller.SendAsync("SpectatorCountUpdate", specCount);
    }

    // ─── Join ───────────────────────────────────────────────────────────────

    public async Task JoinGame(string playerName)
    {
        string connId = Context.ConnectionId;
        int    slot   = 0;
        bool   gameCanStart      = false;
        bool   joinedAsSpectator = false;
        int    spectatorPos      = 0;
        string? sp1Name = null, sp2Name = null;

        lock (_lock)
        {
            if (_p1Id == null)
            {
                _p1Id = connId; _p1Name = playerName; slot = 1;
            }
            else if (_p2Id == null && connId != _p1Id)
            {
                _p2Id = connId; _p2Name = playerName; slot = 2; gameCanStart = true;
            }
            else if (connId != _p1Id && connId != _p2Id)
            {
                _spectators.Add((connId, playerName));
                spectatorPos = _spectators.Count;
                sp1Name = _p1Name;
                sp2Name = _p2Name;
                joinedAsSpectator = true;
            }
        }

        if (joinedAsSpectator)
        {
            await Clients.Caller.SendAsync("JoinedAsSpectator", spectatorPos, sp1Name, sp2Name);
            await BroadcastSpectatorCount();
            return;
        }

        if (slot == 0)
        {
            await Clients.Caller.SendAsync("RoomFull");
            return;
        }

        if (!gameCanStart)
        {
            await Clients.Caller.SendAsync("WaitingForOpponent");
            await Clients.Others.SendAsync("LobbyUpdate", playerName);
        }
        else
        {
            // Notify lobby: game started
            await Clients.All.SendAsync("LobbyUpdate", (string?)null);
            await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);
            // Start countdown for each player (3 seconds)
            await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, 3);
            await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, 3);
            await BroadcastToSpectators("SpectatorGameStart", _p1Name!, _p2Name!);
        }
    }

    // ─── Cancel queue ────────────────────────────────────────────────────────

    public async Task CancelQueue()
    {
        lock (_lock)
        {
            if (Context.ConnectionId != _p1Id || _p2Id != null) return;
            _p1Id = null; _p1Name = null;
        }
        await Clients.Caller.SendAsync("QueueCancelled");
        await Clients.Others.SendAsync("LobbyUpdate", (string?)null);
    }

    // ─── Spectator leave queue ────────────────────────────────────────────────

    public async Task LeaveSpectator()
    {
        bool found = false;
        lock (_lock)
        {
            var idx = _spectators.FindIndex(s => s.Id == Context.ConnectionId);
            if (idx >= 0) { _spectators.RemoveAt(idx); found = true; }
        }
        if (!found) return;
        await Clients.Caller.SendAsync("SpectatorLeft");
        await BroadcastSpectatorPositions();
        await BroadcastSpectatorCount();
    }

    // ─── In-game messages ────────────────────────────────────────────────────

    /// <summary>P1 sends authoritative game state; server relays to P2 and all spectators.</summary>
    public async Task SendGameState(float ballX, float ballY, float paddle1Y, float paddle2Y, int score1, int score2)
    {
        if (Context.ConnectionId != _p1Id || _p2Id == null) return;

        List<string> targets;
        lock (_lock) { targets = _spectators.Select(s => s.Id).Append(_p2Id).ToList(); }

        await Clients.Clients(targets).SendAsync("ReceiveGameState", ballX, ballY, paddle1Y, paddle2Y, score1, score2);
    }

    /// <summary>P2 sends its paddle Y; server relays to P1.</summary>
    public async Task SendPaddleMove(float y)
    {
        if (Context.ConnectionId != _p2Id || _p1Id == null) return;
        await Clients.Client(_p1Id).SendAsync("ReceivePaddleMove", y);
    }

    /// <summary>P1 signals game over. Promotes next spectator if available, otherwise offers rematch.</summary>
    public async Task GameOver(string winnerName)
    {
        if (Context.ConnectionId != _p1Id) return;

        List<string> notifyIds;
        lock (_lock)
        {
            notifyIds = new List<string?> { _p1Id, _p2Id }
                .Where(id => id != null)
                .Select(id => id!)
                .Concat(_spectators.Select(s => s.Id))
                .ToList();
        }
        await Clients.Clients(notifyIds).SendAsync("ReceiveGameOver", winnerName);

        // Try to promote spectator
        bool        hasNext  = false;
        string?     loserId  = null;
        string?     nextId   = null;
        string?     nextName = null;

        lock (_lock)
        {
            if (_spectators.Count > 0)
            {
                loserId  = winnerName == _p1Name ? _p2Id : _p1Id;
                (nextId, nextName) = _spectators[0];
                _spectators.RemoveAt(0);

                if (winnerName == _p1Name)
                {
                    // P1 won → stays P1, spectator becomes P2
                    _p2Id = nextId; _p2Name = nextName;
                }
                else
                {
                    // P2 won → P2 promoted to P1 (authoritative), spectator becomes P2
                    _p1Id = _p2Id; _p1Name = _p2Name;
                    _p2Id = nextId; _p2Name = nextName;
                }
                _p1WantsRematch = _p2WantsRematch = false;
                hasNext = true;
            }
        }

        if (hasNext)
        {
            // Notify loser their slot was taken
            if (loserId != null)
                await Clients.Client(loserId).SendAsync("SpectatorTookYourSpot", nextName!);

            // Update spectator queue positions
            await BroadcastSpectatorPositions();
            await BroadcastSpectatorCount();

            // Broadcast updated game status
            await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);

            // Start new countdown for winner + incoming spectator
            await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, 3);
            await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, 3);
            await BroadcastToSpectators("SpectatorGameStart", _p1Name!, _p2Name!);
        }
    }

    // ─── Rematch ─────────────────────────────────────────────────────────────

    public async Task RequestRematch()
    {
        bool bothReady = false;
        lock (_lock)
        {
            if (Context.ConnectionId == _p1Id) _p1WantsRematch = true;
            else if (Context.ConnectionId == _p2Id) _p2WantsRematch = true;
            bothReady = _p1WantsRematch && _p2WantsRematch;
        }

        if (bothReady)
        {
            lock (_lock) { _p1WantsRematch = _p2WantsRematch = false; }
            if (_p1Id != null) await Clients.Client(_p1Id).SendAsync("StartCountdown", _p1Name, _p2Name, 1, 3);
            if (_p2Id != null) await Clients.Client(_p2Id).SendAsync("StartCountdown", _p1Name, _p2Name, 2, 3);
            await BroadcastToSpectators("SpectatorGameStart", _p1Name!, _p2Name!);
        }
        else
        {
            await Clients.Caller.SendAsync("WaitingForRematch");
        }
    }

    // ─── Disconnect ──────────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        string connId      = Context.ConnectionId;
        string? opponentId = null;
        bool    wasSpectator    = false;
        bool    positionsChanged = false;

        lock (_lock)
        {
            var specIdx = _spectators.FindIndex(s => s.Id == connId);
            if (specIdx >= 0)
            {
                _spectators.RemoveAt(specIdx);
                wasSpectator     = true;
                positionsChanged = specIdx < _spectators.Count;
            }
            else if (connId == _p1Id)
            {
                opponentId = _p2Id;
                _p1Id = _p1Name = null;
                _p2Id = _p2Name = null;
                _p1WantsRematch = _p2WantsRematch = false;
                _spectators.Clear();
            }
            else if (connId == _p2Id)
            {
                opponentId = _p1Id;
                _p2Id = _p2Name = null;
                _p1WantsRematch = _p2WantsRematch = false;
                _spectators.Clear();
            }
        }

        if (opponentId != null)
        {
            await Clients.Client(opponentId).SendAsync("OpponentLeft");
            await Clients.All.SendAsync("LobbyUpdate", (string?)null);
            await Clients.All.SendAsync("GameStatusUpdate", (string?)null, (string?)null);
            await BroadcastSpectatorCount();
        }

        if (wasSpectator)
        {
            if (positionsChanged) await BroadcastSpectatorPositions();
            await BroadcastSpectatorCount();
        }

        // Notify remaining spectators if room was wiped
        if (opponentId != null)
            await Clients.All.SendAsync("RoomReset");

        await base.OnDisconnectedAsync(exception);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private async Task BroadcastSpectatorCount()
    {
        int count;
        lock (_lock) { count = _spectators.Count; }
        await Clients.All.SendAsync("SpectatorCountUpdate", count);
    }

    private async Task BroadcastSpectatorPositions()
    {
        List<(string Id, int Pos)> updates;
        lock (_lock) { updates = _spectators.Select((s, i) => (s.Id, i + 1)).ToList(); }
        foreach (var (id, pos) in updates)
            await Clients.Client(id).SendAsync("SpectatorPositionUpdate", pos);
    }

    private async Task BroadcastToSpectators(string method, string arg1, string arg2)
    {
        List<string> ids;
        lock (_lock) { ids = _spectators.Select(s => s.Id).ToList(); }
        if (ids.Count > 0)
            await Clients.Clients(ids).SendAsync(method, arg1, arg2);
    }
}
