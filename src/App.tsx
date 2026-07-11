import { CoCreateExperience } from "./cocreate/CoCreateExperience";
import { CoCreateV01Experience } from "./cocreate/CoCreateV01Experience";

function App() {
  const view = window.location.hash.replace("#/", "");

  if (view === "workbench") {
    return <CoCreateExperience />;
  }

  return <CoCreateV01Experience />;
}

export default App;
