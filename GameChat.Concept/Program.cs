using GameChat.Concept.Hubs;
using GameChat.Concept.Options;
using GameChat.Concept.Services;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.Configure<ChatOptions>(builder.Configuration.GetSection(ChatOptions.Section));
builder.Services.Configure<PingPongOptions>(builder.Configuration.GetSection(PingPongOptions.Section));
builder.Services.AddSingleton<ChatHistoryService>();
builder.Services.AddSingleton<OnlineCounterService>();
builder.Services.AddSingleton<PaintHistoryService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// Exposes non-secret game configuration to the client
app.MapGet("/api/config", (IOptions<PingPongOptions> pp) => Results.Ok(new
{
    pingPong = pp.Value
}));

app.MapHub<ChatHub>("/chathub");
app.MapHub<PingPongHub>("/pingponghub");
app.MapHub<PaintHub>("/painthub");

app.Run();
