using GameChat.Concept.Services;
using Microsoft.AspNetCore.SignalR;

namespace GameChat.Concept.Hubs;

public class ChatHub(ChatHistoryService history, OnlineCounterService counter) : Hub
{
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();

        var messages = history.GetAll();
        if (messages.Count > 0)
            await Clients.Caller.SendAsync("ReceiveHistory", messages);

        var count = counter.Increment();
        await Clients.All.SendAsync("UpdateOnlineCount", count);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var count = counter.Decrement();
        await Clients.All.SendAsync("UpdateOnlineCount", count);

        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendMessage(string user, string message)
    {
        history.Add(user, message);
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }

    public async Task NotifyNameChange(string oldName, string newName)
    {
        if (string.IsNullOrWhiteSpace(oldName) || string.IsNullOrWhiteSpace(newName)) return;
        if (oldName == newName) return;
        await Clients.Others.SendAsync("ReceiveSystemMessage", $"{oldName} mudou o nome para {newName}");
    }

    public async Task NotifyTyping(string user)
    {
        await Clients.Others.SendAsync("UserTyping", user);
    }
}
