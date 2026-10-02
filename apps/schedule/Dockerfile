FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/Schedule.csproj ./server/
RUN dotnet restore server/Schedule.csproj
COPY server ./server
COPY --from=web /src/server/wwwroot ./server/wwwroot
RUN dotnet publish server/Schedule.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN mkdir -p /app/data && chown -R app:app /app/data
COPY --from=build /out .
ENV ASPNETCORE_HTTP_PORTS=8080 DataPath=/app/data
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Schedule.dll"]
