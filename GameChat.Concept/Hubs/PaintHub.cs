using System.Collections.Concurrent;
using GameChat.Concept.Services;
using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

public class PaintHub(PaintHistoryService history, IHubContext<ChatHub> chatHub) : Hub
{
    // groupId -> { connectionId -> displayName }
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, string>> _groups = new();

    public async Task SendDrawAction(string gameId, string action, object data)
    {
        history.Add(action, data);
        await Clients.OthersInGroup(gameId).SendAsync("ReceiveDrawAction", action, data);
    }

    public override async Task OnConnectedAsync()
    {
        var httpContext = Context.GetHttpContext();
        var gameId   = httpContext!.Request.Query["gameId"].ToString();
        var userName = httpContext!.Request.Query["userName"].ToString();
        if (string.IsNullOrWhiteSpace(userName)) userName = "Anônimo";

        if (!string.IsNullOrEmpty(gameId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
            _groups.GetOrAdd(gameId, _ => new()).TryAdd(Context.ConnectionId, userName);

            var names = _groups[gameId].Values.ToArray();
            await Clients.Group(gameId).SendAsync("PaintOnlineUpdate", (object)names);
            await chatHub.Clients.All.SendAsync("PaintActivityUpdate", (object)names);

            foreach (var action in history.GetAll())
                await Clients.Caller.SendAsync("ReceiveDrawAction", action.Action, action.Data);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var httpContext = Context.GetHttpContext();
        var gameId = httpContext!.Request.Query["gameId"].ToString();

        if (!string.IsNullOrEmpty(gameId))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, gameId);
            if (_groups.TryGetValue(gameId, out var members))
            {
                members.TryRemove(Context.ConnectionId, out _);
                var names = members.Values.ToArray();
                await Clients.Group(gameId).SendAsync("PaintOnlineUpdate", (object)names);
                await chatHub.Clients.All.SendAsync("PaintActivityUpdate", (object)names);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }
}