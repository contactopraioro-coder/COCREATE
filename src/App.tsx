const downloadUrl =
  "https://github.com/contactopraioro-coder/caleidoscopio-overlay/releases/latest/download/Caleidoscopio%20Overlay-0.0.1-arm64.dmg";

function App() {
  return (
    <main className="landing">
      <h1>Caleidoscopio Overlay</h1>
      <a className="download-button" href={downloadUrl}>
        Descargar instalador
      </a>
    </main>
  );
}

export default App;
