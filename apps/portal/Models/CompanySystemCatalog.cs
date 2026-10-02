namespace CompanyPortal.Models;

public sealed record CompanySystemDefinition(
    string Key,
    string Audience,
    string Name,
    string Description,
    string AccessPermission,
    string BaseUrlConfigurationKey,
    bool IsDefaultForEmployees)
{
    public string LaunchPath => $"/workspace/{Key}";
}

public static class CompanySystemCatalog
{
    public static readonly IReadOnlyList<CompanySystemDefinition> All =
    [
        new(
            "schedule",
            "schedule",
            "팀 일정",
            "주간 일정과 칸반에서 업무를 관리하고 댓글·이미지로 함께 논의합니다.",
            "schedule.access",
            "Systems:Schedule:BaseUrl",
            true),
        new(
            "leave",
            "leave",
            "연차관리",
            "연차 신청, 승인, 달력, 잔여량 및 사용 기록을 관리합니다.",
            "leave.access",
            "Systems:Leave:BaseUrl",
            true),
        new(
            "cs",
            "cs",
            "CS",
            "Steam 환불, PlayFab 지급·회수 및 운영 로그 도구를 사용합니다.",
            "cs.access",
            "Systems:Cs:BaseUrl",
            false),
        new(
            "statistics",
            "statistics",
            "게임 통계",
            "게임 완료, 플레이 흐름 및 보스 전투 성과를 분석합니다.",
            "statistics.access",
            "Systems:Statistics:BaseUrl",
            false),
        new(
            "sheet",
            "sheet",
            "시트 관리",
            "게임 데이터·번역 시트의 갱신, 스냅샷 및 릴리스를 관리합니다.",
            "sheet.access",
            "Systems:Sheet:BaseUrl",
            false),
        new(
            "iap",
            "iap",
            "상품 관리",
            "상품 시트·가격표와 스토어 신규 등록을 관리합니다. 기존 모바일 상품은 기본 보호됩니다.",
            "iap.access",
            "Systems:Iap:BaseUrl",
            false)
    ];

    public static readonly IReadOnlyList<CompanySystemDefinition> DefaultForEmployees =
        All.Where(x => x.IsDefaultForEmployees).ToArray();

    public static readonly IReadOnlyList<CompanySystemDefinition> Configurable =
        All.Where(x => !x.IsDefaultForEmployees).ToArray();

    public static CompanySystemDefinition? Find(string? key)
        => All.FirstOrDefault(x => string.Equals(x.Key, key?.Trim(), StringComparison.OrdinalIgnoreCase));
}
