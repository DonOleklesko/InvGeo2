import React from "react";
import ReactDOM from "react-dom/client";
import "./components/przepuszczanieCanvas.js"; // przed pierwszą mapą
import App from "./App.jsx";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
