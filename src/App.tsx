import { CoCreateExperience } from "./cocreate/CoCreateExperience";
import { CoCreateV01Experience } from "./cocreate/CoCreateV01Experience";

function App() {
  const view = window.location.hash.replace("#/", "");

  if (view === "v01") {
    return <CoCreateV01Experience />;
  }

  return <CoCreateExperience />;
}

export default App;
