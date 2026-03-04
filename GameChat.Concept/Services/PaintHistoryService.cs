namespace GameChat.Concept.Services;

public sealed record DrawAction(string Action, object Data);

public sealed class PaintHistoryService
{
    private readonly List<DrawAction> _actions = new();
    private readonly object _lock = new();

    public void Add(string action, object data)
    {
        lock (_lock)
        {
            if (action == "clear")
                _actions.Clear();
            else
                _actions.Add(new DrawAction(action, data));
        }
    }

    public IReadOnlyList<DrawAction> GetAll()
    {
        lock (_lock)
            return [.. _actions];
    }
}
