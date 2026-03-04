using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

/// <summary>
/// Handles online multiplayer Ping Pong.
/// Single room concept: only 2 players at a time.
/// Player 1 runs the authoritative game loop and broadcasts state.
/// Player 2 sends only its paddle position.
/// </summary>
public class PingPongHub : Hub
{
    private static readonly object _lock = new();
    private static string? _p1Id, _p1Name;
    private static string? _p2Id, _p2Name;
    private static bool _p1WantsRematch, _p2WantsRematch;

    // ─── Join ───────────────────────────────────────────────────────────────

    public async Task JoinGame(string playerName)
    {
        int slot = 0;
        bool gameCanStart = false;

        lock (_lock)
        {
            if (_p1Id == null)
            {
                _p1Id = Context.ConnectionId;
                _p1Name = playerName;
                slot = 1;
            }
            else if (_p2Id == null && Context.ConnectionId != _p1Id)
            {
                _p2Id = Context.ConnectionId;
                _p2Name = playerName;
                slot = 2;
                gameCanStart = true;
            }
        }

        if (slot == 0)
        {
            await Clients.Caller.SendAsync("RoomFull");
            return;
        }

        if (!gameCanStart)
        {
            await Clients.Caller.SendAsync("WaitingForOpponent");
        }
        else
        {
            await Clients.Client(_p1Id!).SendAsync("GameStart", _p1Name, _p2Name, 1);
            await Clients.Client(_p2Id!).SendAsync("GameStart", _p1Name, _p2Name, 2);
        }
    }

    // ─── In-game messages ────────────────────────────────────────────────────

    /// <summary>P1 sends authoritative game state; server relays to P2.</summary>
    public async Task SendGameState(float ballX, float ballY, float paddle1Y, float paddle2Y, int score1, int score2)
    {
        if (Context.ConnectionId != _p1Id || _p2Id == null) return;
        await Clients.Client(_p2Id).SendAsync("ReceiveGameState", ballX, ballY, paddle1Y, paddle2Y, score1, score2);
    }

    /// <summary>P2 sends its paddle Y; server relays to P1.</summary>
    public async Task SendPaddleMove(float y)
    {
        if (Context.ConnectionId != _p2Id || _p1Id == null) return;
        await Clients.Client(_p1Id).SendAsync("ReceivePaddleMove", y);
    }

    /// <summary>P1 sends the winner name when WIN_SCORE is reached.</summary>
    public async Task GameOver(string winnerName)
    {
        if (Context.ConnectionId != _p1Id) return;
        var targets = new List<string>();
        if (_p1Id != null) targets.Add(_p1Id);
        if (_p2Id != null) targets.Add(_p2Id);
        await Clients.Clients(targets).SendAsync("ReceiveGameOver", winnerName);
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
            if (_p1Id != null) await Clients.Client(_p1Id).SendAsync("GameStart", _p1Name, _p2Name, 1);
            if (_p2Id != null) await Clients.Client(_p2Id).SendAsync("GameStart", _p1Name, _p2Name, 2);
        }
        else
        {
            await Clients.Caller.SendAsync("WaitingForRematch");
        }
    }

    // ─── Disconnect ──────────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        string? opponentId = null;

        lock (_lock)
        {
            if (Context.ConnectionId == _p1Id)
            {
                opponentId = _p2Id;
                // Reset entire room so the opponent can start fresh as P1
                _p1Id = _p1Name = null;
                _p2Id = _p2Name = null;
                _p1WantsRematch = _p2WantsRematch = false;
            }
            else if (Context.ConnectionId == _p2Id)
            {
                opponentId = _p1Id;
                _p2Id = _p2Name = null;
                _p1WantsRematch = _p2WantsRematch = false;
            }
        }

        if (opponentId != null)
            await Clients.Client(opponentId).SendAsync("OpponentLeft");

        await base.OnDisconnectedAsync(exception);
    }
}
