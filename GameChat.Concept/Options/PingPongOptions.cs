namespace GameChat.Concept.Options;

public sealed class PingPongOptions
{
    public const string Section = "PingPong";

    public int   CanvasWidth      { get; init; }
    public int   CanvasHeight     { get; init; }
    public int   PaddleWidth      { get; init; }
    public int   PaddleHeight     { get; init; }
    public float PaddleSpeed      { get; init; }
    public int   BallRadius       { get; init; }
    public float BallInitialSpeed { get; init; }
    public float BallMaxSpeed     { get; init; }
    public int   WinScore         { get; init; }
}
