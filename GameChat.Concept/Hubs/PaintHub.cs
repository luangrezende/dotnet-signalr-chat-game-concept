using GameChat.Concept.Services;
using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

public class PaintHub(PaintHistoryService history) : Hub
{
    public async Task SendDrawAction(string gameId, string action, object data)
    {
        history.Add(action, data);
        await Clients.OthersInGroup(gameId).SendAsync("ReceiveDrawAction", action, data);
    }

    public override async Task OnConnectedAsync()
    {
        var httpContext = Context.GetHttpContext();
        var gameId = httpContext!.Request.Query["gameId"].ToString();

        if (!string.IsNullOrEmpty(gameId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, gameId);

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
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, gameId);

        await base.OnDisconnectedAsync(exception);
    }
}