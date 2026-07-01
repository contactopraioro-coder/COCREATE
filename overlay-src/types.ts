export type Role = "owner" | "builder" | "reviewer" | "guest";

export interface Branch {
  id: string;
  name: string;
  description: string;
  status: "Planning" | "Building" | "Review" | "Shipped";
  allowedRoles: Role[];
}

export interface MemberCard {
  id: string;
  name: string;
  role: Role;
  color: string;
  online: boolean;
  branchId: string;
  currentTask: string;
  lastAction: string;
}

export interface OverlayState {
  attached: boolean;
  appName: string;
  boundsLabel: string;
  message: string;
}
