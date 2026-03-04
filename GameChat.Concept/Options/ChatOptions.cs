namespace GameChat.Concept.Options;

public sealed class ChatOptions
{
    public const string Section = "Chat";

    /// <summary>Maximum number of messages kept in the in-memory history.</summary>
    public int HistorySize { get; init; }
}
