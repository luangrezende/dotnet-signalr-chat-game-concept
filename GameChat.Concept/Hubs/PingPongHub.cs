using GameChat.Concept.Options;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace GameChat.Concept.Hubs;

public class PingPongHub : Hub
{
    private static readonly object _lock = new();
    private static string? _p1Id, _p1Name;
    private static string? _p2Id, _p2Name;
    private static readonly List<(string Id, string Name)> _queue = new();

    private readonly int _countdownSeconds;
    private readonly int _queuePromotionDelayMs;

    public PingPongHub(IOptions<PingPongOptions> options)
    {
        _countdownSeconds      = options.Value.CountdownSeconds;
        _queuePromotionDelayMs = options.Value.QueuePromotionDelayMs;
    }

    // --- Connect -------------------------------------------------------------
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();

        string? waitingName = null;
        string? gameName1   = null;
        string? gameName2   = null;
        int     queueCount  = 0;

        lock (_lock)
        {
            if (_p1Id != null && _p2Id == null) waitingName = _p1Name;
            if (_p1Id != null && _p2Id != null) { gameName1 = _p1Name; gameName2 = _p2Name; }
            queueCount = _queue.Count;
        }

        await Clients.Caller.SendAsync("LobbyUpdate",      waitingName);
        await Clients.Caller.SendAsync("GameStatusUpdate", gameName1, gameName2);
        await Clients.Caller.SendAsync("QueueCountUpdate", queueCount);
    }

    // --- Join ----------------------------------------------------------------
    public async Task JoinGame(string playerName)
    {
        string connId       = Context.ConnectionId;
        int    slot         = 0;
        bool   gameCanStart = false;
        bool   joinedQueue  = false;
        int    queuePos     = 0;

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
            else if (connId != _p1Id && connId != _p2Id && !_queue.Any(q => q.Id == connId))
            {
                _queue.Add((connId, playerName));
                queuePos    = _queue.Count;
                joinedQueue = true;
            }
        }

        if (joinedQueue)
        {
            await Clients.Caller.SendAsync("JoinedQueue", queuePos);
            await BroadcastQueueCount();
            return;
        }

        if (slot == 0) return;

        if (!gameCanStart)
        {
            await Clients.Caller.SendAsync("WaitingForOpponent");
            await Clients.All.SendAsync("LobbyUpdate", playerName);
        }
        else
        {
            await Clients.All.SendAsync("LobbyUpdate",      (string?)null);
            await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);
            await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, _countdownSeconds);
            await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, _countdownSeconds);
        }
    }

    // --- Leave game ----------------------------------------------------------
    public async Task LeaveGame()
    {
        string  connId     = Context.ConnectionId;
        string? opponentId = null;
        string? leaverName = null;
        string? nextId = null, nextName = null;

        lock (_lock)
        {
            if (connId == _p1Id)
            {
                leaverName = _p1Name; opponentId = _p2Id;
                if (_queue.Count > 0 && opponentId != null)
                {
                    (nextId, nextName) = _queue[0]; _queue.RemoveAt(0);
                    _p1Id = _p2Id; _p1Name = _p2Name;
                    _p2Id = nextId; _p2Name = nextName;
                }
                else { _p1Id = _p1Name = null; _p2Id = _p2Name = null; _queue.Clear(); }
            }
            else if (connId == _p2Id)
            {
                leaverName = _p2Name; opponentId = _p1Id;
                if (_queue.Count > 0 && opponentId != null)
                {
                    (nextId, nextName) = _queue[0]; _queue.RemoveAt(0);
                    _p2Id = nextId; _p2Name = nextName;
                }
                else { _p2Id = _p2Name = null; _p1Id = _p1Name = null; _queue.Clear(); }
            }
            else return;
        }

        if (nextId != null)
        {
            if (opponentId != null)
                await Clients.Client(opponentId).SendAsync("OpponentLeft", leaverName);
            await BroadcastQueuePositions();
            await BroadcastQueueCount();
            await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);
            await Task.Delay(_queuePromotionDelayMs);
            await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, _countdownSeconds);
            await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, _countdownSeconds);
        }
        else
        {
            if (opponentId != null)
                await Clients.Client(opponentId).SendAsync("OpponentLeft", leaverName);
            await Clients.All.SendAsync("LobbyUpdate",      (string?)null);
            await Clients.All.SendAsync("GameStatusUpdate", (string?)null, (string?)null);
            await Clients.All.SendAsync("RoomReset");
            await BroadcastQueueCount();
        }
    }

    // --- Cancel (P1 waiting for opponent) ------------------------------------
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

    // --- Leave lobby queue ---------------------------------------------------
    public async Task LeaveQueue()
    {
        bool found = false;
        lock (_lock)
        {
            var idx = _queue.FindIndex(q => q.Id == Context.ConnectionId);
            if (idx >= 0) { _queue.RemoveAt(idx); found = true; }
        }
        if (!found) return;
        await Clients.Caller.SendAsync("LeftQueue");
        await BroadcastQueuePositions();
        await BroadcastQueueCount();
    }

    // --- In-game messages ----------------------------------------------------
    public async Task SendGameState(float ballX, float ballY, float ballVx, float ballVy, float paddle1Y, float paddle2Y, int score1, int score2)
    {
        if (Context.ConnectionId != _p1Id || _p2Id == null) return;
        await Clients.Client(_p2Id).SendAsync("ReceiveGameState", ballX, ballY, ballVx, ballVy, paddle1Y, paddle2Y, score1, score2);
    }

    public async Task SendPaddleMove(float y)
    {
        if (Context.ConnectionId != _p2Id || _p1Id == null) return;
        await Clients.Client(_p1Id).SendAsync("ReceivePaddleMove", y);
    }

    public async Task GameOver(string winnerName)
    {
        if (Context.ConnectionId != _p1Id) return;

        var notifyIds = new[] { _p1Id, _p2Id }.Where(x => x != null).Select(x => x!).ToList();
        await Clients.Clients(notifyIds).SendAsync("ReceiveGameOver", winnerName);

        string? nextId   = null, nextName = null;
        string? loserId  = null;

        lock (_lock)
        {
            if (_queue.Count > 0)
            {
                bool p1Won = winnerName == _p1Name;
                loserId    = p1Won ? _p2Id : _p1Id;
                (nextId, nextName) = _queue[0];
                _queue.RemoveAt(0);

                if (p1Won) { _p2Id = nextId; _p2Name = nextName; }
                else       { _p1Id = _p2Id; _p1Name = _p2Name; _p2Id = nextId; _p2Name = nextName; }
            }
        }

        if (nextId != null)
        {
            if (loserId != null)
                await Clients.Client(loserId).SendAsync("ReturnToLobby");

            await BroadcastQueuePositions();
            await BroadcastQueueCount();
            await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);
            await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, _countdownSeconds);
            await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, _countdownSeconds);
        }
    }

    // --- Disconnect ----------------------------------------------------------
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        string  connId           = Context.ConnectionId;
        string? opponentId       = null;
        string? leaverName       = null;
        string? nextId           = null, nextName = null;
        bool    wasQueued        = false;
        bool    positionsChanged = false;

        lock (_lock)
        {
            var qIdx = _queue.FindIndex(q => q.Id == connId);
            if (qIdx >= 0)
            {
                _queue.RemoveAt(qIdx);
                wasQueued        = true;
                positionsChanged = qIdx < _queue.Count;
            }
            else if (connId == _p1Id)
            {
                leaverName = _p1Name; opponentId = _p2Id;
                if (_queue.Count > 0 && opponentId != null)
                {
                    (nextId, nextName) = _queue[0]; _queue.RemoveAt(0);
                    _p1Id = _p2Id; _p1Name = _p2Name;
                    _p2Id = nextId; _p2Name = nextName;
                }
                else { _p1Id = _p1Name = null; _p2Id = _p2Name = null; _queue.Clear(); }
            }
            else if (connId == _p2Id)
            {
                leaverName = _p2Name; opponentId = _p1Id;
                if (_queue.Count > 0 && opponentId != null)
                {
                    (nextId, nextName) = _queue[0]; _queue.RemoveAt(0);
                    _p2Id = nextId; _p2Name = nextName;
                }
                else { _p2Id = _p2Name = null; _p1Id = _p1Name = null; _queue.Clear(); }
            }
        }

        if (opponentId != null)
        {
            if (nextId != null)
            {
                await Clients.Client(opponentId).SendAsync("OpponentLeft", leaverName);
                await BroadcastQueuePositions();
                await BroadcastQueueCount();
                await Clients.All.SendAsync("GameStatusUpdate", _p1Name, _p2Name);
                await Task.Delay(_queuePromotionDelayMs);
                await Clients.Client(_p1Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 1, _countdownSeconds);
                await Clients.Client(_p2Id!).SendAsync("StartCountdown", _p1Name, _p2Name, 2, _countdownSeconds);
            }
            else
            {
                await Clients.Client(opponentId).SendAsync("OpponentLeft", leaverName);
                await Clients.All.SendAsync("LobbyUpdate",      (string?)null);
                await Clients.All.SendAsync("GameStatusUpdate", (string?)null, (string?)null);
                await Clients.All.SendAsync("RoomReset");
                await BroadcastQueueCount();
            }
        }
        else if (leaverName != null) // P1 was waiting alone (no opponent), notify others
        {
            await Clients.Others.SendAsync("LobbyUpdate",      (string?)null);
            await Clients.Others.SendAsync("GameStatusUpdate", (string?)null, (string?)null);
            await Clients.Others.SendAsync("RoomReset");
        }

        if (wasQueued)
        {
            if (positionsChanged) await BroadcastQueuePositions();
            await BroadcastQueueCount();
        }

        await base.OnDisconnectedAsync(exception);
    }

    // --- Helpers -------------------------------------------------------------
    private async Task BroadcastQueueCount()
    {
        int count;
        lock (_lock) { count = _queue.Count; }
        await Clients.All.SendAsync("QueueCountUpdate", count);
    }

    private async Task BroadcastQueuePositions()
    {
        List<(string Id, int Pos)> updates;
        lock (_lock) { updates = _queue.Select((q, i) => (q.Id, i + 1)).ToList(); }
        foreach (var (id, pos) in updates)
            await Clients.Client(id).SendAsync("QueuePositionUpdate", pos);
    }
}
