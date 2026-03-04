FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY GameChat.Concept/GameChat.Concept.csproj GameChat.Concept/
RUN dotnet restore GameChat.Concept/GameChat.Concept.csproj

COPY GameChat.Concept/ GameChat.Concept/
WORKDIR /src/GameChat.Concept
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:${PORT:-8080}

ENTRYPOINT ["dotnet", "GameChat.Concept.dll"]
