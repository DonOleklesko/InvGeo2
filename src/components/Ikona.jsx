// Ikona z biblioteki Google Material Symbols (styl Sharp): https://fonts.google.com/icons
export default function Ikona({ n, className = "", fill = false, title }) {
  return (
    <span
      className={`ms ${fill ? "fill" : ""} ${className}`}
      aria-hidden={title ? undefined : "true"}
      title={title}
    >
      {n}
    </span>
  );
}

// Ta sama ikona jako HTML (dla dymków i znaczników Leaflet)
export const ikonaHtml = (n, cls = "") => `<span class="ms ${cls}" aria-hidden="true">${n}</span>`;
