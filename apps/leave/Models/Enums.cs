namespace LeaveManager.Models;

public enum EmployeeRole { Employee, Admin, Master }
public enum LeaveRequestStatus { Pending, Approved, Rejected, CancelRequested, Cancelled }
public enum LeaveDayPortion { FullDay = 0, Morning = 1, Afternoon = 2, 특수휴가 = 3, 기타 = 4, Birthday = 5 }
public enum LeaveGrantType { Monthly, Annual, CarriedOver, Imported, Manual, Birthday }
public enum LeaveSettlementType { Expiration, CarryOver, Compensation, AdvanceRepayment }
