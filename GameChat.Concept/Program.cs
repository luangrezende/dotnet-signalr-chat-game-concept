using GameChat.Concept.Hubs;
using GameChat.Concept.Options;
using GameChat.Concept.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.Configure<ChatOptions>(builder.Configuration.GetSection(ChatOptions.Section));
builder.Services.AddSingleton<ChatHistoryService>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<ChatHub>("/chathub");
app.MapHub<PingPongHub>("/pingponghub");

app.Run();
