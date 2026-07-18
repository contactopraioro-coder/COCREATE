export type ComposerAttachment = {
  token: string;
  name: string;
  kind: "image" | "file" | "folder";
  size: number;
  type: string;
  source?: "desktop" | "web";
  dataBase64?: string;
  previewUrl?: string;
};

export class AttachmentService {
  constructor(
    private readonly selectFromDevice?: (kind: "file" | "folder") => Promise<ComposerAttachment[]>,
    private readonly prepareDroppedFromDevice?: (files: FileList | File[]) => Promise<ComposerAttachment[]>,
    private readonly releaseFromDevice?: (tokens: string[]) => Promise<unknown>
  ) {}

  getAvailability(kind: "file" | "folder" = "file") {
    if (kind === "folder") {
      return this.selectFromDevice
        ? { available: true, reason: "CoCreate Desktop puede seleccionar carpetas como contexto local." }
        : { available: false, reason: "La selección de carpetas requiere CoCreate Desktop." };
    }
    return this.selectFromDevice || this.prepareDroppedFromDevice
      ? { available: true, reason: this.selectFromDevice
          ? "Codex App Server puede recibir referencias locales seleccionadas explícitamente."
          : "CoCreate Web puede adjuntar archivos seleccionados explícitamente desde el navegador." }
      : { available: false, reason: "El selector de archivos no está disponible en este navegador." };
  }

  async select(kind: "file" | "folder") {
    if (!this.selectFromDevice) {
      throw new Error("Esta acción requiere CoCreate Desktop; Web no simula acceso al filesystem local.");
    }
    return this.selectFromDevice(kind);
  }

  async prepareDropped(files: FileList | File[]) {
    if (!this.prepareDroppedFromDevice) {
      throw new Error("Este navegador no permite preparar archivos de forma segura.");
    }
    return this.prepareDroppedFromDevice(files);
  }

  async release(tokens: string[]) {
    if (!tokens.length || !this.releaseFromDevice) return;
    await this.releaseFromDevice(tokens);
  }
}
