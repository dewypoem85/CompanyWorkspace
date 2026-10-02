FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore && dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG APP_UID=1654
WORKDIR /app
RUN mkdir -p /app/data /app/data-keys && chown -R ${APP_UID}:${APP_UID} /app
COPY --from=build --chown=${APP_UID}:${APP_UID} /app/publish .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
USER ${APP_UID}:${APP_UID}
ENTRYPOINT ["dotnet","LeaveManager.dll"]
