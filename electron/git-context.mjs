import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const GIT_CONTEXT_CHANNEL = "cocreate:git:get-context";

async function git(cwd, args) {
  const result = await execFileAsync("git", args, { cwd, timeout: 4_000, maxBuffer: 256_000 });
  return result.stdout.trim();
}

export function registerGitContextIpc({ ipcMain, resolveCwd }) {
  ipcMain.handle(GIT_CONTEXT_CHANNEL, async () => {
    const cwd = await resolveCwd();
    if (!cwd) return { available: true, repository: false, reason: "El Project activo no tiene directorio local asociado." };
    try {
      await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
      const [branch, commit, status] = await Promise.all([
        git(cwd, ["branch", "--show-current"]),
        git(cwd, ["rev-parse", "--short", "HEAD"]),
        git(cwd, ["status", "--porcelain", "--untracked-files=normal"])
      ]);
      return {
        available: true,
        repository: true,
        branch: branch || null,
        detached: !branch,
        commit,
        dirty: Boolean(status),
        changedFiles: status ? status.split("\n").filter(Boolean).length : 0,
        location: "Local",
        runtimeMode: "Desktop"
      };
    } catch {
      return { available: true, repository: false, reason: "El directorio del Project no es un repositorio Git." };
    }
  });
  return () => ipcMain.removeHandler(GIT_CONTEXT_CHANNEL);
}

