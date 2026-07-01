import { createRoot } from "react-dom/client";
import { Providers } from "./state";
import { App } from "./components/App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <Providers>
    <App />
  </Providers>,
);
