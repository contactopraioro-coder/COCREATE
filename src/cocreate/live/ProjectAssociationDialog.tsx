import { FolderOpen, Link2, Plus, X } from "lucide-react";
import { useState } from "react";
import type { WorkspaceEntity } from "../../app/services/workspace-experience-service.js";

type Props = {
  open: boolean;
  taskName: string;
  projects: WorkspaceEntity[];
  environment: "desktop" | "web";
  busy: boolean;
  onClose: () => void;
  onAssociate: (projectId: string) => void;
  onCreate: (name: string) => void;
  onCreateFromDirectory: () => void;
};

export function ProjectAssociationDialog(props: Props) {
  const [name, setName] = useState("");
  const activeProjects = props.projects.filter((project) => !project.archived);

  if (!props.open) return null;

  return (
    <div className="project-association-backdrop" role="presentation">
      <section className="project-association-dialog" role="dialog" aria-modal="true" aria-labelledby="project-association-title">
        <header>
          <span><Link2 size={17} /></span>
          <div>
            <h2 id="project-association-title">Vincular un proyecto</h2>
            <p>Elige dónde se desarrollará la propuesta de “{props.taskName}”.</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={props.onClose}><X size={16} /></button>
        </header>

        {activeProjects.length ? (
          <div className="project-association-list" aria-label="Proyectos disponibles">
            {activeProjects.map((project) => (
              <button key={project.id} type="button" disabled={props.busy} onClick={() => props.onAssociate(project.id)}>
                <span><strong>{project.name}</strong><small>{project.hasDirectory ? project.rootPathLabel ?? "Carpeta vinculada" : "Sin carpeta vinculada"}</small></span>
                <Link2 size={14} />
              </button>
            ))}
          </div>
        ) : <p className="project-association-empty">Todavía no tienes proyectos. Puedes crear uno sin salir de Live.</p>}

        <form onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || props.busy) return;
          props.onCreate(name.trim());
          setName("");
        }}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del nuevo proyecto" maxLength={80} autoFocus />
          <button type="submit" disabled={props.busy || !name.trim()}><Plus size={14} /> Crear y vincular</button>
        </form>

        {props.environment === "desktop" ? (
          <button type="button" className="project-association-folder" disabled={props.busy} onClick={props.onCreateFromDirectory}>
            <FolderOpen size={15} /> Elegir una carpeta como proyecto
          </button>
        ) : null}
      </section>
    </div>
  );
}
