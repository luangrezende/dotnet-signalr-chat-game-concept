using GameChat.Concept.Services;
using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

public class ChatHub(ChatHistoryService history) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var messages = history.GetAll();
        if (messages.Count > 0)
            await Clients.Caller.SendAsync("ReceiveHistory", messages);

        await base.OnConnectedAsync();
    }

    public async Task SendMessage(string user, string message)
    {
        history.Add(user, message);
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }
}
