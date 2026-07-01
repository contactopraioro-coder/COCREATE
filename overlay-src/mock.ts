import type { Branch, MemberCard } from "./types";

export const branches: Branch[] = [
  {
    id: "entorno",
    name: "Entorno",
    description: "Sincronizacion general del proyecto y decisiones activas.",
    status: "Building",
    allowedRoles: ["owner", "builder", "reviewer", "guest"]
  },
  {
    id: "frontend",
    name: "Frontend",
    description: "Sidebar, comportamiento visual y capas.",
    status: "Planning",
    allowedRoles: ["owner", "builder", "reviewer"]
  },
  {
    id: "backend",
    name: "Backend",
    description: "Git, eventos y automatizacion futura.",
    status: "Review",
    allowedRoles: ["owner", "builder", "reviewer"]
  }
];

export const members: MemberCard[] = [
  {
    id: "martin",
    name: "Martin",
    role: "owner",
    color: "#f0d78a",
    online: true,
    branchId: "entorno",
    currentTask: "Ordenando alcance del layer",
    lastAction: "Definio el rail lateral"
  },
  {
    id: "sara",
    name: "Sara",
    role: "builder",
    color: "#8be2ff",
    online: true,
    branchId: "frontend",
    currentTask: "Midiendo offsets del overlay",
    lastAction: "Ajusto contorno de Codex"
  },
  {
    id: "nico",
    name: "Nico",
    role: "reviewer",
    color: "#a8f0b2",
    online: false,
    branchId: "backend",
    currentTask: "Esperando siguiente sync",
    lastAction: "Reviso permisos y tracking"
  }
];
