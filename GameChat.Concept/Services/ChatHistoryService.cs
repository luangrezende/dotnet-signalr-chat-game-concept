using GameChat.Concept.Options;
using Microsoft.Extensions.Options;

namespace GameChat.Concept.Services;

public sealed record ChatMessage(string User, string Message, DateTime SentAt);

public sealed class ChatHistoryService(IOptions<ChatOptions> options)
{
    private readonly int _maxMessages = options.Value.HistorySize;
    private readonly LinkedList<ChatMessage> _messages = new();
    private readonly object _lock = new();

    public void Add(string user, string message)
    {
        lock (_lock)
        {
            _messages.AddLast(new ChatMessage(user, message, DateTime.UtcNow));
            if (_messages.Count > _maxMessages)
                _messages.RemoveFirst();
        }
    }

    public IReadOnlyList<ChatMessage> GetAll()
    {
        lock (_lock)
            return [.. _messages];
    }
}
