import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronRight,
  CircleDot,
  DoorClosed,
  FileCode2,
  GitBranch,
  Laptop,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Shield
} from "lucide-react";
import { branches, members } from "./mock";
import type { MemberCard, OverlayState, Role } from "./types";

const roleLabels: Record<Role, string> = {
  owner: "owner",
  builder: "builder",
  reviewer: "reviewer",
  guest: "guest"
};

const defaultOverlayState: OverlayState = {
  attached: false,
  appName: "Codex",
  boundsLabel: "buscando ventana",
  message: "Esperando una ventana de Codex para pegar la sidebar."
};

function App() {
  const [activeBranchId, setActiveBranchId] = useState(branches[0]?.id ?? "");
  const [overlayState, setOverlayState] = useState<OverlayState>(defaultOverlayState);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const bridge = window.overlayBridge;
    if (!bridge) {
      return;
    }

    const unsubscribe = bridge.onState((payload) => {
      setOverlayState(payload);
    });

    return unsubscribe;
  }, []);

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? branches[0],
    [activeBranchId]
  );

  const activeMembers = useMemo(() => {
    const selected = members.filter((member) => member.branchId === activeBranch.id);
    return selected.length > 0 ? selected : members;
  }, [activeBranch]);

  const handleCollapse = async () => {
    const result = await window.overlayBridge?.toggleCollapse();
    if (result) {
      setCollapsed(result.collapsed);
    }
  };

  const handleClose = async () => {
    await window.overlayBridge?.closeApp();
  };

  return (
    <div className="overlay-root">
      <aside className={`sidebar-shell ${collapsed ? "collapsed" : ""}`}>
        <div className="sidebar-rail">
          <div className="rail-stack">
            {branches.map((branch) => (
              <button
                key={branch.id}
                className={`rail-pill ${branch.id === activeBranch.id ? "active" : ""}`}
                onClick={() => setActiveBranchId(branch.id)}
              >
                <span>{branch.name}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>

          <div className="rail-actions">
            <button className="rail-icon" onClick={handleCollapse} aria-label="Collapse sidebar">
              {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
            <button className="rail-icon danger" onClick={handleClose} aria-label="Close app">
              <DoorClosed size={16} />
            </button>
          </div>
        </div>

        <section className="sidebar-card">
          <div className="card-stack">
            {activeMembers.map((member) => (
              <MemberCardView
                key={member.id}
                member={member}
                isAttached={overlayState.attached}
                boundsLabel={overlayState.boundsLabel}
                statusMessage={overlayState.message}
              />
            ))}
          </div>

          <button className="collapse-chip" aria-label="Collapse sidebar" onClick={handleCollapse}>
            {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            <span>Sidebar pinneada</span>
          </button>
        </section>
      </aside>
    </div>
  );
}

function MemberCardView({
  member,
  isAttached,
  boundsLabel,
  statusMessage
}: {
  member: MemberCard;
  isAttached: boolean;
  boundsLabel: string;
  statusMessage: string;
}) {
  return (
    <article className="person-card">
      <div className="person-card-header">
        <div>
          <p className="eyebrow">{member.branchId}</p>
          <h1>{member.name}</h1>
        </div>
        <button className="icon-button" aria-label={`Acciones de ${member.name}`}>
          <Plus size={18} />
        </button>
      </div>

      <div className="person-row-list">
        <PersonRow icon={<FileCode2 size={16} />} text={member.currentTask} />
        <PersonRow icon={<Laptop size={16} />} text={boundsLabel} />
        <PersonRow icon={<GitBranch size={16} />} text={member.lastAction} />
        <PersonRow
          icon={<Shield size={16} />}
          text={`${roleLabels[member.role]}${member.online ? " · online" : " · idle"}`}
        />
      </div>

      <div className="person-card-section">
        <p className="section-label">Estado</p>
        <div className="status-line">
          <CircleDot size={16} className={member.online ? "status-live" : "status-idle"} />
          <span>{isAttached ? `Pegado a Codex` : statusMessage}</span>
        </div>
      </div>

      <div className="person-card-section muted-block">
        <p className="section-label">Fuente</p>
        <span>{member.branchId}</span>
      </div>
    </article>
  );
}

function PersonRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="person-row">
      {icon}
      <span>{text}</span>
    </div>
  );
}

export default App;
