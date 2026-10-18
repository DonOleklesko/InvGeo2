// Uchwyt do przeciągania: zmienia rozmiar panelu (szerokość albo wysokość).
// onRuch dostaje przesunięcie w pikselach od początku przeciągania.
import { useRef } from "react";

export default function Uchwyt({ kierunek = "pion", className = "", onStart, onRuch, onKoniec, title }) {
  const start = useRef(null);
  return (
    <div
      className={`uchwyt ${kierunek} ${className}`}
      role="separator"
      aria-orientation={kierunek === "pion" ? "vertical" : "horizontal"}
      title={title}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onRuch(kierunek === "pion" ? e.clientX - start.current.x : e.clientY - start.current.y);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        onKoniec?.();
      }}
    />
  );
}
