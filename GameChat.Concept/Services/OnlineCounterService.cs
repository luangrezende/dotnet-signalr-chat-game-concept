namespace GameChat.Concept.Services;

public sealed class OnlineCounterService
{
    private int _count;

    public int Increment() => Interlocked.Increment(ref _count);
    public int Decrement() => Interlocked.Decrement(ref _count);
    public int Count => _count;
}
