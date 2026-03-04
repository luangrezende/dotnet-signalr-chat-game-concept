FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ChatApp/ChatApp.csproj ChatApp/
RUN dotnet restore ChatApp/ChatApp.csproj

COPY ChatApp/ ChatApp/
WORKDIR /src/ChatApp
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:${PORT:-8080}

ENTRYPOINT ["dotnet", "ChatApp.dll"]
